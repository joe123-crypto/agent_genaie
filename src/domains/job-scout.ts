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
  credentialRefId,
} from "@/src/lib/utils";
import { jobScoutTokenHash } from "@/src/security/crypto";
import { putObject, getPresignedGetUrl, deleteObject, objectExists } from "./r2-storage";
import { ensurePublicUserId } from "./users";
import { queuePhoneLinkCoreWrites, queueJobScoutPhoneDeliveryUpdate } from "./account-link";
import { config, assertPublicBaseUrl, JOB_SCOUT_SETUP_TTL_SECONDS } from "@/src/config";
import {
  evaluateJobScoutReadiness,
  canonicalGmailCredentialIsActive,
  JOB_SCOUT_ONBOARDING_VERSION,
  JOB_SCOUT_SAFETY_ACKNOWLEDGEMENT_VERSION,
  legacyGmailCredentialIsActive,
} from "./job-scout-readiness";

export async function createJobScoutInvite(phoneInput: string, ttlSecondsInput?: number) {
  assertPublicBaseUrl();
  const phone = normalizePhone(phoneInput);
  const ttlSeconds = Number.isFinite(ttlSecondsInput)
    ? Math.max(60, Math.min(ttlSecondsInput as number, JOB_SCOUT_SETUP_TTL_SECONDS))
    : JOB_SCOUT_SETUP_TTL_SECONDS;
  const db = getFirestoreDb();
  const docRef = db.collection("jobScoutInvites").doc();
  const token = docRef.id;
  const hashedToken = jobScoutTokenHash(token);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  await docRef.set({
    phone,
    phoneHash: whatsappPhoneHash(phone),
    tokenHash: hashedToken,
    status: "pending",
    createdAt: FieldValue.serverTimestamp(),
    expiresAt,
  });
  return {
    token,
    setupUrl: `${config.publicBaseUrl}/job-scout/setup?token=${token}`,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function getJobScoutInvite(token: string) {
  if (!token || typeof token !== "string") throw httpError(400, "Token is required.");
  const hashedToken = jobScoutTokenHash(token);
  const db = getFirestoreDb();
  const docRef = db.collection("jobScoutInvites").doc(token);
  const doc = await docRef.get();
  if (!doc.exists) throw httpError(404, "Invalid or expired invite.");
  const data = doc.data()!;
  if (data.tokenHash !== hashedToken) throw httpError(404, "Invalid or expired invite.");
  if (data.status !== "pending") throw httpError(410, "This invite has already been used.");
  if (data.expiresAt?.toDate && data.expiresAt.toDate() < new Date()) {
    throw httpError(410, "This invite has expired.");
  }
  return { id: doc.id, ...data } as { id: string; [key: string]: any };
}

export async function bindJobScoutInviteToUser(token: string, firebaseUser: any) {
  const safeUid = validateFirebaseUid(firebaseUser.uid);
  const invite = await getJobScoutInvite(token);
  const db = getFirestoreDb();
  const centralRef = db.collection("users").doc(safeUid);
  const inviteRef = db.collection("jobScoutInvites").doc(invite.id);
  const now = FieldValue.serverTimestamp();
  const phoneInput = invite.phone;
  await db.runTransaction(async (t) => {
    const inviteCheck = await t.get(inviteRef);
    if (!inviteCheck.exists || inviteCheck.data()?.status !== "pending") {
      throw httpError(410, "This invite has already been used.");
    }
    const userDoc = await t.get(centralRef);
    if (!userDoc.exists) {
      throw httpError(404, "User profile not found. Please sign in again.");
    }
    const userData = userDoc.data() || {};
    const existingPublicId = userData.publicUserId;
    const publicId = await ensurePublicUserId(db, safeUid, existingPublicId, t);
    const phoneLink = {
      userId: safeUid,
      publicUserId: publicId,
      phone: phoneInput,
      phoneHash: whatsappPhoneHash(phoneInput),
      verifiedAt: now,
      status: "active",
      services: {
        webetu: userData.services?.webetu === "subscribed",
        jobs: true,
      },
    };
    queuePhoneLinkCoreWrites(t as any, db, safeUid, phoneLink, now);
    queueJobScoutPhoneDeliveryUpdate(t as any, db, phoneLink);
    t.update(inviteRef, {
      status: "completed",
      usedBy: safeUid,
      usedAt: now,
    });
    t.update(centralRef, {
      "services.jobs": "subscribed",
      updatedAt: now,
    });
  });
  return { success: true };
}

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

  const [existingDoc, phoneDoc, userDoc, gmailConnection] = await Promise.all([
    profileRef.get(),
    db.collection("phoneLinksByUser").doc(safeUid).get(),
    db.collection("users").doc(safeUid).get(),
    getGmailConnection(db, safeUid),
  ]);
  const existing = existingDoc.exists ? existingDoc.data() || {} : {};
  const phoneData = phoneDoc.exists ? phoneDoc.data() || {} : {};
  const userData = userDoc.exists ? userDoc.data() || {} : {};
  if (!isActivePhoneLink(phoneData)) throw httpError(409, "The WhatsApp phone link is not active.");
  if (!gmailConnection.connected) {
    throw httpError(409, "Gmail is not connected.");
  }
  const senderEmail = String((userData.profile as any)?.email || "").trim()
    || gmailConnection.legacySenderEmail;
  if (!senderEmail) {
    throw httpError(409, "The linked user has no application email.");
  }

  const profileConfirmedAt = existing.profileConfirmedAt
    || (body.profileConfirmed === true ? FieldValue.serverTimestamp() : null);
  const safetyAcknowledgedAt = existing.safetyAcknowledgedAt
    || (body.safetyAcknowledged === true ? FieldValue.serverTimestamp() : null);
  if (!profileConfirmedAt) throw httpError(400, "Profile confirmation is required.");
  if (!safetyAcknowledgedAt) throw httpError(400, "Scam-safety acknowledgement is required.");

  await profileRef.set({
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
  }, { merge: true });
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

  const [applicationSnap, inviteSnap] = await Promise.all([
    db.collection("jobApplications").where("userId", "==", userId).get(),
    db.collection("jobScoutInvites").where("phoneHash", "==", hash).get(),
  ]);
  const applicationsDeleted = await deleteDocumentRefs(applicationSnap.docs.map((doc) => doc.ref));
  const pendingInviteRefs = inviteSnap.docs
    .filter((doc) => doc.data()?.status === "pending")
    .map((doc) => doc.ref);
  const invitesDeleted = await deleteDocumentRefs(pendingInviteRefs);

  return {
    ok: true,
    userId,
    phone,
    phoneHash: hash,
    profileDeleted,
    cvDeleted,
    applicationsDeleted,
    invitesDeleted,
  };
}

async function getGmailConnection(db: FirebaseFirestore.Firestore, uid: string) {
  const [canonicalDoc, legacyDoc] = await Promise.all([
    db.collection("credentialRefs").doc(credentialRefId(uid, "gmail", "oauth2")).get(),
    db.collection("credentialRefs").doc(`gmail_oauth_token_${uid}`).get(),
  ]);
  const canonicalData = canonicalDoc.exists ? canonicalDoc.data() || {} : {};
  const legacyData = legacyDoc.exists ? legacyDoc.data() || {} : {};
  const canonicalConnected = canonicalGmailCredentialIsActive(canonicalDoc.exists, canonicalData);
  const legacyConnected = legacyGmailCredentialIsActive(legacyDoc.exists, legacyData);
  return {
    connected: canonicalConnected || legacyConnected,
    legacySenderEmail: legacyConnected
      ? String(legacyData.metadata?.senderEmail || "").trim() || null
      : null,
  };
}

async function buildJobScoutSubscriber(uidInput: string, profile: Record<string, any>): Promise<any> {
  const uid = validateFirebaseUid(uidInput);
  const db = getFirestoreDb();
  const [phoneDoc, userDoc, gmailConnection] = await Promise.all([
    db.collection("phoneLinksByUser").doc(uid).get(),
    db.collection("users").doc(uid).get(),
    getGmailConnection(db, uid),
  ]);

  const phoneData = phoneDoc.exists ? phoneDoc.data() || {} : {};
  const userData = userDoc.exists ? userDoc.data() || {} : {};
  const rawPhone = isActivePhoneLink(phoneData) ? phoneData.phone : null;
  const phone = rawPhone ? normalizePhone(rawPhone) : null;
  const hash = phone ? whatsappPhoneHash(phone) : (phoneData.phoneHash as string | null | undefined) || null;
  const profileEmail = String((userData.profile as any)?.email || "").trim() || null;
  const gmailConnected = gmailConnection.connected;
  const senderEmail = gmailConnected
    ? profileEmail || gmailConnection.legacySenderEmail
    : null;
  const cvFileRef = String(profile.cvFileRef || "").trim();
  const cvAvailable = Boolean(cvFileRef && await objectExists(cvFileRef));
  const readiness = evaluateJobScoutReadiness({
    onboardingVersion: profile.onboardingVersion,
    preferences: profile.preferences,
    linked: Boolean(phone),
    gmailConnected,
    senderEmail,
    cvFileRef,
    cvAvailable,
    profileConfirmedAt: profile.profileConfirmedAt,
    safetyAcknowledgedAt: profile.safetyAcknowledgedAt,
  });

  return {
    ...profile,
    ...readiness,
    userId: uid,
    whatsappPhone: phone,
    whatsappPhoneHash: hash,
    gmailConnected,
    senderEmail,
    cvAvailable,
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

export async function getJobScoutStatusForUser(userIdInput: string) {
  const uid = validateFirebaseUid(userIdInput);
  const db = getFirestoreDb();
  const profileDoc = await db.collection("jobScoutProfiles").doc(uid).get();
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
