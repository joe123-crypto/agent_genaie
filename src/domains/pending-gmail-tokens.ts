import crypto from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { getFirestoreDb } from "@/src/firebase/admin";
import { encryptCentralSecret, decryptCentralSecret } from "@/src/security/crypto";
import { httpError } from "@/src/lib/utils";

// Combined sign-up + Gmail-connect OAuth: the callback has Gmail tokens before it
// knows the Firebase UID (the browser must still exchange Google's id_token for a
// Firebase session). We park the tokens here, keyed by a hash of a random nonce
// carried in the signed OAuth state, and the authenticated "claim" call pops them
// once it knows the UID. Firestore-backed (not local-store's /tmp file) because
// Vercel serverless lambdas don't share a filesystem across instances.

export const PENDING_GMAIL_TOKEN_TTL_MS = 10 * 60 * 1000;

const COLLECTION = "pendingGmailTokens";

// The nonce itself must never be recoverable from a Firestore read of the
// collection, so the document id is a one-way hash of it, never the raw nonce.
// Plain SHA-256 (no secret) is fine here in the style of usernameHash: the
// nonce is already 256 bits of crypto.randomBytes, so it is unguessable.
function pendingNonceDocId(nonce: string) {
  return crypto.createHash("sha256").update(nonce).digest("base64url");
}

function isUsableNonce(nonce: unknown): nonce is string {
  return typeof nonce === "string" && nonce.trim().length > 0;
}

export function createPendingNonce(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export async function savePendingGmailTokens(nonce: string, tokens: unknown): Promise<void> {
  if (!isUsableNonce(nonce)) throw httpError(400, "A valid pending token nonce is required.");
  const db = getFirestoreDb();
  const docId = pendingNonceDocId(nonce);
  // AAD-bind the ciphertext to this doc id, same pattern as credentialRefId in
  // mirrorGmailConnectionToCentralData, so the encrypted blob can't be replayed
  // under a different pending-token doc.
  const secret = encryptCentralSecret(tokens, docId);
  await db.collection(COLLECTION).doc(docId).set({
    secret,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: new Date(Date.now() + PENDING_GMAIL_TOKEN_TTL_MS),
  });
}

export async function claimPendingGmailTokens(nonce: string): Promise<any | null> {
  if (!isUsableNonce(nonce)) return null;
  const db = getFirestoreDb();
  const docId = pendingNonceDocId(nonce);
  const ref = db.collection(COLLECTION).doc(docId);
  // One-shot + race-safe: read, delete, and decide inside a single transaction so
  // two concurrent claims for the same nonce can't both succeed.
  return db.runTransaction(async (t) => {
    const doc = await t.get(ref);
    if (!doc.exists) return null;
    const data = doc.data() as any;
    t.delete(ref);
    const expiresAtMs = typeof data?.expiresAt?.toMillis === "function" ? data.expiresAt.toMillis() : 0;
    if (!expiresAtMs || Date.now() > expiresAtMs) return null;
    const tokens = decryptCentralSecret(data.secret, docId);
    return tokens ?? null;
  });
}

export async function deletePendingGmailTokens(nonce: string): Promise<void> {
  if (!isUsableNonce(nonce)) return;
  try {
    const db = getFirestoreDb();
    await db.collection(COLLECTION).doc(pendingNonceDocId(nonce)).delete();
  } catch (err) {
    console.error("Failed to delete pending Gmail tokens:", err);
  }
}
