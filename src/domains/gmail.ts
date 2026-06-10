import { FieldValue } from "firebase-admin/firestore";
import { config, GMAIL_SEND_URL, TOKEN_URL } from "@/src/config";
import { getFirestoreDb } from "@/src/firebase/admin";
import { encryptCentralSecret, decryptCentralSecret } from "@/src/security/crypto";
import { tokenStoreKeyForUid, buildMimeMessage, httpError, validateFirebaseUid, credentialRefId } from "@/src/lib/utils";
import { loadUserTokens, saveUserTokens, readStore } from "./local-store";

export async function postForm(url: string, values: Record<string, string>) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(values)) params.append(k, v);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const data = await response.json();
  if (!response.ok) {
    console.error("Token error response:", data);
    throw httpError(response.status, data.error_description || data.error || "Failed to fetch tokens");
  }
  return data;
}

export async function exchangeCodeForTokens(code: string) {
  const data = await postForm(TOKEN_URL, {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: config.redirectUri,
  });
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expiry_date: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
}

export async function refreshAccessToken(tokens: any) {
  if (!tokens.refresh_token) throw httpError(400, "No refresh token available");
  const data = await postForm(TOKEN_URL, {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: tokens.refresh_token,
    grant_type: "refresh_token",
  });
  return {
    access_token: data.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
}

async function loadTokensFromFirestore(tokenStoreKey: string) {
  try {
    const db = getFirestoreDb();
    const snap = await db.collection("credentialRefs")
      .where("service", "==", "gmail")
      .where("purpose", "==", "oauth2")
      .where("status", "==", "active")
      .get();
    for (const doc of snap.docs) {
      const data = doc.data();
      // Match on the real Firebase UID, or fall back to docs the earlier broken
      // migration wrote with the tokenStoreKey itself stored as userId.
      if (data.userId && (tokenStoreKeyForUid(data.userId) === tokenStoreKey || data.userId === tokenStoreKey)) {
        const tokens = decryptCentralSecret(data.secret, doc.id);
        if (tokens?.access_token) return tokens;
      }
    }
  } catch (err) {
    console.error("Failed to load tokens from Firestore:", err);
  }
  return null;
}

async function saveTokensToFirestore(tokenStoreKey: string, tokens: any) {
  try {
    const db = getFirestoreDb();
    const snap = await db.collection("credentialRefs")
      .where("service", "==", "gmail")
      .where("purpose", "==", "oauth2")
      .where("status", "==", "active")
      .get();
    for (const doc of snap.docs) {
      const data = doc.data();
      if (data.userId && tokenStoreKeyForUid(data.userId) === tokenStoreKey) {
        const secret = encryptCentralSecret(tokens, doc.id);
        await doc.ref.update({ secret, updatedAt: FieldValue.serverTimestamp() });
        return;
      }
    }
  } catch (err) {
    console.error("Failed to save tokens to Firestore:", err);
  }
}

export async function loadGmailTokens(tokenStoreKey: string) {
  let tokens = await loadTokensFromFirestore(tokenStoreKey);
  if (!tokens || !tokens.access_token) {
    tokens = loadUserTokens(tokenStoreKey);
  }
  return tokens && tokens.access_token ? tokens : null;
}

export async function getValidAccessToken(tokenStoreKey: string) {
  let tokens = await loadGmailTokens(tokenStoreKey);
  if (!tokens || !tokens.access_token) throw httpError(401, "No Gmail tokens found");
  if (tokens.expiry_date && Date.now() > tokens.expiry_date - 60000) {
    tokens = await refreshAccessToken(tokens);
    saveUserTokens(tokenStoreKey, tokens);
    await saveTokensToFirestore(tokenStoreKey, tokens);
  }
  return tokens.access_token;
}

export async function sendGmailForTokenStoreKey(tokenStoreKey: string, body: any) {
  const rawBase64 = buildMimeMessage(body);
  const accessToken = await getValidAccessToken(tokenStoreKey);
  const response = await fetch(GMAIL_SEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: rawBase64 }),
  });
  const result = await response.json();
  if (!response.ok) throw httpError(response.status, result.error?.message || "Failed to send email");
  return result;
}

export async function mirrorGmailConnectionToCentralData(uid: string, tokens: any, options: { isDisconnect?: boolean } = {}) {
  const safeUid = validateFirebaseUid(uid);
  const db = getFirestoreDb();
  const centralRef = db.collection("users").doc(safeUid);
  if (options.isDisconnect) {
    const refId = credentialRefId(safeUid, "gmail", "oauth2");
    const credsRef = db.collection("credentialRefs").doc(refId);
    await db.runTransaction(async (t) => {
      const credsDoc = await t.get(credsRef);
      const doc = await t.get(centralRef);
      if (credsDoc.exists) {
        t.update(credsRef, {
          status: "revoked",
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      if (doc.exists) {
        t.update(centralRef, {
          "services.gmail": "not_connected",
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    });
    return;
  }
  const refId = credentialRefId(safeUid, "gmail", "oauth2");
  const centralTokens = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date,
    updatedAtMs: Date.now(),
    migrationSource: "agent_genaie",
  };
  const secret = encryptCentralSecret(centralTokens, refId);
  const credsRef = db.collection("credentialRefs").doc(refId);
  await db.runTransaction(async (t) => {
    const doc = await t.get(centralRef);
    t.set(credsRef, {
      userId: safeUid,
      service: "gmail",
      purpose: "oauth2",
      secret,
      status: "active",
      updatedAt: FieldValue.serverTimestamp(),
      lastVerifiedAt: FieldValue.serverTimestamp(),
    });
    if (doc.exists) {
      t.update(centralRef, {
        "services.gmail": "connected",
        updatedAt: FieldValue.serverTimestamp(),
      });
    } else {
      t.set(centralRef, {
        services: { gmail: "connected", jobs: "not_subscribed", webetu: "not_subscribed", news: "not_subscribed" },
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  });
}

export async function listCentralGmailSenders() {
  const db = getFirestoreDb();
  const senders: Record<string, string[]> = {};
  const query = db.collection("credentialRefs")
    .where("service", "==", "gmail")
    .where("purpose", "==", "oauth2")
    .where("status", "==", "active");
  const snap = await query.get();
  for (const doc of snap.docs) {
    const data = doc.data();
    if (data.userId) {
      const key = tokenStoreKeyForUid(data.userId);
      if (!senders[key]) senders[key] = [];
      senders[key].push("central");
    }
  }
  return senders;
}

export function listLocalGmailSenders() {
  const store = readStore();
  const senders: Record<string, string[]> = {};
  for (const key of Object.keys(store.users ?? {})) {
    if (!senders[key]) senders[key] = [];
    senders[key].push("local");
  }
  return senders;
}

export function resolveOwnerTokenStoreKey() {
  if (!config.ownerFirebaseUid) throw httpError(500, "Owner UID is not configured.");
  return tokenStoreKeyForUid(config.ownerFirebaseUid);
}

export function resolveInternalSender(body: any) {
  let senderKey = body.senderKey;
  if (!senderKey && body.senderUid) senderKey = tokenStoreKeyForUid(body.senderUid);
  if (!senderKey && body.useOwnerAuth === true) senderKey = resolveOwnerTokenStoreKey();
  if (!senderKey) throw httpError(400, "Must specify senderKey, senderUid, or useOwnerAuth=true.");
  return senderKey;
}
