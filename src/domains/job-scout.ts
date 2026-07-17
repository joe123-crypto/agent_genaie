import { FieldValue } from "firebase-admin/firestore";
import { getFirestoreDb } from "@/src/firebase/admin";
import {
  httpError,
  normalizePhone,
  whatsappPhoneHash,
  validateFirebaseUid,
  jobApplicationId,
  normalizeJobPreferences,
  normalizeStringList,
  normalizeCvFileRef,
  isActivePhoneLink,
} from "@/src/lib/utils";
import { putObject, getPresignedGetUrl, deleteObject, objectExists } from "./r2-storage";
import {
  calculateOnboardingNextStep,
  storedOnboardingChannel,
} from "./onboarding-flow";
import {
  evaluateJobScoutReadiness,
  JOB_SCOUT_ONBOARDING_VERSION,
  JOB_SCOUT_SAFETY_ACKNOWLEDGEMENT_VERSION,
} from "./job-scout-readiness";
import { getSendableGmailConnection } from "./gmail";

export async function findJobScoutUserByPhone(phoneInput: string) {
  const phone = normalizePhone(phoneInput);
  const hash = whatsappPhoneHash(phone);
  const db = getFirestoreDb();
  const deliveryDoc = await db.collection("jobScoutDeliveryByPhone").doc(hash).get();
  if (!deliveryDoc.exists || deliveryDoc.data()?.status !== "active") {
    return null;
  }
  return deliveryDoc.data()!.userId;
}

async function resolveJobScoutUserByPhone(phoneInput: string) {
  const phone = normalizePhone(phoneInput);
  const hash = whatsappPhoneHash(phone);
  const db = getFirestoreDb();
  const [deliveryDoc, phoneDoc] = await Promise.all([
    db.collection("jobScoutDeliveryByPhone").doc(hash).get(),
    db.collection("phoneLinksByPhone").doc(hash).get(),
  ]);
  const deliveryData = deliveryDoc.exists ? deliveryDoc.data() || {} : {};
  const phoneData = phoneDoc.exists ? phoneDoc.data() || {} : {};
  const userId = deliveryData.status === "active" && deliveryData.userId
    ? deliveryData.userId
    : isActivePhoneLink(phoneData) ? phoneData.userId : null;
  return { phone, hash, userId: userId ? validateFirebaseUid(userId) : null };
}

async function deleteDocumentRefs(refs: FirebaseFirestore.DocumentReference[]) {
  let deleted = 0;
  for (let i = 0; i < refs.length; i += 450) {
    const chunk = refs.slice(i, i + 450);
    const batch = getFirestoreDb().batch();
    for (const ref of chunk) batch.delete(ref);
    await batch.commit();
    deleted += chunk.length;
  }
  return deleted;
}

export async function saveJobScoutProfile(
  body: any,
  dependencies: { objectExists: typeof objectExists } = { objectExists },
) {
  const resolvedUid = body.userId ?? (body.phone ? await findJobScoutUserByPhone(body.phone) : null);
  if (!resolvedUid) {
    throw httpError(404, "Linked Job Scout user not found.");
  }
  const safeUid = validateFirebaseUid(resolvedUid);
  const db = getFirestoreDb();
  const profileRef = db.collection("jobScoutProfiles").doc(safeUid);
  const preferences = normalizeJobPreferences(body.preferences);
  if (preferences.targetRoles.length === 0) throw httpError(400, "At least one target role is required.");
  if (preferences.locations.length === 0 || !/^[a-z]{2}$/.test(preferences.country)) {
    throw httpError(400, "At least one validated location and country are required.");
  }
  const cvFileRef = normalizeCvFileRef(body.cvFileRef);
  if (!await dependencies.objectExists(cvFileRef)) throw httpError(400, "The staged CV is not available.");

  const [existingDoc, userDoc, gmailConnection] = await Promise.all([
    profileRef.get(),
    db.collection("users").doc(safeUid).get(),
    getGmailConnection(safeUid),
  ]);
  const existing = existingDoc.exists ? existingDoc.data() || {} : {};
  const userData = userDoc.exists ? userDoc.data() || {} : {};
  if (!gmailConnection.connected) {
    throw httpError(409, "Gmail is not connected.");
  }
  const senderEmail = String((userData.profile as any)?.email || "").trim()
    || null;
  if (!senderEmail) {
    throw httpError(409, "The linked user has no application email.");
  }

  const profileConfirmedAt = existing.profileConfirmedAt
    || (body.profileConfirmed === true ? FieldValue.serverTimestamp() : null);
  const safetyAcknowledgedAt = existing.safetyAcknowledgedAt
    || (body.safetyAcknowledged === true ? FieldValue.serverTimestamp() : null);
  if (!profileConfirmedAt) throw httpError(400, "Profile confirmation is required.");
  if (!safetyAcknowledgedAt) throw httpError(400, "Scam-safety acknowledgement is required.");

  const profilePayload = {
    userId: safeUid,
    preferences,
    cvFileRef,
    cvParsedText: body.cvParsedText ? String(body.cvParsedText).slice(0, 50000) : null,
    onboardingVersion: JOB_SCOUT_ONBOARDING_VERSION,
    setupStatus: "ready",
    profileConfirmedAt,
    safetyAcknowledgedAt,
    safetyAcknowledgementVersion:
      existing.safetyAcknowledgementVersion || JOB_SCOUT_SAFETY_ACKNOWLEDGEMENT_VERSION,
    completionSource: existing.completionSource || "explicit",
    createdAt: existing.createdAt || FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  const batch = db.batch();
  batch.set(profileRef, profilePayload, { merge: true });
  const onboarding = userData.onboarding || {};
  const onboardingChannel = storedOnboardingChannel(onboarding.channel);
  const onboardingStatus = String(onboarding.status ?? "");
  if (
    onboarding.selectedService === "jobs"
    && onboardingChannel === "chat"
    && (onboardingStatus === "required" || onboardingStatus === "in_progress")
  ) {
    batch.set(db.collection("users").doc(safeUid), {
      onboarding: {
        selectedService: "jobs",
        channel: "chat",
        status: "completed",
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  await batch.commit();
  return { ok: true, setupStatus: "ready", ready: true };
}

// Vercel Functions reject request bodies larger than 4.5 MB, and multipart adds
// framing overhead, so cap the CV comfortably below that. Larger files would
// need a direct presigned PUT rather than this proxied upload.
const CV_MAX_BYTES = 4 * 1024 * 1024;

export function cvObjectKey(uid: string) {
  return `${uid}/cv/cv.pdf`;
}

export async function saveJobScoutCv(input: {
  userId?: string;
  phone?: string;
  bytes: Buffer;
  contentType?: string;
}) {
  const resolvedUid = input.userId ?? (input.phone ? await findJobScoutUserByPhone(input.phone) : null);
  if (!resolvedUid) {
    throw httpError(404, "Linked Job Scout user not found.");
  }
  const safeUid = validateFirebaseUid(resolvedUid);
  if (!input.bytes || input.bytes.length === 0) throw httpError(400, "CV file is required.");
  if (input.bytes.length > CV_MAX_BYTES) throw httpError(413, "CV file is too large (max 4 MB).");
  const contentType = String(input.contentType ?? "").toLowerCase().split(";")[0].trim();
  if (contentType !== "application/pdf") throw httpError(415, "CV must be a PDF (application/pdf).");

  const key = cvObjectKey(safeUid);
  await putObject(key, input.bytes, "application/pdf");

  const db = getFirestoreDb();
  const profileRef = db.collection("jobScoutProfiles").doc(safeUid);
  await db.runTransaction(async (t) => {
    const doc = await t.get(profileRef);
    if (doc.exists) {
      t.update(profileRef, {
        cvFileRef: normalizeCvFileRef(key),
        // The previous extraction no longer matches the new file; clear it so
        // stale personal data isn't retained until the worker re-parses.
        cvParsedText: null,
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      t.set(profileRef, {
        userId: safeUid,
        preferences: normalizeJobPreferences(undefined),
        cvFileRef: normalizeCvFileRef(key),
        cvParsedText: null,
        onboardingVersion: JOB_SCOUT_ONBOARDING_VERSION,
        setupStatus: "draft",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  });
  return { ok: true, key };
}

export async function getJobScoutCvUrl(userIdInput: string) {
  const safeUid = validateFirebaseUid(userIdInput);
  const db = getFirestoreDb();
  const doc = await db.collection("jobScoutProfiles").doc(safeUid).get();
  const cvFileRef = doc.exists ? (doc.data()?.cvFileRef as string | null | undefined) : null;
  if (!cvFileRef) throw httpError(404, "No CV on file.");
  // Presigning never checks existence, so verify the object is actually in R2 —
  // otherwise a stale cvFileRef would yield a URL that 404s on download and let
  // readiness checks pass falsely.
  if (!(await objectExists(cvFileRef))) throw httpError(404, "CV file is missing from storage.");
  const expiresIn = 300;
  const url = await getPresignedGetUrl(cvFileRef, expiresIn);
  return { url, key: cvFileRef, expiresIn };
}

export async function getJobScoutCvFileRef(userIdInput: string) {
  const safeUid = validateFirebaseUid(userIdInput);
  const db = getFirestoreDb();
  const doc = await db.collection("jobScoutProfiles").doc(safeUid).get();
  const cvFileRef = doc.exists ? String(doc.data()?.cvFileRef || "").trim() : "";
  return cvFileRef || null;
}

export async function deleteJobScoutCv(userIdInput: string) {
  const safeUid = validateFirebaseUid(userIdInput);
  const db = getFirestoreDb();
  const profileRef = db.collection("jobScoutProfiles").doc(safeUid);
  const doc = await profileRef.get();
  if (!doc.exists) return { ok: true };
  const cvFileRef = doc.data()?.cvFileRef as string | null | undefined;
  // Remove the R2 object only when there is one to remove...
  if (cvFileRef) await deleteObject(cvFileRef);
  // ...but always purge the CV references and extracted text, so parsed data
  // left behind by old deletions or /profile writes (which may have no
  // cvFileRef) doesn't linger.
  await profileRef.update({
    cvFileRef: null,
    cvParsedText: null,
    setupStatus: "draft",
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { ok: true };
}

export async function resetJobScoutProfileForPhone(
  phoneInput: string,
  dependencies: { deleteObject: typeof deleteObject } = { deleteObject },
) {
  const { phone, hash, userId } = await resolveJobScoutUserByPhone(phoneInput);
  if (!userId) throw httpError(404, "Linked Job Scout user not found.");

  const db = getFirestoreDb();
  const profileRef = db.collection("jobScoutProfiles").doc(userId);
  const profileDoc = await profileRef.get();
  let profileDeleted = false;
  let cvDeleted = false;

  if (profileDoc.exists) {
    const cvFileRef = String(profileDoc.data()?.cvFileRef || "").trim();
    if (cvFileRef) {
      await dependencies.deleteObject(cvFileRef);
      cvDeleted = true;
    }
    await profileRef.delete();
    profileDeleted = true;
  }

  const applicationSnap = await db.collection("jobApplications").where("userId", "==", userId).get();
  const applicationsDeleted = await deleteDocumentRefs(applicationSnap.docs.map((doc) => doc.ref));

  return {
    ok: true,
    userId,
    phone,
    phoneHash: hash,
    profileDeleted,
    cvDeleted,
    applicationsDeleted,
  };
}

async function getGmailConnection(uid: string) {
  return getSendableGmailConnection(uid);
}

export type JobScoutStatusDependencies = {
  objectExists: typeof objectExists;
};

const defaultJobScoutStatusDependencies: JobScoutStatusDependencies = { objectExists };

async function buildJobScoutSubscriber(
  uidInput: string,
  profile: Record<string, any>,
  dependencies: JobScoutStatusDependencies = defaultJobScoutStatusDependencies,
): Promise<any> {
  const uid = validateFirebaseUid(uidInput);
  const db = getFirestoreDb();
  const [phoneDoc, userDoc, gmailConnection] = await Promise.all([
    db.collection("phoneLinksByUser").doc(uid).get(),
    db.collection("users").doc(uid).get(),
    getGmailConnection(uid),
  ]);

  const phoneData = phoneDoc.exists ? phoneDoc.data() || {} : {};
  const userData = userDoc.exists ? userDoc.data() || {} : {};
  const rawPhone = isActivePhoneLink(phoneData) ? phoneData.phone : null;
  const phone = rawPhone ? normalizePhone(rawPhone) : null;
  const hash = phone ? whatsappPhoneHash(phone) : (phoneData.phoneHash as string | null | undefined) || null;
  const profileEmail = String((userData.profile as any)?.email || "").trim() || null;
  const gmailConnected = gmailConnection.connected;
  const senderEmail = gmailConnected
    ? profileEmail
    : null;
  const cvFileRef = String(profile.cvFileRef || "").trim();
  const cvAvailable = Boolean(cvFileRef && await dependencies.objectExists(cvFileRef));
  const readiness = evaluateJobScoutReadiness({
    onboardingVersion: profile.onboardingVersion,
    preferences: profile.preferences,
    gmailConnected,
    senderEmail,
    cvFileRef,
    cvAvailable,
    profileConfirmedAt: profile.profileConfirmedAt,
    safetyAcknowledgedAt: profile.safetyAcknowledgedAt,
  });
  const onboardingChannel = (userData.onboarding as any)?.selectedService === "jobs"
    ? storedOnboardingChannel((userData.onboarding as any)?.channel)
    : null;
  const onboardingStatus = String((userData.onboarding as any)?.status ?? "not_required");
  const onboardingNextStep = readiness.ready
    ? "dashboard"
    : onboardingChannel
      ? calculateOnboardingNextStep({
          selectedService: "jobs",
          channel: onboardingChannel,
          whatsappLinked: Boolean(phone),
          whatsappSkipped: Boolean((userData.onboarding as any)?.whatsappSkippedAt),
          gmailConnected,
          jobScoutReady: readiness.ready,
          webetuConfigured: false,
        })
      : "channel_selection";

  return {
    ...profile,
    ...readiness,
    userId: uid,
    whatsappPhone: phone,
    whatsappPhoneHash: hash,
    gmailConnected,
    senderEmail,
    cvAvailable,
    onboardingChannel,
    onboardingStatus,
    onboardingNextStep,
    profile: {
      email: profileEmail,
      displayName: (userData.profile as any)?.displayName || null,
    },
  };
}

export async function listJobScoutSubscribers(limitInput: number) {
  const limit = Number.isFinite(limitInput) ? Math.max(1, Math.min(limitInput, 100)) : 50;
  const db = getFirestoreDb();
  const snap = await db.collection("jobScoutProfiles").limit(limit).get();

  const subscribers = await Promise.all(
    snap.docs.map((doc) => buildJobScoutSubscriber(doc.id, doc.data())),
  );
  return subscribers.filter((subscriber) => subscriber.ready);
}

export async function getJobScoutStatusForUser(
  userIdInput: string,
  dependencies: JobScoutStatusDependencies = defaultJobScoutStatusDependencies,
) {
  const uid = validateFirebaseUid(userIdInput);
  const db = getFirestoreDb();
  const profileDoc = await db.collection("jobScoutProfiles").doc(uid).get();
  const subscriber = await buildJobScoutSubscriber(
    uid,
    profileDoc.exists ? profileDoc.data() || {} : {},
    dependencies,
  );
  const preferences = subscriber.preferences && typeof subscriber.preferences === "object"
    ? subscriber.preferences
    : {};
  return {
    configured: profileDoc.exists,
    linked: Boolean(subscriber.whatsappPhone),
    gmailConnected: subscriber.gmailConnected,
    senderEmail: subscriber.senderEmail,
    cvAvailable: subscriber.cvAvailable,
    onboardingVersion: subscriber.onboardingVersion,
    legacyProfile: subscriber.legacyProfile,
    profileConfirmed: subscriber.profileConfirmed,
    safetyAcknowledged: subscriber.safetyAcknowledged,
    setupStatus: subscriber.setupStatus,
    ready: subscriber.ready,
    onboardingChannel: subscriber.onboardingChannel,
    onboardingStatus: subscriber.onboardingStatus,
    onboardingNextStep: subscriber.onboardingNextStep,
    missingRequirements: subscriber.missingRequirements,
    profile: {
      email: subscriber.profile.email,
      displayName: subscriber.profile.displayName,
    },
    preferences: {
      targetRoles: preferences.targetRoles || [],
      locations: preferences.locations || [],
      country: preferences.country || null,
      language: preferences.language || null,
      autoApply: preferences.autoApply !== false,
      maxApplicationsPerRun: preferences.maxApplicationsPerRun ?? 2,
    },
  };
}

export async function getJobScoutStatusForPhone(phoneInput: string) {
  const phone = normalizePhone(phoneInput);
  const hash = whatsappPhoneHash(phone);
  const db = getFirestoreDb();
  const [deliveryDoc, phoneDoc] = await Promise.all([
    db.collection("jobScoutDeliveryByPhone").doc(hash).get(),
    db.collection("phoneLinksByPhone").doc(hash).get(),
  ]);
  const deliveryData = deliveryDoc.exists ? deliveryDoc.data() || {} : {};
  const phoneData = phoneDoc.exists ? phoneDoc.data() || {} : {};
  const uid = deliveryData.status === "active" && deliveryData.userId
    ? deliveryData.userId
    : isActivePhoneLink(phoneData) ? phoneData.userId : null;
  if (!uid) {
    return {
      configured: false,
      linked: false,
      gmailConnected: false,
      cvAvailable: false,
      profileConfirmed: false,
      safetyAcknowledged: false,
      setupStatus: "draft",
      ready: false,
      onboardingChannel: null,
      onboardingStatus: "not_started",
      onboardingNextStep: "channel_selection",
      missingRequirements: [
        "phone_link",
        "gmail_connection",
        "sender_email",
        "cv",
        "target_roles",
        "locations",
        "profile_confirmation",
        "safety_acknowledgement",
      ],
    };
  }

  const profileDoc = await db.collection("jobScoutProfiles").doc(validateFirebaseUid(uid)).get();
  const subscriber = await buildJobScoutSubscriber(uid, profileDoc.exists ? profileDoc.data() || {} : {});
  const preferences = subscriber.preferences && typeof subscriber.preferences === "object"
    ? subscriber.preferences
    : {};
  return {
    configured: profileDoc.exists,
    linked: Boolean(subscriber.whatsappPhone),
    gmailConnected: subscriber.gmailConnected,
    senderEmail: subscriber.senderEmail,
    cvAvailable: subscriber.cvAvailable,
    onboardingVersion: subscriber.onboardingVersion,
    legacyProfile: subscriber.legacyProfile,
    profileConfirmed: subscriber.profileConfirmed,
    safetyAcknowledged: subscriber.safetyAcknowledged,
    setupStatus: subscriber.setupStatus,
    ready: subscriber.ready,
    onboardingChannel: subscriber.onboardingChannel,
    onboardingStatus: subscriber.onboardingStatus,
    onboardingNextStep: subscriber.onboardingNextStep,
    missingRequirements: subscriber.missingRequirements,
    profile: {
      displayName: subscriber.profile.displayName,
    },
    preferences: {
      targetRoles: preferences.targetRoles || [],
      locations: preferences.locations || [],
      country: preferences.country || null,
      language: preferences.language || null,
      autoApply: preferences.autoApply !== false,
      maxApplicationsPerRun: preferences.maxApplicationsPerRun ?? 2,
    },
  };
}

export async function listJobApplications(userIdInput: string) {
  const safeUid = validateFirebaseUid(userIdInput);
  const db = getFirestoreDb();
  const snap = await db.collection("jobApplications").where("userId", "==", safeUid).get();
  return snap.docs.map((doc) => doc.data());
}

export async function recordJobApplication(body: any) {
  const safeUid = validateFirebaseUid(body.userId);
  const company = String(body.company ?? "").trim();
  const role = String(body.role ?? "").trim();
  if (!company) throw httpError(400, "company is required.");
  if (!role) throw httpError(400, "role is required.");
  const status = String(body.status ?? "applied").trim();
  if (!["applied", "skipped", "action_required", "physical_submission", "failed"].includes(status)) {
    throw httpError(400, "status is invalid.");
  }
  const applicationEmail = String(body.applicationEmail ?? body.application_email ?? "").trim() || null;
  const source = String(body.source ?? "").trim() || "agent";
  const sourceUrl = String(body.sourceUrl ?? body.source_url ?? body.url ?? "").trim() || null;
  const messageId = String(body.messageId ?? body.message_id ?? "").trim() || null;
  const closing = String(body.closing ?? "").trim() || null;
  const matchReason = String(body.matchReason ?? body.match_reason ?? "").trim() || null;
  const submissionMethod = String(body.submissionMethod ?? body.submission_method ?? "").trim() || null;
  if (submissionMethod && !["email", "website", "manual"].includes(submissionMethod)) {
    throw httpError(400, "submissionMethod is invalid.");
  }
  const applicationUrl = String(body.applicationUrl ?? body.application_url ?? sourceUrl ?? "").trim() || null;
  const blockerCode = String(body.blockerCode ?? body.blocker_code ?? "").trim().slice(0, 80) || null;
  const attemptValue = Number(body.attemptCount ?? body.attempt_count ?? 0);
  const attemptCount = Number.isFinite(attemptValue) ? Math.max(0, Math.min(Math.trunc(attemptValue), 3)) : 0;
  const evidenceInput = body.evidence && typeof body.evidence === "object" ? body.evidence : {};
  const evidence = {
    finalUrl: String(evidenceInput.finalUrl ?? "").trim().slice(0, 2000) || null,
    filledFields: normalizeStringList(evidenceInput.filledFields).slice(0, 30),
  };
  const replace = body.replace === true;
  const db = getFirestoreDb();
  const id = jobApplicationId(safeUid, company, role);
  const docRef = db.collection("jobApplications").doc(id);
  const now = FieldValue.serverTimestamp();
  let created = false;
  let updated = false;
  await db.runTransaction(async (t) => {
    const doc = await t.get(docRef);
    const payload = {
      id,
      applicationId: id,
      userId: safeUid,
      subscriptionId: `${safeUid}_jobs`,
      company,
      role,
      source,
      url: sourceUrl,
      sourceUrl,
      applicationEmail,
      status,
      notes: normalizeStringList(body.notes),
      messageId,
      closing,
      matchReason,
      submissionMethod,
      applicationUrl,
      blockerCode,
      attemptCount,
      lastAttemptAt: attemptCount > 0 ? now : null,
      evidence,
      appliedAt: status === "applied" ? now : null,
      updatedAt: now,
    };
    if (!doc.exists) {
      t.set(docRef, {
        ...payload,
        createdAt: now,
      });
      created = true;
    } else if (replace) {
      t.update(docRef, payload);
      updated = true;
    }
  });
  return { ok: true, id, created, updated, skippedExisting: !created && !updated };
}
