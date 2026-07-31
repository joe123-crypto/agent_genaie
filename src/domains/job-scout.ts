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

const CV_MAX_BYTES = 4 * 1024 * 1024;
const CV_HTML_MAX_BYTES = 4 * 1024 * 1024;
const APPLICATION_PDF_MAX_BYTES = 4 * 1024 * 1024;
const APPLICATION_TEXT_MAX_BYTES = 256 * 1024;
export const JOB_SCOUT_CV_SOURCE_VERSION = 1;

function storageSafeUid(uidInput: unknown) {
  const uid = validateFirebaseUid(uidInput);
  if (!/^[A-Za-z0-9._:@-]+$/.test(uid) || uid.includes("..")) {
    throw httpError(400, "User ID cannot be used in a storage path.");
  }
  return uid;
}

export function cvPendingObjectKey(uidInput: string) {
  return `${storageSafeUid(uidInput)}/cv/pending/original.pdf`;
}

export function cvHtmlObjectKey(uidInput: string) {
  return `${storageSafeUid(uidInput)}/cv/base/cv.html`;
}

function isUserCvObjectRef(value: unknown, uidInput: string) {
  const ref = String(value ?? "").trim();
  const prefix = `${storageSafeUid(uidInput)}/cv/`;
  return ref.startsWith(prefix) && ref.length > prefix.length && !ref.includes("..") && !ref.includes("\\");
}

// Transitional export retained for the existing migration script and any
// deployed callers. New PDF objects are pending conversion, not canonical CVs.
export function cvObjectKey(uidInput: string) {
  return cvPendingObjectKey(uidInput);
}

function normalizedContentType(value: unknown) {
  return String(value ?? "").toLowerCase().split(";")[0].trim();
}

function isPdf(bytes: Buffer) {
  return bytes.length >= 5 && bytes.subarray(0, 5).toString("ascii") === "%PDF-";
}

function decodeUtf8(bytes: Buffer, label: string) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw httpError(400, `${label} must be valid UTF-8.`);
  }
}

export function validateCanonicalCvHtml(bytes: Buffer) {
  if (!bytes.length) throw httpError(400, "CV file is required.");
  if (bytes.length > CV_HTML_MAX_BYTES) throw httpError(413, "CV HTML is too large (max 4 MB).");
  const html = decodeUtf8(bytes, "CV HTML");
  if (!/<html(?:\s|>)/i.test(html) || !/<body(?:\s|>)/i.test(html)) {
    throw httpError(400, "CV HTML must contain html and body elements.");
  }
  if (/<(?:script|iframe|object|embed|base)(?:\s|>)/i.test(html)) {
    throw httpError(400, "CV HTML contains an unsafe element.");
  }
  if (/\son[a-z]+\s*=/i.test(html) || /(?:href|src)\s*=\s*["']?\s*javascript:/i.test(html)) {
    throw httpError(400, "CV HTML contains executable content.");
  }
  if (/(?:href|src|srcset|poster|action)\s*=\s*["']?\s*(?:https?:)?\/\//i.test(html) || /(?:@import\s+(?:url\()?|url\()\s*["']?\s*(?:https?:)?\/\//i.test(html)) {
    throw httpError(400, "CV HTML must be self-contained.");
  }
  const visibleText = html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "\n")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
  const visibleLines = visibleText.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (visibleLines.some((line) => /^(?:file:\/\/|about:blank)/i.test(line))) {
    throw httpError(400, "CV HTML contains browser print chrome.");
  }
  if (visibleLines.some((line) => /^\d+\s*\/\s*\d+$/.test(line))) {
    throw httpError(400, "CV HTML contains a browser page counter.");
  }
  if (visibleLines.some((line) => /^\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}\s+(?:AM|PM)$/i.test(line))) {
    throw httpError(400, "CV HTML contains a browser print timestamp.");
  }
  return html;
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

  const suppliedCvRef = normalizeCvFileRef(
    body.cvHtmlRef ?? body.cvFileRef ?? existing.cvHtmlRef ?? existing.cvFileRef ?? existing.cvPendingRef,
  );
  const canonicalKey = cvHtmlObjectKey(safeUid);
  const pendingKey = cvPendingObjectKey(safeUid);
  const existingRefs = new Set(
    [existing.cvHtmlRef, existing.cvFileRef, existing.cvPendingRef]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean),
  );
  if (
    !isUserCvObjectRef(suppliedCvRef, safeUid)
    || (suppliedCvRef !== canonicalKey && suppliedCvRef !== pendingKey && !existingRefs.has(suppliedCvRef))
  ) {
    throw httpError(400, "CV reference does not belong to this user.");
  }
  if (!await dependencies.objectExists(suppliedCvRef)) {
    throw httpError(400, "The staged CV is not available.");
  }

  const suppliedCanonical = suppliedCvRef === canonicalKey;
  const existingCanonical = String(existing.cvHtmlRef ?? "").trim() === canonicalKey
    || String(existing.cvFileRef ?? "").trim() === canonicalKey;
  const cvHtmlRef = suppliedCanonical || existingCanonical ? canonicalKey : null;
  const cvPendingRef = cvHtmlRef
    ? null
    : suppliedCvRef;
  const cvConversionStatus = cvHtmlRef ? "ready" : "pending";
  const setupStatus = cvHtmlRef ? "ready" : "pending";

  const profilePayload = {
    userId: safeUid,
    preferences,
    // cvFileRef remains as the compatibility field but now always aliases the
    // canonical HTML reference. Pending/legacy PDFs live in cvPendingRef.
    cvFileRef: cvHtmlRef,
    cvHtmlRef,
    cvPendingRef,
    cvConversionStatus,
    cvSourceVersion: cvHtmlRef
      ? Number(existing.cvSourceVersion || JOB_SCOUT_CV_SOURCE_VERSION)
      : null,
    cvParsedText: body.cvParsedText ? String(body.cvParsedText).slice(0, 50000) : null,
    onboardingVersion: JOB_SCOUT_ONBOARDING_VERSION,
    setupStatus,
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
  const userPayload: Record<string, any> = {
    services: {
      jobs: "subscribed",
    },
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (
    cvHtmlRef
    && onboarding.selectedService === "jobs"
    && onboardingChannel === "chat"
    && (onboardingStatus === "required" || onboardingStatus === "in_progress")
  ) {
    userPayload.onboarding = {
      selectedService: "jobs",
      channel: "chat",
      status: "completed",
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
  }
  batch.set(db.collection("users").doc(safeUid), userPayload, { merge: true });
  await batch.commit();
  return {
    ok: true,
    setupStatus,
    ready: Boolean(cvHtmlRef),
    cvFileRef: cvHtmlRef,
    cvHtmlRef,
    cvPendingRef,
    cvConversionStatus,
  };
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
  const contentType = normalizedContentType(input.contentType);
  if (contentType !== "application/pdf") throw httpError(415, "CV must be a PDF (application/pdf).");
  if (!isPdf(input.bytes)) throw httpError(400, "CV content is not a valid PDF.");

  const key = cvPendingObjectKey(safeUid);
  await putObject(key, input.bytes, "application/pdf");

  const db = getFirestoreDb();
  const profileRef = db.collection("jobScoutProfiles").doc(safeUid);
  await db.runTransaction(async (t) => {
    const doc = await t.get(profileRef);
    if (doc.exists) {
      t.update(profileRef, {
        cvFileRef: null,
        cvHtmlRef: null,
        cvPendingRef: normalizeCvFileRef(key),
        cvConversionStatus: "pending",
        cvSourceVersion: null,
        cvConvertedAt: null,
        // The previous extraction no longer matches the new file; clear it so
        // stale personal data isn't retained until the worker re-parses.
        cvParsedText: null,
        setupStatus: "pending",
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      t.set(profileRef, {
        userId: safeUid,
        preferences: normalizeJobPreferences(undefined),
        cvFileRef: null,
        cvHtmlRef: null,
        cvPendingRef: normalizeCvFileRef(key),
        cvConversionStatus: "pending",
        cvSourceVersion: null,
        cvConvertedAt: null,
        cvParsedText: null,
        onboardingVersion: JOB_SCOUT_ONBOARDING_VERSION,
        setupStatus: "pending",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  });
  // A replacement PDF must pause scouting immediately. The canonical path is
  // deterministic, so deletion is safe even when an older profile omitted its
  // cvHtmlRef field.
  await deleteObject(cvHtmlObjectKey(safeUid));
  return {
    ok: true,
    key,
    cvPendingRef: key,
    cvFileRef: null,
    cvHtmlRef: null,
    cvConversionStatus: "pending" as const,
  };
}

export async function finalizeJobScoutCvHtml(input: {
  userId?: string;
  phone?: string;
  bytes: Buffer;
  contentType?: string;
}) {
  const resolvedUid = input.userId ?? (input.phone ? await findJobScoutUserByPhone(input.phone) : null);
  if (!resolvedUid) throw httpError(404, "Linked Job Scout user not found.");
  const safeUid = validateFirebaseUid(resolvedUid);
  const contentType = normalizedContentType(input.contentType);
  if (contentType !== "text/html") throw httpError(415, "Canonical CV must be HTML (text/html).");
  validateCanonicalCvHtml(input.bytes);

  const key = cvHtmlObjectKey(safeUid);
  const pendingKey = cvPendingObjectKey(safeUid);
  await putObject(key, input.bytes, "text/html; charset=utf-8");

  const db = getFirestoreDb();
  const profileRef = db.collection("jobScoutProfiles").doc(safeUid);
  const profileDoc = await profileRef.get();
  const existing = profileDoc.exists ? profileDoc.data() || {} : {};
  const previousPendingRef = String(existing.cvPendingRef || "").trim();
  const profilePayload: Record<string, any> = {
    userId: safeUid,
    cvFileRef: key,
    cvHtmlRef: key,
    cvPendingRef: null,
    cvConversionStatus: "ready",
    cvSourceVersion: JOB_SCOUT_CV_SOURCE_VERSION,
    cvConvertedAt: FieldValue.serverTimestamp(),
    cvParsedText: null,
    setupStatus: "ready",
    createdAt: existing.createdAt || FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  // Preserve legacy readiness grandfathering during manual migration. A brand
  // new admin-created profile uses the current onboarding contract.
  if (!profileDoc.exists) profilePayload.onboardingVersion = JOB_SCOUT_ONBOARDING_VERSION;
  await profileRef.set(profilePayload, { merge: true });

  await deleteObject(pendingKey);
  if (
    previousPendingRef
    && previousPendingRef !== pendingKey
    && previousPendingRef !== key
    && isUserCvObjectRef(previousPendingRef, safeUid)
  ) {
    await deleteObject(previousPendingRef);
  }

  const status = await getJobScoutStatusForUser(safeUid).catch(() => null);
  if (status && status.setupStatus !== "ready") {
    await profileRef.update({
      setupStatus: status.setupStatus,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  if (status?.ready) {
    const userRef = db.collection("users").doc(safeUid);
    const userDoc = await userRef.get();
    const onboarding = userDoc.exists ? userDoc.data()?.onboarding || {} : {};
    const onboardingStatus = String(onboarding.status ?? "");
    if (onboarding.selectedService === "jobs") {
      const userPayload: Record<string, any> = {
        services: {
          jobs: "subscribed",
        },
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (onboardingStatus === "required" || onboardingStatus === "in_progress") {
        userPayload.onboarding = {
          selectedService: "jobs",
          channel: storedOnboardingChannel(onboarding.channel) || "web",
          status: "completed",
          completedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        };
      }
      await userRef.set(userPayload, { merge: true });
    }
  }

  return {
    ok: true,
    key,
    cvFileRef: key,
    cvHtmlRef: key,
    cvPendingRef: null,
    cvConversionStatus: "ready" as const,
    ready: Boolean(status?.ready),
  };
}

export type JobScoutCvFormat = "html" | "pending";

export async function getJobScoutCvUrl(
  userIdInput: string,
  formatInput: JobScoutCvFormat | "pdf" = "html",
) {
  const safeUid = validateFirebaseUid(userIdInput);
  const db = getFirestoreDb();
  const doc = await db.collection("jobScoutProfiles").doc(safeUid).get();
  const profile = doc.exists ? doc.data() || {} : {};
  const format: JobScoutCvFormat = formatInput === "pdf" ? "pending" : formatInput;
  if (format !== "html" && format !== "pending") throw httpError(400, "format must be html or pending.");
  const canonicalKey = cvHtmlObjectKey(safeUid);
  const canonicalRef = String(profile.cvHtmlRef || profile.cvFileRef || "").trim();
  const legacyPdfRef = String(profile.cvFileRef || "").trim().toLowerCase().endsWith(".pdf")
    ? String(profile.cvFileRef).trim()
    : "";
  const pendingRef = String(profile.cvPendingRef || legacyPdfRef || "").trim();
  const key = format === "html" && canonicalRef === canonicalKey ? canonicalRef : format === "pending" ? pendingRef : "";
  if (!key) {
    throw httpError(404, format === "html" ? "No canonical HTML CV on file." : "No pending PDF CV on file.");
  }
  // Presigning never checks existence, so verify the object is actually in R2 —
  // otherwise a stale cvFileRef would yield a URL that 404s on download and let
  // readiness checks pass falsely.
  if (!(await objectExists(key))) throw httpError(404, "CV file is missing from storage.");
  const expiresIn = 300;
  const url = await getPresignedGetUrl(key, expiresIn);
  return {
    url,
    key,
    expiresIn,
    format,
    contentType: format === "html" ? "text/html" : "application/pdf",
    conversionStatus: String(profile.cvConversionStatus || (format === "html" ? "ready" : "pending")),
  };
}

export async function getJobScoutCvFileRef(userIdInput: string) {
  const safeUid = validateFirebaseUid(userIdInput);
  const db = getFirestoreDb();
  const doc = await db.collection("jobScoutProfiles").doc(safeUid).get();
  const data = doc.exists ? doc.data() || {} : {};
  const cvFileRef = String(data.cvHtmlRef || data.cvFileRef || data.cvPendingRef || "").trim();
  return cvFileRef || null;
}

export async function deleteJobScoutCv(userIdInput: string) {
  const safeUid = validateFirebaseUid(userIdInput);
  const db = getFirestoreDb();
  const profileRef = db.collection("jobScoutProfiles").doc(safeUid);
  const doc = await profileRef.get();
  const profile = doc.exists ? doc.data() || {} : {};
  const refs = new Set([
    cvHtmlObjectKey(safeUid),
    cvPendingObjectKey(safeUid),
    ...[profile.cvFileRef, profile.cvHtmlRef, profile.cvPendingRef]
      .map((value) => String(value || "").trim())
      .filter((value) => isUserCvObjectRef(value, safeUid)),
  ].filter(Boolean));
  for (const ref of refs) await deleteObject(ref);
  if (!doc.exists) return { ok: true, deletedObjects: refs.size };
  await profileRef.update({
    cvFileRef: null,
    cvHtmlRef: null,
    cvPendingRef: null,
    cvConversionStatus: "missing",
    cvSourceVersion: null,
    cvConvertedAt: null,
    cvParsedText: null,
    setupStatus: "draft",
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { ok: true, deletedObjects: refs.size };
}

function applicationArtifactRefsFromRecord(
  userIdInput: string,
  applicationIdInput: string,
  record: Record<string, any>,
) {
  const refs = new Set<string>();
  const prefix = `${storageSafeUid(userIdInput)}/applications/${normalizeApplicationId(applicationIdInput)}/`;
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      const ref = value.trim();
      if (ref.startsWith(prefix) && isValidApplicationArtifactRef(ref, userIdInput, applicationIdInput)) {
        refs.add(ref);
      }
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const nested of Object.values(value as Record<string, unknown>)) visit(nested);
  };
  visit(record.artifactRefs);
  visit(record.artifacts);
  return refs;
}

const JOB_APPLICATION_SNAPSHOT_FIELDS = [
  "candidateId",
  "agentCandidateId",
  "source",
  "sourceUrl",
  "sourcePostUrl",
  "sourceChannelJid",
  "sourcePostId",
  "company",
  "role",
  "location",
  "description",
  "closing",
  "applicationEmail",
] as const;

function normalizeJobApplicationCandidateSnapshot(
  input: unknown,
  fallback: Record<string, unknown>,
) {
  const source = input && typeof input === "object"
    ? input as Record<string, unknown>
    : {};
  const snapshot: Record<string, unknown> = {};
  for (const field of JOB_APPLICATION_SNAPSHOT_FIELDS) {
    const fallbackValue = fallback[field];
    const value = source[field] ?? fallbackValue;
    const limit = field === "description" ? 8000 : field.includes("Url") ? 2000 : 500;
    const text = String(value ?? "").trim().slice(0, limit);
    if (text) snapshot[field] = text;
  }
  for (const field of ["applyLinks", "applicationEmails"] as const) {
    const values = normalizeStringList(source[field]).slice(0, 10);
    if (values.length) snapshot[field] = values.map((value) => value.slice(0, 2000));
  }
  return snapshot;
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

  const applicationSnap = await db.collection("jobApplications").where("userId", "==", userId).get();
  const storageRefs = new Set<string>([
    cvHtmlObjectKey(userId),
    cvPendingObjectKey(userId),
  ]);

  if (profileDoc.exists) {
    const profile = profileDoc.data() || {};
    for (const ref of [profile.cvFileRef, profile.cvHtmlRef, profile.cvPendingRef]) {
      const value = String(ref || "").trim();
      if (isUserCvObjectRef(value, userId)) storageRefs.add(value);
    }
  }
  for (const doc of applicationSnap.docs) {
    for (const ref of applicationArtifactRefsFromRecord(userId, doc.id, doc.data())) storageRefs.add(ref);
  }
  for (const ref of storageRefs) await dependencies.deleteObject(ref);
  cvDeleted = storageRefs.size > 0;

  if (profileDoc.exists) {
    await profileRef.delete();
    profileDeleted = true;
  }
  const applicationsDeleted = await deleteDocumentRefs(applicationSnap.docs.map((doc) => doc.ref));

  return {
    ok: true,
    userId,
    phone,
    phoneHash: hash,
    profileDeleted,
    cvDeleted,
    storageObjectsDeleted: storageRefs.size,
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
  const canonicalKey = cvHtmlObjectKey(uid);
  const storedCanonicalRef = String(profile.cvHtmlRef || profile.cvFileRef || "").trim();
  const cvHtmlRef = storedCanonicalRef === canonicalKey ? canonicalKey : null;
  const legacyPdfRef = String(profile.cvFileRef || "").trim().toLowerCase().endsWith(".pdf")
    ? String(profile.cvFileRef).trim()
    : null;
  const cvPendingRef = String(profile.cvPendingRef || legacyPdfRef || "").trim() || null;
  const storedConversionStatus = String(profile.cvConversionStatus || "").trim().toLowerCase();
  const cvConversionStatus = storedConversionStatus === "ready" && cvHtmlRef
    ? "ready"
    : cvPendingRef
      ? "pending"
      : cvHtmlRef
        ? "ready"
        : "missing";
  const [canonicalAvailable, pendingAvailable] = await Promise.all([
    cvHtmlRef ? dependencies.objectExists(cvHtmlRef) : Promise.resolve(false),
    cvPendingRef ? dependencies.objectExists(cvPendingRef) : Promise.resolve(false),
  ]);
  const cvAvailable = Boolean(cvConversionStatus === "ready" && cvHtmlRef && canonicalAvailable);
  const cvUploaded = cvAvailable || Boolean(cvPendingRef && pendingAvailable);
  const readiness = evaluateJobScoutReadiness({
    onboardingVersion: profile.onboardingVersion,
    preferences: profile.preferences,
    gmailConnected,
    senderEmail,
    cvFileRef: cvHtmlRef,
    cvHtmlRef,
    cvConversionStatus,
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
    cvFileRef: cvHtmlRef,
    cvHtmlRef,
    cvPendingRef,
    cvConversionStatus,
    cvAvailable,
    cvUploaded,
    subscriptionStatus: userData.services?.jobs === "subscribed" ? "subscribed" : "not_subscribed",
    onboardingChannel,
    onboardingStatus,
    onboardingNextStep,
    profile: {
      email: profileEmail,
      displayName: (userData.profile as any)?.displayName || null,
    },
  };
}

export type JobScoutSubscriberFilter = "ready" | "pending_conversion";

export async function listJobScoutSubscribers(
  limitInput: number,
  statusFilter: JobScoutSubscriberFilter = "ready",
) {
  const limit = Number.isFinite(limitInput) ? Math.max(1, Math.min(limitInput, 100)) : 50;
  const db = getFirestoreDb();
  const profiles = db.collection("jobScoutProfiles");
  const snap = statusFilter === "pending_conversion"
    ? await profiles.where("cvConversionStatus", "==", "pending").limit(limit).get()
    : await profiles.limit(limit).get();

  const subscribers = await Promise.all(
    snap.docs.map((doc) => buildJobScoutSubscriber(doc.id, doc.data())),
  );
  if (statusFilter === "pending_conversion") {
    // Profiles whose CV still awaits PDF -> canonical HTML conversion. The
    // conversion worker consumes this list; other readiness gaps are fine
    // because converting early never hurts.
    return subscribers.filter(
      (subscriber) => subscriber.cvConversionStatus === "pending" && subscriber.cvPendingRef,
    );
  }
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
    cvUploaded: subscriber.cvUploaded,
    cvFileRef: subscriber.cvFileRef,
    cvHtmlRef: subscriber.cvHtmlRef,
    cvPendingRef: subscriber.cvPendingRef,
    cvConversionStatus: subscriber.cvConversionStatus,
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
      autoApply: preferences.autoApply === true,
      maxApplicationsPerRun: preferences.maxApplicationsPerRun ?? 1,
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
    cvUploaded: subscriber.cvUploaded,
    cvFileRef: subscriber.cvFileRef,
    cvHtmlRef: subscriber.cvHtmlRef,
    cvPendingRef: subscriber.cvPendingRef,
    cvConversionStatus: subscriber.cvConversionStatus,
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
      autoApply: preferences.autoApply === true,
      maxApplicationsPerRun: preferences.maxApplicationsPerRun ?? 1,
    },
  };
}

export async function listJobApplications(userIdInput: string) {
  const safeUid = validateFirebaseUid(userIdInput);
  const db = getFirestoreDb();
  const snap = await db.collection("jobApplications").where("userId", "==", safeUid).get();
  return snap.docs.map((doc) => doc.data());
}

export async function listJobApplicationsByStatus(
  statusInput: string,
  limitInput: unknown = 100,
) {
  const status = String(statusInput ?? "").trim();
  if (status !== "approved") {
    throw httpError(400, "status must be approved.");
  }
  const limit = Number(limitInput);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw httpError(400, "limit must be an integer between 1 and 100.");
  }
  const db = getFirestoreDb();
  const snap = await db
    .collection("jobApplications")
    .where("status", "==", status)
    .limit(limit)
    .get();
  return snap.docs.map((doc) => doc.data());
}

export type JobApplicationArtifactKind = "cv" | "cover_letter_text" | "cover_letter_pdf";

const APPLICATION_ARTIFACTS: Record<JobApplicationArtifactKind, {
  fileName: string;
  contentType: string;
  field: "cv" | "coverLetterText" | "coverLetterPdf";
  maxBytes: number;
}> = {
  cv: {
    fileName: "cv.pdf",
    contentType: "application/pdf",
    field: "cv",
    maxBytes: APPLICATION_PDF_MAX_BYTES,
  },
  cover_letter_text: {
    fileName: "cover-letter.txt",
    contentType: "text/plain",
    field: "coverLetterText",
    maxBytes: APPLICATION_TEXT_MAX_BYTES,
  },
  cover_letter_pdf: {
    fileName: "cover-letter.pdf",
    contentType: "application/pdf",
    field: "coverLetterPdf",
    maxBytes: APPLICATION_PDF_MAX_BYTES,
  },
};

function normalizeApplicationId(value: unknown) {
  const id = String(value ?? "").trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw httpError(400, "applicationId is invalid.");
  return id;
}

function normalizeArtifactAttempt(value: unknown) {
  const attempt = Number(value);
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 3) {
    throw httpError(400, "attempt must be an integer from 1 to 3.");
  }
  return attempt;
}

function normalizeArtifactKind(value: unknown): JobApplicationArtifactKind {
  const kind = String(value ?? "").trim() as JobApplicationArtifactKind;
  if (!Object.hasOwn(APPLICATION_ARTIFACTS, kind)) throw httpError(400, "kind is invalid.");
  return kind;
}

export function applicationArtifactObjectKey(input: {
  userId: string;
  applicationId: string;
  attempt: number;
  kind: JobApplicationArtifactKind;
}) {
  const uid = storageSafeUid(input.userId);
  const applicationId = normalizeApplicationId(input.applicationId);
  const attempt = normalizeArtifactAttempt(input.attempt);
  const kind = normalizeArtifactKind(input.kind);
  return `${uid}/applications/${applicationId}/${attempt}/${APPLICATION_ARTIFACTS[kind].fileName}`;
}

function isValidApplicationArtifactRef(
  value: unknown,
  userId: string,
  applicationId: string,
) {
  const ref = String(value ?? "").trim();
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    for (const kind of Object.keys(APPLICATION_ARTIFACTS) as JobApplicationArtifactKind[]) {
      if (ref === applicationArtifactObjectKey({ userId, applicationId, attempt, kind })) return true;
    }
  }
  return false;
}

function normalizedArtifactRefs(
  value: unknown,
  userId: string,
  applicationId: string,
) {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const attempt = normalizeArtifactAttempt(input.attempt);
  const output: Record<string, string | number> = { attempt };
  const fields = [
    ["cv", "cv"],
    ["coverLetterText", "cover_letter_text"],
    ["coverLetterPdf", "cover_letter_pdf"],
  ] as const;
  for (const [field, kind] of fields) {
    const ref = String(input[field] ?? "").trim();
    if (!ref) continue;
    const expected = applicationArtifactObjectKey({ userId, applicationId, attempt, kind });
    if (ref !== expected) throw httpError(400, `${field} artifact reference is invalid.`);
    output[field] = ref;
  }
  if (Object.keys(output).length === 1) throw httpError(400, "artifactRefs must include at least one file reference.");
  return output;
}

export async function saveJobApplicationArtifact(input: {
  userId: string;
  applicationId: string;
  attempt: number;
  kind: JobApplicationArtifactKind;
  bytes: Buffer;
  contentType?: string;
}) {
  const safeUid = validateFirebaseUid(input.userId);
  const applicationId = normalizeApplicationId(input.applicationId);
  const attempt = normalizeArtifactAttempt(input.attempt);
  const kind = normalizeArtifactKind(input.kind);
  const spec = APPLICATION_ARTIFACTS[kind];
  if (!input.bytes.length) throw httpError(400, "Artifact file is required.");
  if (input.bytes.length > spec.maxBytes) {
    const size = spec.contentType === "text/plain" ? "256 KB" : "4 MB";
    throw httpError(413, `Artifact is too large (max ${size}).`);
  }
  const contentType = normalizedContentType(input.contentType);
  if (contentType !== spec.contentType) {
    throw httpError(415, `Artifact must use ${spec.contentType}.`);
  }
  if (contentType === "application/pdf" && !isPdf(input.bytes)) {
    throw httpError(400, "Artifact content is not a valid PDF.");
  }
  if (contentType === "text/plain") {
    const text = decodeUtf8(input.bytes, "Cover letter");
    if (!text.trim() || text.includes("\0")) throw httpError(400, "Cover letter text is invalid.");
  }

  const db = getFirestoreDb();
  const applicationRef = db.collection("jobApplications").doc(applicationId);
  const applicationDoc = await applicationRef.get();
  if (!applicationDoc.exists) throw httpError(404, "Application record not found.");
  if (String(applicationDoc.data()?.userId || "") !== safeUid) {
    throw httpError(403, "Application does not belong to this user.");
  }

  const key = applicationArtifactObjectKey({ userId: safeUid, applicationId, attempt, kind });
  await putObject(key, input.bytes, spec.contentType === "text/plain" ? "text/plain; charset=utf-8" : spec.contentType);
  try {
    await db.runTransaction(async (t) => {
      const currentDoc = await t.get(applicationRef);
      if (!currentDoc.exists) throw httpError(404, "Application record not found.");
      const current = currentDoc.data() || {};
      if (String(current.userId || "") !== safeUid) {
        throw httpError(403, "Application does not belong to this user.");
      }
      const artifacts = current.artifacts && typeof current.artifacts === "object"
        ? { ...current.artifacts }
        : {};
      const attemptArtifacts = artifacts[String(attempt)] && typeof artifacts[String(attempt)] === "object"
        ? { ...artifacts[String(attempt)] }
        : {};
      attemptArtifacts[spec.field] = key;
      attemptArtifacts.attempt = attempt;
      artifacts[String(attempt)] = attemptArtifacts;

      const previousLatestAttempt = Number(current.artifactRefs?.attempt || 0);
      const artifactRefs = previousLatestAttempt === attempt && current.artifactRefs && typeof current.artifactRefs === "object"
        ? { ...current.artifactRefs, attempt, [spec.field]: key }
        : previousLatestAttempt > attempt
          ? current.artifactRefs
          : { attempt, [spec.field]: key };
      t.update(applicationRef, {
        artifacts,
        artifactRefs,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  } catch (err) {
    await deleteObject(key).catch(() => undefined);
    throw err;
  }
  return { ok: true, key, artifactRef: key, applicationId, attempt, kind };
}

export async function recordJobApplication(body: any) {
  const safeUid = validateFirebaseUid(body.userId);
  const company = String(body.company ?? "").trim();
  const role = String(body.role ?? "").trim();
  if (!company) throw httpError(400, "company is required.");
  if (!role) throw httpError(400, "role is required.");
  const status = String(body.status ?? "applied").trim();
  if (!["applied", "skipped", "action_required", "physical_submission", "failed", "pending_approval", "approved"].includes(status)) {
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
  const candidateSnapshot = normalizeJobApplicationCandidateSnapshot(body.candidateSnapshot, {
    company,
    role,
    source,
    sourceUrl,
    closing,
    applicationEmail,
  });
  const replace = body.replace === true;
  const db = getFirestoreDb();
  const id = jobApplicationId(safeUid, company, role);
  if (body.applicationId && normalizeApplicationId(body.applicationId) !== id) {
    throw httpError(400, "applicationId does not match the application identity.");
  }
  const artifactRefs = body.artifactRefs == null
    ? null
    : normalizedArtifactRefs(body.artifactRefs, safeUid, id);
  const docRef = db.collection("jobApplications").doc(id);
  const now = FieldValue.serverTimestamp();
  let created = false;
  let updated = false;
  await db.runTransaction(async (t) => {
    const doc = await t.get(docRef);
    const payload: Record<string, any> = {
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
      candidateSnapshot,
      appliedAt: status === "applied" ? now : null,
      updatedAt: now,
    };
    if (artifactRefs) {
      payload.artifactRefs = artifactRefs;
      payload.artifacts = { [String(artifactRefs.attempt)]: artifactRefs };
    }
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

// User-facing approve/reject for applications the agent surfaced but did not
// auto-submit (auto-apply off). Only records still awaiting approval may move,
// which guards against double-approval or racing the agent's dispatch loop.
export async function decideJobApplication(input: {
  userId: string;
  applicationId: string;
  decision: "approve" | "reject";
}) {
  const safeUid = validateFirebaseUid(input.userId);
  const applicationId = normalizeApplicationId(input.applicationId);
  if (input.decision !== "approve" && input.decision !== "reject") {
    throw httpError(400, "decision must be approve or reject.");
  }
  const status = input.decision === "approve" ? "approved" : "skipped";
  const db = getFirestoreDb();
  const docRef = db.collection("jobApplications").doc(applicationId);
  await db.runTransaction(async (t) => {
    const doc = await t.get(docRef);
    if (!doc.exists) throw httpError(404, "Application not found.");
    const data = doc.data() || {};
    if (data.userId !== safeUid) throw httpError(403, "You cannot change this application.");
    if (data.status !== "pending_approval") {
      throw httpError(409, "This application is no longer awaiting approval.");
    }
    t.update(docRef, { status, updatedAt: FieldValue.serverTimestamp() });
  });
  return { ok: true, id: applicationId, status };
}
