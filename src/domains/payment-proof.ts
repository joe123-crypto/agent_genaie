import crypto from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { getFirestoreDb } from "@/src/firebase/admin";
import { getObjectBytes, putObject } from "@/src/domains/r2-storage";
import { buildCvHtml, type CvInput } from "@/src/domains/cv-html";
import { finalizeJobScoutCvHtml } from "@/src/domains/job-scout";
import { signState, verifyState } from "@/src/security/crypto";
import { httpError, validateFirebaseUid } from "@/src/lib/utils";

// Manual-transfer payment methods surfaced on /payment. The screenshot the payer
// uploads is proof they completed one of these transfers.
export type PaymentMethod = "EcoCash" | "Poste";

const PAYMENT_METHODS: readonly PaymentMethod[] = ["EcoCash", "Poste"];

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === "string" && (PAYMENT_METHODS as readonly string[]).includes(value);
}

// Validate an arbitrary form value into a PaymentMethod, throwing on anything else.
export function assertPaymentMethod(value: unknown): PaymentMethod {
  if (!isPaymentMethod(value)) {
    throw httpError(400, "method must be one of: EcoCash, Poste.");
  }
  return value;
}

export const PROOF_MAX_BYTES = 5 * 1024 * 1024;

export type ProofImageType = "image/png" | "image/jpeg" | "image/webp";

export const ALLOWED_PROOF_CONTENT_TYPES: readonly ProofImageType[] = [
  "image/png",
  "image/jpeg",
  "image/webp",
];

const PROOF_EXTENSION: Record<ProofImageType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

// Sniff the real image type from magic bytes, mirroring isPdf() in job-scout.ts.
// A declared content type is never trusted; the bytes decide.
export function detectImageType(bytes: Buffer): ProofImageType | null {
  if (bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 12
    && bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return null;
}

function proofExtension(contentType: ProofImageType): string {
  return PROOF_EXTENSION[contentType];
}

// R2 keys are deterministic per proof so a reviewer link never needs the key.
function screenshotObjectKey(uid: string, proofId: string, contentType: ProofImageType): string {
  return `${uid}/payment-proof/${proofId}.${proofExtension(contentType)}`;
}

function cvObjectKey(uid: string, proofId: string): string {
  return `${uid}/payment-proof/${proofId}-cv.html`;
}

export type PaymentProofPayer = {
  name?: string;
  email?: string;
  phone?: string;
};

export type PaymentProofRecord = {
  uid: string;
  method: PaymentMethod;
  payerName: string;
  payerEmail: string;
  payerPhone: string;
  screenshotKey: string;
  screenshotContentType: ProofImageType;
  cvKey: string;
  status: "pending" | "approved" | "denied";
  [key: string]: unknown;
};

export async function createPaymentProof(input: {
  uid: string;
  method: PaymentMethod;
  cvInput: CvInput;
  screenshotBytes: Buffer;
  screenshotContentType: ProofImageType;
  payer: PaymentProofPayer;
}): Promise<{ proofId: string }> {
  const uid = validateFirebaseUid(input.uid);
  const method = assertPaymentMethod(input.method);
  // buildCvHtml validates the draft (non-empty fullName) and escapes every value;
  // it throws httpError(400,...) on bad input, so an invalid CV never reaches R2.
  const html = buildCvHtml(input.cvInput);

  const proofId = crypto.randomUUID();
  const screenshotKey = screenshotObjectKey(uid, proofId, input.screenshotContentType);
  const cvKey = cvObjectKey(uid, proofId);

  await putObject(screenshotKey, input.screenshotBytes, input.screenshotContentType);
  await putObject(cvKey, Buffer.from(html, "utf8"), "text/html; charset=utf-8");

  const db = getFirestoreDb();
  await db.collection("paymentProofs").doc(proofId).set({
    uid,
    method,
    payerName: String(input.payer.name ?? ""),
    payerEmail: String(input.payer.email ?? ""),
    payerPhone: String(input.payer.phone ?? ""),
    screenshotKey,
    screenshotContentType: input.screenshotContentType,
    cvKey,
    status: "pending",
    createdAt: FieldValue.serverTimestamp(),
  });

  return { proofId };
}

export async function loadPaymentProof(proofId: string): Promise<PaymentProofRecord | null> {
  const db = getFirestoreDb();
  const doc = await db.collection("paymentProofs").doc(String(proofId)).get();
  if (!doc.exists) return null;
  return (doc.data() as PaymentProofRecord) ?? null;
}

export async function approvePaymentProof(proofId: string): Promise<"pending" | "approved" | "denied"> {
  const db = getFirestoreDb();
  const ref = db.collection("paymentProofs").doc(String(proofId));
  const doc = await ref.get();
  if (!doc.exists) throw httpError(404, "Payment proof not found.");
  const data = doc.data() as PaymentProofRecord;
  // Idempotent: a second Approve (or a decision after Deny) returns the settled
  // status without re-creating the CV.
  if (data.status !== "pending") return data.status;

  // The CV was built and stored at upload time; approval is what actually creates
  // it for the user via the canonical finalize path.
  const bytes = await getObjectBytes(data.cvKey);
  await finalizeJobScoutCvHtml({ userId: data.uid, bytes, contentType: "text/html" });

  await ref.update({ status: "approved", decidedAt: FieldValue.serverTimestamp() });
  return "approved";
}

export async function denyPaymentProof(proofId: string): Promise<"pending" | "approved" | "denied"> {
  const db = getFirestoreDb();
  const ref = db.collection("paymentProofs").doc(String(proofId));
  const doc = await ref.get();
  if (!doc.exists) throw httpError(404, "Payment proof not found.");
  const data = doc.data() as PaymentProofRecord;
  if (data.status !== "pending") return data.status;

  await ref.update({ status: "denied", decidedAt: FieldValue.serverTimestamp() });
  return "denied";
}

const REVIEW_TOKEN_PURPOSE = "payment-proof";

// HMAC-signed, tamper-proof review token embedded in the admin email link.
export function paymentProofReviewToken(proofId: string): string {
  return signState({ proofId: String(proofId), purpose: REVIEW_TOKEN_PURPOSE });
}

export function verifyPaymentProofToken(token: string): string {
  const payload = verifyState(String(token || "")) as { proofId?: unknown; purpose?: unknown };
  if (payload.purpose !== REVIEW_TOKEN_PURPOSE || !payload.proofId) {
    throw httpError(400, "Invalid review token.");
  }
  return String(payload.proofId);
}

export function proofScreenshotFilename(contentType: ProofImageType): string {
  return `payment-proof.${proofExtension(contentType)}`;
}

// True once the user has at least one approved payment proof. Approval is what
// finalizes the canonical CV HTML, and manually-paid users may have no `plan`, so
// approval (not a plan) is the access gate for everything CV-download related.
// Deliberately module-private: callers want cvDownloadState(), which also accounts
// for whether there is actually a CV to hand over.
async function hasApprovedPaymentProof(uidInput: string): Promise<boolean> {
  const uid = validateFirebaseUid(uidInput);
  const snapshot = await getFirestoreDb()
    .collection("paymentProofs")
    .where("uid", "==", uid)
    .where("status", "==", "approved")
    .limit(1)
    .get();
  return !snapshot.empty;
}

type JobScoutProfileFields = {
  cvConversionStatus?: unknown;
  cvPdfDownloadedAt?: unknown;
  cvDownloadPromptedAt?: unknown;
};

async function readJobScoutProfile(uid: string): Promise<JobScoutProfileFields> {
  const doc = await getFirestoreDb().collection("jobScoutProfiles").doc(uid).get();
  return doc.exists ? (doc.data() as JobScoutProfileFields) || {} : {};
}

// Matches the normalization job-scout.ts applies when it reads the same field.
function isProfileCvReady(profile: JobScoutProfileFields): boolean {
  return String(profile.cvConversionStatus ?? "").trim().toLowerCase() === "ready";
}

// Why a CV download is or isn't available. Callers need the distinction: an
// unapproved user belongs on /payment, but an approved user whose CV went back to
// `pending` (they uploaded a replacement PDF, which deletes the canonical HTML)
// needs to be told to wait, not sent to pay again.
export type CvDownloadState = "ready" | "not_approved" | "cv_not_ready";

// The single gate for the download page and the PDF route. Both must agree, or a
// user can reach a page whose download can only fail.
export async function cvDownloadState(uidInput: string): Promise<CvDownloadState> {
  const uid = validateFirebaseUid(uidInput);
  if (!(await hasApprovedPaymentProof(uid))) return "not_approved";
  return isProfileCvReady(await readJobScoutProfile(uid)) ? "ready" : "cv_not_ready";
}

// Records that the user has downloaded their CV PDF at least once.
export async function markCvPdfDownloaded(uidInput: string): Promise<void> {
  const uid = validateFirebaseUid(uidInput);
  await getFirestoreDb()
    .collection("jobScoutProfiles")
    .doc(uid)
    .set({ cvPdfDownloadedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

// Records that we have shown the user the download page. This is what actually
// retires the one-time post-login nudge: keying it off the download alone would
// re-hijack every future sign-in of anyone who opened the page and did not click,
// or who hit a render failure, with no way to reach the rest of the app.
export async function markCvDownloadPrompted(uidInput: string): Promise<void> {
  const uid = validateFirebaseUid(uidInput);
  const ref = getFirestoreDb().collection("jobScoutProfiles").doc(uid);
  // The page re-renders on every visit and refresh; only the first one is news.
  const doc = await ref.get();
  if (doc.exists && (doc.data() || {}).cvDownloadPromptedAt) return;
  await ref.set(
    { cvDownloadPromptedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
}

// Drives the one-time post-login nudge to the download page. Runs on every single
// sign-in, so it is ordered cheapest-first: one profile doc read rejects the vast
// majority of users, and only a genuine candidate pays for the paymentProofs query.
export async function isCvDownloadPending(uidInput: string): Promise<boolean> {
  const uid = validateFirebaseUid(uidInput);
  const profile = await readJobScoutProfile(uid);
  if (profile.cvPdfDownloadedAt || profile.cvDownloadPromptedAt) return false;
  if (!isProfileCvReady(profile)) return false;
  return hasApprovedPaymentProof(uid);
}
