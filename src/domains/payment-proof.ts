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

// True once the user has at least one approved payment proof. This is the gate
// for the CV download page — approval is what finalizes the canonical CV HTML,
// and these users may have no `plan`, so approval (not a plan) is the right check.
export async function hasApprovedPaymentProof(uidInput: string): Promise<boolean> {
  const uid = validateFirebaseUid(uidInput);
  const snapshot = await getFirestoreDb()
    .collection("paymentProofs")
    .where("uid", "==", uid)
    .where("status", "==", "approved")
    .limit(1)
    .get();
  return !snapshot.empty;
}

// Records that the user has downloaded their CV PDF at least once. The timestamp
// is what turns the one-time post-login redirect off (see isCvDownloadPending).
export async function markCvPdfDownloaded(uidInput: string): Promise<void> {
  const uid = validateFirebaseUid(uidInput);
  await getFirestoreDb()
    .collection("jobScoutProfiles")
    .doc(uid)
    .set({ cvPdfDownloadedAt: FieldValue.serverTimestamp() }, { merge: true });
}

// Drives the one-time post-login nudge to the download page: the user is approved,
// their CV HTML is ready, and they have not yet downloaded the PDF. Once they do,
// markCvPdfDownloaded() sets cvPdfDownloadedAt and this returns false thereafter.
export async function isCvDownloadPending(uidInput: string): Promise<boolean> {
  const uid = validateFirebaseUid(uidInput);
  if (!(await hasApprovedPaymentProof(uid))) return false;
  const doc = await getFirestoreDb().collection("jobScoutProfiles").doc(uid).get();
  const profile = doc.exists ? doc.data() || {} : {};
  if (String(profile.cvConversionStatus || "") !== "ready") return false;
  return !profile.cvPdfDownloadedAt;
}
