import crypto from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const DEFAULT_PUBLIC_BASE_URL = "http://localhost:3010";
const DEFAULT_PASSBOLT_PUBLIC_URL = "https://your-passbolt-domain.example";
const SESSION_COOKIE_NAME = "agent_genaie_session";
const SESSION_COOKIE_MAX_AGE_SECONDS = 14 * 24 * 60 * 60;

function loadDotEnv() {
  const envPath = path.join(rootDir, ".env");
  if (!fsSync.existsSync(envPath)) return;
  const lines = fsSync.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match || process.env[match[1]] !== undefined) continue;
    const raw = match[2].trim();
    process.env[match[1]] = raw.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  }
}

loadDotEnv();

const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? DEFAULT_PUBLIC_BASE_URL;

const config = {
  host: process.env.HOST ?? "127.0.0.1",
  port: Number.parseInt(process.env.PORT ?? "3010", 10),
  publicBaseUrl,
  clientId: process.env.GOOGLE_CLIENT_ID ?? "",
  clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  redirectUri: process.env.GOOGLE_REDIRECT_URI ?? `${publicBaseUrl}/auth/google/callback`,
  tokenStorePath: path.resolve(rootDir, process.env.TOKEN_STORE_PATH ?? "data/tokens.json"),
  tokenEncryptionSecret: process.env.TOKEN_ENCRYPTION_SECRET ?? "",
  oauthStateSecret: process.env.OAUTH_STATE_SECRET ?? process.env.TOKEN_ENCRYPTION_SECRET ?? "",
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID ?? "",
  firebaseApiKey: process.env.FIREBASE_API_KEY ?? "",
  firebaseAuthDomain: process.env.FIREBASE_AUTH_DOMAIN ?? "",
  firebaseAppId: process.env.FIREBASE_APP_ID ?? "",
  firebaseEmailLinkUrl: process.env.FIREBASE_EMAIL_LINK_URL ?? `${publicBaseUrl}/auth/firebase/finish`,
  firebaseServiceAccountJsonBase64: process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 ?? "",
  internalApiKey: process.env.AGENT_GENAI_INTERNAL_API_KEY ?? "",
  ownerFirebaseUid: process.env.OWNER_FIREBASE_UID ?? "",
  centralDataEncryptionSecret: process.env.CENTRAL_DATA_ENCRYPTION_SECRET ?? process.env.TOKEN_ENCRYPTION_SECRET ?? "",
  centralDataKeyVersion: process.env.CENTRAL_DATA_KEY_VERSION ?? "v1",
  passboltPublicUrl: process.env.PASSBOLT_PUBLIC_URL ?? DEFAULT_PASSBOLT_PUBLIC_URL,
};

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);

function jsonResponse(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    ...headers,
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function textResponse(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function htmlResponse(res, status, body) {
  textResponse(res, status, body, "text/html; charset=utf-8");
}

function escapeHtmlAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function redirectResponse(res, location) {
  res.writeHead(302, {
    location,
    "cache-control": "no-store",
  });
  res.end();
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function requireConfig(keys) {
  const missing = keys.filter((key) => !config[key]);
  if (missing.length === 0) return;
  const names = missing
    .map((key) => {
      if (key === "clientId") return "GOOGLE_CLIENT_ID";
      if (key === "clientSecret") return "GOOGLE_CLIENT_SECRET";
      if (key === "tokenEncryptionSecret") return "TOKEN_ENCRYPTION_SECRET";
      if (key === "oauthStateSecret") return "OAUTH_STATE_SECRET";
      if (key === "firebaseProjectId") return "FIREBASE_PROJECT_ID";
      if (key === "firebaseServiceAccountJsonBase64") return "FIREBASE_SERVICE_ACCOUNT_JSON_BASE64";
      if (key === "internalApiKey") return "AGENT_GENAI_INTERNAL_API_KEY";
      if (key === "ownerFirebaseUid") return "OWNER_FIREBASE_UID";
      if (key === "centralDataEncryptionSecret") return "CENTRAL_DATA_ENCRYPTION_SECRET";
      return key;
    })
    .join(", ");
  throw httpError(500, `Missing required environment: ${names}`);
}

function validateFirebaseUid(uid) {
  const value = String(uid ?? "");
  if (!value || value.length > 128) {
    throw httpError(401, "A valid Firebase user is required.");
  }
  return value;
}

function isPublicUserId(value) {
  return /^usr_[A-Za-z0-9_-]{16}$/.test(String(value ?? ""));
}

function validatePublicUserId(value) {
  const text = String(value ?? "");
  if (!isPublicUserId(text)) throw httpError(404, "User route not found.");
  return text;
}

function generatePublicUserId() {
  return `usr_${crypto.randomBytes(12).toString("base64url")}`;
}

function tokenStoreKeyForUid(uid) {
  const safeUid = validateFirebaseUid(uid);
  return `firebase:${crypto.createHash("sha256").update(safeUid).digest("base64url")}`;
}

function serviceSubscriptionId(userId, service) {
  return `${validateFirebaseUid(userId)}_${String(service).replace(/[^A-Za-z0-9_.-]/g, "_")}`;
}

function credentialRefId(userId, service, purpose) {
  return `${String(service).replace(/[^A-Za-z0-9_.-]/g, "_")}_${String(purpose).replace(/[^A-Za-z0-9_.-]/g, "_")}_${validateFirebaseUid(userId)}`;
}

function centralEncryptionKey() {
  requireConfig(["centralDataEncryptionSecret"]);
  return crypto.scryptSync(config.centralDataEncryptionSecret, "central-data-v1", 32);
}

function encryptCentralSecret(value, aad) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", centralEncryptionKey(), iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    alg: "aes-256-gcm",
    keyVersion: config.centralDataKeyVersion,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    aad,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

function splitName(displayName) {
  const parts = String(displayName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: null, lastName: null };
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function userProfileFromRecord(user) {
  const { firstName, lastName } = splitName(user.displayName);
  const googleProvider = user.providerData?.find((entry) => entry.providerId === "google.com");
  return {
    userId: user.uid,
    updatedAt: FieldValue.serverTimestamp(),
    profile: {
      email: user.email ?? "",
      emailVerified: Boolean(user.emailVerified),
      displayName: user.displayName ?? null,
      photoUrl: user.photoURL ?? null,
      firstName,
      lastName,
    },
    identities: {
      firebaseUid: user.uid,
      googleProviderUid: googleProvider?.uid ?? null,
    },
  };
}

function serviceStatusWith(existing, overrides = {}) {
  return {
    gmail: overrides.gmail ?? existing?.gmail ?? "not_connected",
    jobs: overrides.jobs ?? existing?.jobs ?? "not_subscribed",
    webetu: overrides.webetu ?? existing?.webetu ?? "not_subscribed",
    news: overrides.news ?? existing?.news ?? "not_subscribed",
  };
}

async function syncUserToCentralData(uid) {
  const user = await getFirebaseAdminAuth().getUser(validateFirebaseUid(uid));
  const db = getFirestoreDb();
  const ref = db.collection("users").doc(user.uid);
  const snap = await ref.get();
  const existing = snap.exists ? snap.data() : {};
  const publicUserId = await ensurePublicUserId(db, user.uid, existing?.publicUserId);
  await ref.set(
    {
      ...userProfileFromRecord(user),
      publicUserId,
      createdAt: existing?.createdAt ?? FieldValue.serverTimestamp(),
      serviceStatus: serviceStatusWith(existing?.serviceStatus),
    },
    { merge: true },
  );
  user.publicUserId = publicUserId;
  return user;
}

async function ensurePublicUserId(db, firebaseUid, existingPublicUserId) {
  const uid = validateFirebaseUid(firebaseUid);
  if (isPublicUserId(existingPublicUserId)) {
    const publicUserId = String(existingPublicUserId);
    const ref = db.collection("publicUsers").doc(publicUserId);
    const snap = await ref.get();
    if (snap.exists && snap.data()?.firebaseUid && snap.data().firebaseUid !== uid) {
      throw httpError(500, "Existing public user id belongs to another user.");
    }
    const mapping = {
      publicUserId,
      firebaseUid: uid,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (!snap.exists) mapping.createdAt = FieldValue.serverTimestamp();
    await ref.set(mapping, { merge: true });
    return publicUserId;
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const publicUserId = generatePublicUserId();
    try {
      await db.collection("publicUsers").doc(publicUserId).create({
        publicUserId,
        firebaseUid: uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return publicUserId;
    } catch (err) {
      if (err.code === 6 || err.code === "already-exists") continue;
      throw err;
    }
  }
  throw httpError(500, "Could not allocate a public user id.");
}

async function resolvePublicUser(publicUserId) {
  const id = validatePublicUserId(publicUserId);
  const snap = await getFirestoreDb().collection("publicUsers").doc(id).get();
  if (!snap.exists) throw httpError(404, "User route not found.");
  const data = snap.data();
  return {
    publicUserId: id,
    firebaseUid: validateFirebaseUid(data?.firebaseUid),
  };
}

async function mirrorGmailConnectionToCentralData(uid, tokens, options = {}) {
  const user = await syncUserToCentralData(uid);
  const db = getFirestoreDb();
  const userId = user.uid;
  const connected = options.connected ?? Boolean(tokens?.refresh_token || tokens?.access_token);
  const status = options.revoked ? "revoked" : connected ? "connected" : "not_connected";
  const subId = serviceSubscriptionId(userId, "gmail");
  const credId = credentialRefId(userId, "gmail", "oauth_token");
  const now = FieldValue.serverTimestamp();
  const batch = db.batch();

  batch.set(
    db.collection("users").doc(userId),
    {
      updatedAt: now,
      serviceStatus: {
        gmail: status,
      },
    },
    { merge: true },
  );

  batch.set(
    db.collection("serviceSubscriptions").doc(subId),
    {
      subscriptionId: subId,
      userId,
      service: "gmail",
      status: connected ? "active" : "disabled",
      createdAt: now,
      updatedAt: now,
      preferences: {},
      metadata: {
        senderEmail: user.email ?? null,
      },
    },
    { merge: true },
  );

  batch.set(
    db.collection("credentialRefs").doc(credId),
    {
      credentialRefId: credId,
      userId,
      service: "gmail",
      purpose: "oauth_token",
      provider: {
        type: "firestore_encrypted",
        ref: `credentialRefs/${credId}`,
        project: config.firebaseProjectId || null,
        environment: "prod",
      },
      status: options.revoked ? "revoked" : connected ? "ready" : "pending",
      encryptedSecret: connected && tokens ? encryptCentralSecret(tokens, `credentialRefs/${credId}`) : null,
      metadata: {
        senderEmail: user.email ?? null,
        scope: tokens?.scope ?? GMAIL_SEND_SCOPE,
      },
      createdAt: now,
      updatedAt: now,
      lastVerifiedAt: connected ? now : null,
      revokedAt: options.revoked ? now : null,
    },
    { merge: true },
  );

  batch.set(
    db.collection("gmailConnections").doc(userId),
    {
      userId,
      firebaseUid: userId,
      publicUserId: user.publicUserId ?? null,
      senderEmail: user.email ?? null,
      connected,
      scope: tokens?.scope ?? GMAIL_SEND_SCOPE,
      credentialRefId: credId,
      connectedAt: connected ? now : null,
      updatedAt: now,
      revokedAt: options.revoked ? now : null,
    },
    { merge: true },
  );

  await batch.commit();
  return { userId, publicUserId: user.publicUserId ?? null, senderEmail: user.email ?? null, credentialRefId: credId, connected };
}

async function tryCentralData(label, fn) {
  try {
    return await fn();
  } catch (err) {
    console.warn(`Central data ${label} failed: ${err.message ?? err}`);
    return null;
  }
}

async function listCentralGmailSenders() {
  const snapshot = await getFirestoreDb().collection("gmailConnections").where("connected", "==", true).get();
  return snapshot.docs
    .map((doc) => {
      const data = doc.data();
      return {
        uid: data.userId ?? data.firebaseUid ?? doc.id,
        publicUserId: data.publicUserId ?? null,
        email: data.senderEmail ?? null,
        connected: Boolean(data.connected),
        updatedAt: data.updatedAt?.toDate?.().toISOString?.() ?? null,
        source: "firestore",
      };
    })
    .sort((a, b) => String(a.email ?? "").localeCompare(String(b.email ?? "")));
}

async function listLocalGmailSenders() {
  const store = await readStore();
  const connected = [];
  let pageToken;
  do {
    const page = await getFirebaseAdminAuth().listUsers(1000, pageToken);
    for (const user of page.users) {
      const tokenStoreKey = tokenStoreKeyForUid(user.uid);
      const record = store.users[tokenStoreKey];
      if (!record) continue;
      connected.push({
        uid: user.uid,
        email: user.email ?? null,
        connected: true,
        updatedAt: record.updatedAt ?? null,
        source: "local",
      });
    }
    pageToken = page.pageToken;
  } while (pageToken);
  return connected.sort((a, b) => String(a.email ?? "").localeCompare(String(b.email ?? "")));
}

async function backfillCentralData() {
  const store = await readStore();
  let usersSynced = 0;
  let publicUsersSynced = 0;
  let gmailConnectionsSynced = 0;
  let pageToken;
  do {
    const page = await getFirebaseAdminAuth().listUsers(1000, pageToken);
    for (const user of page.users) {
      const centralUser = await syncUserToCentralData(user.uid);
      usersSynced += 1;
      if (centralUser.publicUserId) publicUsersSynced += 1;
      const tokenStoreKey = tokenStoreKeyForUid(user.uid);
      const record = store.users[tokenStoreKey];
      if (!record) continue;
      const tokens = await loadUserTokens(tokenStoreKey);
      await mirrorGmailConnectionToCentralData(user.uid, tokens, { connected: true });
      gmailConnectionsSynced += 1;
    }
    pageToken = page.pageToken;
  } while (pageToken);
  return { usersSynced, publicUsersSynced, gmailConnectionsSynced };
}

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!name) continue;
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }
  return cookies;
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge != null) parts.push(`Max-Age=${options.maxAge}`);
  parts.push(`Path=${options.path ?? "/"}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  return parts.join("; ");
}

function sessionCookieHeader(value) {
  return serializeCookie(SESSION_COOKIE_NAME, value, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  });
}

function clearSessionCookieHeader() {
  return serializeCookie(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 0,
  });
}

function firebaseWebConfig() {
  const firebase = {
    apiKey: config.firebaseApiKey,
    authDomain: config.firebaseAuthDomain,
    projectId: config.firebaseProjectId,
    appId: config.firebaseAppId,
  };
  const required = [
    ["FIREBASE_API_KEY", firebase.apiKey],
    ["FIREBASE_AUTH_DOMAIN", firebase.authDomain],
    ["FIREBASE_PROJECT_ID", firebase.projectId],
    ["FIREBASE_APP_ID", firebase.appId],
    ["FIREBASE_EMAIL_LINK_URL", config.firebaseEmailLinkUrl],
  ];
  const missing = required.filter(([, value]) => !value).map(([name]) => name);
  return {
    configured: missing.length === 0,
    missing,
    firebase,
    emailLinkUrl: config.firebaseEmailLinkUrl,
  };
}

let firebaseAdminApp;
let firebaseAdminAuth;
let firestoreDb;

function getFirebaseAdminApp() {
  if (firebaseAdminApp) return firebaseAdminApp;
  requireConfig(["firebaseServiceAccountJsonBase64"]);
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(
      Buffer.from(config.firebaseServiceAccountJsonBase64, "base64").toString("utf8"),
    );
  } catch {
    throw httpError(500, "FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 must be a base64-encoded service account JSON file.");
  }
  const projectId = config.firebaseProjectId || serviceAccount.project_id;
  if (!projectId) {
    throw httpError(500, "Missing required environment: FIREBASE_PROJECT_ID");
  }
  firebaseAdminApp =
    getApps().find((entry) => entry.name === "agent-genaie") ??
    initializeApp({ credential: cert(serviceAccount), projectId }, "agent-genaie");
  return firebaseAdminApp;
}

function getFirebaseAdminAuth() {
  if (firebaseAdminAuth) return firebaseAdminAuth;
  firebaseAdminAuth = getAuth(getFirebaseAdminApp());
  return firebaseAdminAuth;
}

function getFirestoreDb() {
  if (firestoreDb) return firestoreDb;
  firestoreDb = getFirestore(getFirebaseAdminApp());
  return firestoreDb;
}

async function verifyFirebaseIdToken(idToken) {
  if (!idToken) throw httpError(401, "Firebase sign-in is required.");
  try {
    const decoded = await getFirebaseAdminAuth().verifyIdToken(idToken);
    decoded.uid = validateFirebaseUid(decoded.uid);
    return decoded;
  } catch (err) {
    if (err.status) throw err;
    throw httpError(401, "Firebase sign-in is invalid or expired.");
  }
}

async function verifyFirebaseSessionCookie(sessionCookie) {
  if (!sessionCookie) throw httpError(401, "Firebase sign-in is required.");
  try {
    const decoded = await getFirebaseAdminAuth().verifySessionCookie(sessionCookie, true);
    decoded.uid = validateFirebaseUid(decoded.uid);
    return decoded;
  } catch (err) {
    if (err.status) throw err;
    throw httpError(401, "Firebase session is invalid or expired.");
  }
}

async function verifyFirebaseRequest(req) {
  if (req.firebaseUser) return req.firebaseUser;

  const header = req.headers.authorization ?? "";
  if (header.startsWith("Bearer ")) {
    req.firebaseUser = await verifyFirebaseIdToken(header.slice("Bearer ".length).trim());
    return req.firebaseUser;
  }

  const sessionCookie = parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME];
  if (sessionCookie) {
    req.firebaseUser = await verifyFirebaseSessionCookie(sessionCookie);
    return req.firebaseUser;
  }

  throw httpError(401, "Firebase sign-in is required.");
}

function extractBearerToken(header) {
  const value = String(header ?? "");
  return value.startsWith("Bearer ") ? value.slice("Bearer ".length).trim() : "";
}

function verifyInternalApiKey(req) {
  requireConfig(["internalApiKey"]);
  const provided = extractBearerToken(req.headers.authorization) || String(req.headers["x-agent-genaie-api-key"] ?? "");
  const expected = config.internalApiKey;
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (
    providedBuffer.length === 0 ||
    providedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    throw httpError(401, "Internal API key is required.");
  }
}

async function resolveOwnerTokenStoreKey() {
  if (config.ownerFirebaseUid) {
    return tokenStoreKeyForUid(config.ownerFirebaseUid);
  }

  const store = await readStore();
  const keys = Object.keys(store.users ?? {}).filter((key) => key.startsWith("firebase:"));
  if (keys.length === 1) return keys[0];
  throw httpError(500, "Missing required environment: OWNER_FIREBASE_UID");
}

async function resolveInternalSender(body) {
  const fromEmail = rejectHeaderInjection(body?.fromEmail ?? "", "fromEmail");
  if (!fromEmail) {
    return {
      tokenStoreKey: await resolveOwnerTokenStoreKey(),
      sender: "owner",
      senderEmail: null,
      senderUid: config.ownerFirebaseUid || null,
    };
  }

  let user;
  try {
    user = await getFirebaseAdminAuth().getUserByEmail(fromEmail);
  } catch (err) {
    if (err.code === "auth/user-not-found") {
      throw httpError(404, `No Firebase user found for sender ${fromEmail}.`);
    }
    throw err;
  }

  const tokenStoreKey = tokenStoreKeyForUid(user.uid);
  const tokens = await loadUserTokens(tokenStoreKey);
  if (!tokens) {
    throw httpError(401, `Gmail is not connected for sender ${user.email ?? fromEmail}.`);
  }

  return {
    tokenStoreKey,
    sender: "user",
    senderEmail: user.email ?? fromEmail,
    senderUid: user.uid,
  };
}

function rejectHeaderInjection(value, field) {
  const text = String(value ?? "");
  if (/[\r\n]/.test(text)) throw httpError(400, `${field} cannot contain line breaks.`);
  return text.trim();
}

function deriveEncryptionKey() {
  requireConfig(["tokenEncryptionSecret"]);
  return crypto.scryptSync(config.tokenEncryptionSecret, "gmail-token-store-v1", 32);
}

function encryptJson(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveEncryptionKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
}

function decryptJson(record) {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    deriveEncryptionKey(),
    Buffer.from(record.iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(record.tag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, "base64url")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8"));
}

async function readStore() {
  try {
    const raw = await fs.readFile(config.tokenStorePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && parsed.users ? parsed : { version: 1, users: {} };
  } catch (err) {
    if (err.code === "ENOENT") return { version: 1, users: {} };
    throw err;
  }
}

async function writeStore(store) {
  await fs.mkdir(path.dirname(config.tokenStorePath), { recursive: true });
  const tmpPath = `${config.tokenStorePath}.${process.pid}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tmpPath, config.tokenStorePath);
}

async function loadUserTokens(tokenStoreKey) {
  const store = await readStore();
  const record = store.users[tokenStoreKey];
  if (!record) return null;
  return decryptJson(record.token);
}

async function saveUserTokens(tokenStoreKey, tokens) {
  const store = await readStore();
  store.users[tokenStoreKey] = {
    updatedAt: new Date().toISOString(),
    token: encryptJson(tokens),
  };
  await writeStore(store);
}

async function deleteUserTokens(tokenStoreKey) {
  const store = await readStore();
  delete store.users[tokenStoreKey];
  await writeStore(store);
}

function signState(payload) {
  requireConfig(["oauthStateSecret"]);
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", config.oauthStateSecret).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

function verifyState(state) {
  requireConfig(["oauthStateSecret"]);
  const [encoded, sig] = String(state ?? "").split(".");
  if (!encoded || !sig) throw httpError(400, "Invalid OAuth state.");
  const expected = crypto.createHmac("sha256", config.oauthStateSecret).update(encoded).digest("base64url");
  const sigBuffer = Buffer.from(sig);
  const expectedBuffer = Buffer.from(expected);
  if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
    throw httpError(400, "Invalid OAuth state signature.");
  }
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  if (!payload.ts || Date.now() - payload.ts > 10 * 60 * 1000) {
    throw httpError(400, "OAuth state expired.");
  }
  payload.uid = validateFirebaseUid(payload.uid);
  return payload;
}

async function postForm(url, values) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw httpError(response.status, body.error_description ?? body.error ?? `Request failed with ${response.status}`);
  }
  return body;
}

async function exchangeCodeForTokens(code) {
  requireConfig(["clientId", "clientSecret"]);
  return postForm(TOKEN_URL, {
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
  });
}

async function refreshAccessToken(tokens) {
  requireConfig(["clientId", "clientSecret"]);
  if (!tokens.refresh_token) throw httpError(401, "Gmail authorization must be renewed.");
  const refreshed = await postForm(TOKEN_URL, {
    refresh_token: tokens.refresh_token,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
  });
  return {
    ...tokens,
    ...refreshed,
    refresh_token: tokens.refresh_token,
    expiry_date: Date.now() + Number(refreshed.expires_in ?? 3600) * 1000,
  };
}

async function getValidAccessToken(tokenStoreKey) {
  let tokens = await loadUserTokens(tokenStoreKey);
  if (!tokens) throw httpError(401, "Gmail is not connected for this user.");
  if (tokens.access_token && tokens.expiry_date && tokens.expiry_date > Date.now() + 60_000) {
    return tokens.access_token;
  }
  tokens = await refreshAccessToken(tokens);
  await saveUserTokens(tokenStoreKey, tokens);
  return tokens.access_token;
}

function encodeHeader(value) {
  const text = rejectHeaderInjection(value, "Header");
  if (/^[\x20-\x7E]*$/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
}

function buildAddressHeader(value, field) {
  if (Array.isArray(value)) {
    return value.map((entry) => rejectHeaderInjection(entry, field)).filter(Boolean).join(", ");
  }
  return rejectHeaderInjection(value, field);
}

function encodeBodyPart(text, contentType) {
  return [
    `Content-Type: ${contentType}; charset=UTF-8`,
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(String(text), "utf8").toString("base64"),
  ].join("\r\n");
}

function wrapBase64(value) {
  return String(value).replace(/(.{76})/g, "$1\r\n").replace(/\r\n$/, "");
}

function escapeMimeParam(value) {
  return rejectHeaderInjection(value, "MIME parameter").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function normalizeAttachments(input) {
  if (input.attachments == null) return [];
  if (!Array.isArray(input.attachments)) throw httpError(400, "attachments must be an array.");
  return input.attachments.map((attachment, index) => {
    const filename = rejectHeaderInjection(attachment?.filename, `attachments[${index}].filename`);
    if (!filename) throw httpError(400, `attachments[${index}].filename is required.`);
    const contentBase64 = String(attachment?.contentBase64 ?? "").replace(/\s+/g, "");
    if (!contentBase64) throw httpError(400, `attachments[${index}].contentBase64 is required.`);
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(contentBase64)) {
      throw httpError(400, `attachments[${index}].contentBase64 must be base64.`);
    }
    const contentType = rejectHeaderInjection(attachment?.contentType ?? "application/octet-stream", "contentType");
    if (!/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(contentType)) {
      throw httpError(400, `attachments[${index}].contentType is invalid.`);
    }
    return { filename, contentType, contentBase64 };
  });
}

function encodeAttachmentPart(attachment) {
  const filename = escapeMimeParam(attachment.filename);
  return [
    `Content-Type: ${attachment.contentType}; name="${filename}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${filename}"`,
    "",
    wrapBase64(attachment.contentBase64),
  ].join("\r\n");
}

function buildBodyMimePart(text, html) {
  if (text && html) {
    const boundary = `gmail_alt_${crypto.randomBytes(12).toString("hex")}`;
    return [
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      encodeBodyPart(text, "text/plain"),
      `--${boundary}`,
      encodeBodyPart(html, "text/html"),
      `--${boundary}--`,
    ].join("\r\n");
  }
  return encodeBodyPart(html || text, html ? "text/html" : "text/plain");
}

function buildMimeMessage(input) {
  const to = buildAddressHeader(input.to, "to");
  if (!to) throw httpError(400, "to is required.");
  const subject = encodeHeader(input.subject ?? "");
  const text = input.text == null ? "" : String(input.text);
  const html = input.html == null ? "" : String(input.html);
  if (!text && !html) throw httpError(400, "text or html is required.");
  const attachments = normalizeAttachments(input);

  const headers = [`To: ${to}`, `Subject: ${subject}`, "MIME-Version: 1.0"];
  if (input.cc) headers.push(`Cc: ${buildAddressHeader(input.cc, "cc")}`);
  if (input.bcc) headers.push(`Bcc: ${buildAddressHeader(input.bcc, "bcc")}`);
  if (input.replyTo) headers.push(`Reply-To: ${buildAddressHeader(input.replyTo, "replyTo")}`);

  if (attachments.length > 0) {
    const boundary = `gmail_mixed_${crypto.randomBytes(12).toString("hex")}`;
    headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    return [
      ...headers,
      "",
      `--${boundary}`,
      buildBodyMimePart(text, html),
      ...attachments.flatMap((attachment) => [`--${boundary}`, encodeAttachmentPart(attachment)]),
      `--${boundary}--`,
      "",
    ].join("\r\n");
  }

  if (text && html) {
    const boundary = `gmail_alt_${crypto.randomBytes(12).toString("hex")}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    return [
      ...headers,
      "",
      `--${boundary}`,
      encodeBodyPart(text, "text/plain"),
      `--${boundary}`,
      encodeBodyPart(html, "text/html"),
      `--${boundary}--`,
      "",
    ].join("\r\n");
  }

  headers.push(`Content-Type: ${html ? "text/html" : "text/plain"}; charset=UTF-8`);
  headers.push("Content-Transfer-Encoding: base64");
  return [...headers, "", Buffer.from(html || text, "utf8").toString("base64"), ""].join("\r\n");
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 12 * 1024 * 1024) throw httpError(413, "Request body is too large.");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw httpError(400, "Request body must be valid JSON.");
  }
}

async function serveFile(res, filePath) {
  const root = path.resolve(rootDir);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(root + path.sep)) throw httpError(404, "Not found.");
  try {
    const body = await fs.readFile(resolved);
    const contentType = contentTypes.get(path.extname(resolved).toLowerCase()) ?? "application/octet-stream";
    res.writeHead(200, {
      "content-type": contentType,
      "content-length": body.length,
      "cache-control": contentType.startsWith("image/") ? "public, max-age=3600" : "no-cache",
    });
    res.end(body);
  } catch (err) {
    if (err.code === "ENOENT" || err.code === "EISDIR") throw httpError(404, "Not found.");
    throw err;
  }
}

async function handleStart(req, res) {
  const firebaseUser = await verifyFirebaseRequest(req);
  requireConfig(["clientId", "oauthStateSecret"]);
  const state = signState({ uid: firebaseUser.uid, nonce: crypto.randomUUID(), ts: Date.now() });
  const authUrl = new URL(AUTH_URL);
  authUrl.searchParams.set("client_id", config.clientId);
  authUrl.searchParams.set("redirect_uri", config.redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", GMAIL_SEND_SCOPE);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("include_granted_scopes", "true");
  authUrl.searchParams.set("state", state);
  jsonResponse(res, 200, { url: authUrl.toString() });
}

async function handleCallback(req, res, url) {
  if (url.searchParams.get("error")) {
    throw httpError(400, `Google OAuth error: ${url.searchParams.get("error")}`);
  }
  const code = url.searchParams.get("code");
  if (!code) throw httpError(400, "Missing OAuth code.");
  const state = verifyState(url.searchParams.get("state"));
  const tokenResponse = await exchangeCodeForTokens(code);
  const tokenStoreKey = tokenStoreKeyForUid(state.uid);
  const existing = await loadUserTokens(tokenStoreKey);
  const merged = {
    ...existing,
    ...tokenResponse,
    refresh_token: tokenResponse.refresh_token ?? existing?.refresh_token,
    expiry_date: Date.now() + Number(tokenResponse.expires_in ?? 3600) * 1000,
    scope: tokenResponse.scope ?? GMAIL_SEND_SCOPE,
  };
  await saveUserTokens(tokenStoreKey, merged);
  const centralConnection = await tryCentralData("gmail connection mirror", () =>
    mirrorGmailConnectionToCentralData(state.uid, merged, { connected: true }),
  );
  const returnPath = centralConnection?.publicUserId ? `/${centralConnection.publicUserId}/connect-gmail` : "/connect-gmail";
  htmlResponse(
    res,
    200,
    `<!doctype html><title>Gmail connected</title><p>Gmail connected. Return to <a href="${returnPath}">Gmail connection</a>.</p><script>setTimeout(function(){window.location.href=${JSON.stringify(returnPath)};},900);</script>`,
  );
}

async function handleStatus(req, res) {
  const firebaseUser = await verifyFirebaseRequest(req);
  const tokens = await loadUserTokens(tokenStoreKeyForUid(firebaseUser.uid));
  await tryCentralData("user sync", () => syncUserToCentralData(firebaseUser.uid));
  jsonResponse(res, 200, {
    connected: Boolean(tokens?.refresh_token || tokens?.access_token),
    hasRefreshToken: Boolean(tokens?.refresh_token),
    expiresAt: tokens?.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
    scope: tokens?.scope ?? null,
  });
}

async function handleRevoke(req, res) {
  const firebaseUser = await verifyFirebaseRequest(req);
  await readJsonBody(req);
  const tokenStoreKey = tokenStoreKeyForUid(firebaseUser.uid);
  const tokens = await loadUserTokens(tokenStoreKey);
  if (tokens?.refresh_token || tokens?.access_token) {
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: tokens.refresh_token ?? tokens.access_token }),
    }).catch(() => undefined);
  }
  await deleteUserTokens(tokenStoreKey);
  await tryCentralData("gmail revoke mirror", () =>
    mirrorGmailConnectionToCentralData(firebaseUser.uid, null, { connected: false, revoked: true }),
  );
  jsonResponse(res, 200, { ok: true });
}

async function sendGmailForTokenStoreKey(tokenStoreKey, body) {
  const mime = buildMimeMessage(body);
  const accessToken = await getValidAccessToken(tokenStoreKey);
  const sendRes = await fetch(GMAIL_SEND_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ raw: Buffer.from(mime, "utf8").toString("base64url") }),
  });
  const responseBody = await sendRes.json().catch(() => ({}));
  if (!sendRes.ok) {
    throw httpError(sendRes.status, responseBody.error?.message ?? "Gmail send failed.");
  }
  return {
    ok: true,
    messageId: responseBody.id,
    threadId: responseBody.threadId,
  };
}

async function handleSend(req, res) {
  const firebaseUser = await verifyFirebaseRequest(req);
  const body = await readJsonBody(req);
  if (body.confirm !== true) throw httpError(409, "Email send requires confirm: true.");
  const result = await sendGmailForTokenStoreKey(tokenStoreKeyForUid(firebaseUser.uid), body);
  jsonResponse(res, 200, result);
}

async function handleInternalSend(req, res) {
  verifyInternalApiKey(req);
  const body = await readJsonBody(req);
  if (body.confirm !== true) throw httpError(409, "Email send requires confirm: true.");
  const sender = await resolveInternalSender(body);
  const result = await sendGmailForTokenStoreKey(sender.tokenStoreKey, body);
  jsonResponse(res, 200, {
    ...result,
    sender: sender.sender,
    senderEmail: sender.senderEmail,
    senderUid: sender.senderUid,
  });
}

async function handleInternalSenders(req, res) {
  verifyInternalApiKey(req);
  const centralSenders = await tryCentralData("list gmail senders", () => listCentralGmailSenders());
  const localSenders = await listLocalGmailSenders();
  const sendersByUid = new Map();
  for (const sender of localSenders) {
    sendersByUid.set(sender.uid, sender);
  }
  if (Array.isArray(centralSenders)) {
    for (const sender of centralSenders) {
      sendersByUid.set(sender.uid, sender);
    }
  }
  const senders = [...sendersByUid.values()].sort((a, b) =>
    String(a.email ?? "").localeCompare(String(b.email ?? "")),
  );
  jsonResponse(res, 200, { source: Array.isArray(centralSenders) ? "firestore+local" : "local", senders });
}

async function handleInternalCentralDataStatus(req, res) {
  verifyInternalApiKey(req);
  const usersProbe = await getFirestoreDb().collection("users").limit(1).get();
  jsonResponse(res, 200, {
    ok: true,
    firestore: true,
    projectId: config.firebaseProjectId || null,
    usersProbeCount: usersProbe.size,
  });
}

async function handleInternalCentralDataBackfill(req, res) {
  verifyInternalApiKey(req);
  await readJsonBody(req);
  const result = await backfillCentralData();
  jsonResponse(res, 200, { ok: true, ...result });
}

async function handleCreateSession(req, res) {
  const body = await readJsonBody(req);
  const idToken = typeof body.idToken === "string" ? body.idToken.trim() : "";
  const firebaseUser = await verifyFirebaseIdToken(idToken);
  const sessionCookie = await getFirebaseAdminAuth().createSessionCookie(idToken, {
    expiresIn: SESSION_COOKIE_MAX_AGE_SECONDS * 1000,
  });
  req.firebaseUser = firebaseUser;
  const centralUser = await syncUserToCentralData(firebaseUser.uid);
  jsonResponse(
    res,
    200,
    {
      authenticated: true,
      uid: firebaseUser.uid,
      publicUserId: centralUser.publicUserId ?? null,
      email: firebaseUser.email ?? centralUser.email ?? null,
    },
    {
      "set-cookie": sessionCookieHeader(sessionCookie),
      "cache-control": "no-store",
    },
  );
}

async function handleSessionStatus(req, res) {
  try {
    const firebaseUser = await verifyFirebaseRequest(req);
    const centralUser = await syncUserToCentralData(firebaseUser.uid);
    jsonResponse(res, 200, {
      authenticated: true,
      uid: firebaseUser.uid,
      publicUserId: centralUser.publicUserId ?? null,
      email: firebaseUser.email ?? centralUser.email ?? null,
    });
  } catch (err) {
    if (err.status === 401) {
      jsonResponse(res, 200, { authenticated: false, uid: null, publicUserId: null, email: null });
      return;
    }
    throw err;
  }
}

async function handleLogoutSession(req, res) {
  await readJsonBody(req);
  jsonResponse(
    res,
    200,
    { ok: true },
    {
      "set-cookie": clearSessionCookieHeader(),
      "cache-control": "no-store",
    },
  );
}

function authPage(title, body, script) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
    <style>
      :root{color-scheme:light}
      *{box-sizing:border-box}
      body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f6f7f9;color:#15171a}
      main{min-height:100vh;display:grid;place-items:center;padding:24px}
      section{width:min(560px,100%);background:#fff;border:1px solid #d8dee7;border-radius:8px;padding:26px;box-shadow:0 18px 45px rgba(22,28,36,.11)}
      h1{margin:0 0 8px;font-size:2rem;line-height:1.08;letter-spacing:0}
      p{margin:0 0 18px;color:#5f6875;font-size:1rem;line-height:1.55}
      label{display:block;margin:0 0 8px;font-weight:750;color:#303846}
      input{width:100%;min-height:46px;border:1px solid #b9c3d1;border-radius:7px;padding:0 12px;font:inherit;background:#fff;color:#15171a}
      input:focus{outline:3px solid rgba(47,116,208,.18);border-color:#2f74d0}
      .actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:18px}
      button,a.button{display:inline-flex;min-height:44px;align-items:center;justify-content:center;border:0;border-radius:7px;background:#2f74d0;color:#fff;font:inherit;font-weight:750;text-decoration:none;padding:0 16px;cursor:pointer}
      button.secondary,a.secondary{background:#eef2f7;color:#263142;border:1px solid #cbd5e1}
      button.danger{background:#b42318}
      button:disabled{opacity:.55;cursor:not-allowed}
      button:focus-visible,a.button:focus-visible,input:focus-visible{outline:3px solid rgba(47,116,208,.28);outline-offset:2px}
      button:hover:not(:disabled),a.button:hover{filter:brightness(.94)}
      [hidden]{display:none!important}
      .status{margin-top:18px;padding:12px 14px;border-radius:7px;border:1px solid #cbd5e1;background:#f8fafc;color:#303846;line-height:1.45}
      .status[data-tone="success"]{border-color:#7fc9a2;background:#eefaf3;color:#11603a}
      .status[data-tone="error"]{border-color:#f1a7a1;background:#fff1f0;color:#9f2419}
      .meta{display:grid;gap:8px;margin:18px 0 0;padding:14px;border-radius:7px;background:#f8fafc;border:1px solid #d8dee7;color:#303846}
      .meta strong{color:#15171a}
      .toplink{display:inline-flex;margin-bottom:18px;color:#2f74d0;text-decoration:none;font-weight:750}
    </style>
  </head>
  <body>
    <main>
      <section>
        ${body}
      </section>
    </main>
    ${script}
  </body>
</html>`;
}

function loginPage() {
  return authPage(
    "Sign in",
    `<a class="toplink" href="/">Back to app</a>
        <h1>Sign in</h1>
        <p>Enter your email address. The app will send a sign-in link that opens this same server.</p>
        <form data-login-form>
          <label for="email">Email address</label>
          <input id="email" data-email type="email" autocomplete="email" required>
          <div class="actions">
            <button data-submit type="submit">Send sign-in link</button>
          </div>
        </form>
        <div class="status" data-status hidden></div>`,
    `<script type="module">
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, onAuthStateChanged, sendSignInLinkToEmail } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const form = document.querySelector("[data-login-form]");
const emailInput = document.querySelector("[data-email]");
const submitButton = document.querySelector("[data-submit]");
const statusEl = document.querySelector("[data-status]");
const emailStorageKey = "agentGenaieEmailForSignIn";
const params = new URLSearchParams(window.location.search);

function safeNext(value) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "";
}

const nextPath = safeNext(params.get("next"));

function destinationForSession(session) {
  const publicUserId = session && session.publicUserId;
  if (!publicUserId) return nextPath || "/";
  if (!nextPath || nextPath === "/") return "/" + publicUserId;
  if (nextPath === "/connect-gmail") return "/" + publicUserId + "/connect-gmail";
  if (nextPath === "/onboarding" || nextPath === "/onboarding/") return "/" + publicUserId + "/onboarding";
  return nextPath;
}

function emailLinkUrl(settings) {
  const url = new URL(settings.emailLinkUrl);
  if (nextPath) url.searchParams.set("next", nextPath);
  return url.toString();
}

async function createSession(user) {
  const idToken = await user.getIdToken(true);
  const response = await fetch("/auth/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken })
  });
  const body = await response.json().catch(function() { return {}; });
  if (!response.ok) throw new Error(body.error || "Could not create server session.");
  return body;
}

function setStatus(message, tone) {
  statusEl.textContent = message;
  statusEl.dataset.tone = tone || "info";
  statusEl.hidden = false;
}

function setBusy(value) {
  submitButton.disabled = value;
  emailInput.disabled = value;
}

async function start() {
  const response = await fetch("/config/firebase");
  const settings = await response.json();
  if (!settings.configured) {
    form.hidden = true;
    setStatus("Firebase email login is not configured yet. Missing: " + settings.missing.join(", "), "error");
    return;
  }

  const app = initializeApp(settings.firebase);
  const auth = getAuth(app);
  onAuthStateChanged(auth, async function(user) {
    if (!user) return;
    try {
      const session = await createSession(user);
      window.location.assign(destinationForSession(session));
    } catch (err) {
      setStatus(err.message || "Could not create server session.", "error");
    }
  });

  form.addEventListener("submit", async function(event) {
    event.preventDefault();
    const email = emailInput.value.trim();
    if (!email) {
      setStatus("Enter an email address.", "error");
      return;
    }
    setBusy(true);
    try {
      await sendSignInLinkToEmail(auth, email, {
        url: emailLinkUrl(settings),
        handleCodeInApp: true
      });
      window.localStorage.setItem(emailStorageKey, email);
      setStatus("Check your email for the sign-in link.", "success");
    } catch (err) {
      setStatus(err.message || "Could not send the sign-in link.", "error");
    } finally {
      setBusy(false);
    }
  });
}

start().catch(function(err) {
  form.hidden = true;
  setStatus(err.message || "Could not load Firebase settings.", "error");
});
</script>`,
  );
}

function firebaseFinishPage() {
  return authPage(
    "Finish sign in",
    `<a class="toplink" href="/login">Back to sign in</a>
        <h1>Finish sign in</h1>
        <p>The app is completing your email-link sign-in.</p>
        <form data-email-form hidden>
          <label for="email">Confirm email address</label>
          <input id="email" data-email type="email" autocomplete="email" required>
          <div class="actions">
            <button data-submit type="submit">Finish sign in</button>
          </div>
        </form>
        <div class="status" data-status>Checking sign-in link...</div>`,
    `<script type="module">
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, isSignInWithEmailLink, signInWithEmailLink } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const form = document.querySelector("[data-email-form]");
const emailInput = document.querySelector("[data-email]");
const submitButton = document.querySelector("[data-submit]");
const statusEl = document.querySelector("[data-status]");
const emailStorageKey = "agentGenaieEmailForSignIn";
const params = new URLSearchParams(window.location.search);
let auth;

function safeNext(value) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "";
}

const nextPath = safeNext(params.get("next"));

function destinationForSession(session) {
  const publicUserId = session && session.publicUserId;
  if (!publicUserId) return nextPath || "/";
  if (!nextPath || nextPath === "/") return "/" + publicUserId;
  if (nextPath === "/connect-gmail") return "/" + publicUserId + "/connect-gmail";
  if (nextPath === "/onboarding" || nextPath === "/onboarding/") return "/" + publicUserId + "/onboarding";
  return nextPath;
}

async function createSession(user) {
  const idToken = await user.getIdToken(true);
  const response = await fetch("/auth/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken })
  });
  const body = await response.json().catch(function() { return {}; });
  if (!response.ok) throw new Error(body.error || "Could not create server session.");
  return body;
}

function setStatus(message, tone) {
  statusEl.textContent = message;
  statusEl.dataset.tone = tone || "info";
  statusEl.hidden = false;
}

function setBusy(value) {
  submitButton.disabled = value;
  emailInput.disabled = value;
}

async function finish(email) {
  setBusy(true);
  try {
    const result = await signInWithEmailLink(auth, email, window.location.href);
    const session = await createSession(result.user);
    window.localStorage.removeItem(emailStorageKey);
    setStatus("Signed in. Opening app.", "success");
    window.location.assign(destinationForSession(session));
  } catch (err) {
    setStatus(err.message || "Could not finish sign-in.", "error");
  } finally {
    setBusy(false);
  }
}

async function start() {
  const response = await fetch("/config/firebase");
  const settings = await response.json();
  if (!settings.configured) {
    setStatus("Firebase email login is not configured yet. Missing: " + settings.missing.join(", "), "error");
    return;
  }

  const app = initializeApp(settings.firebase);
  auth = getAuth(app);
  if (!isSignInWithEmailLink(auth, window.location.href)) {
    setStatus("This sign-in link is not valid for this app.", "error");
    return;
  }

  const storedEmail = window.localStorage.getItem(emailStorageKey);
  if (storedEmail) {
    await finish(storedEmail);
    return;
  }

  form.hidden = false;
  setStatus("Confirm the same email address used to request the link.");
  form.addEventListener("submit", async function(event) {
    event.preventDefault();
    const email = emailInput.value.trim();
    if (!email) {
      setStatus("Enter your email address.", "error");
      return;
    }
    await finish(email);
  });
}

start().catch(function(err) {
  setStatus(err.message || "Could not load Firebase settings.", "error");
});
</script>`,
  );
}

function connectGmailPage(publicUserId) {
  const homePath = `/${validatePublicUserId(publicUserId)}`;
  const connectPath = `${homePath}/connect-gmail`;
  return authPage(
    "Connect Gmail",
    `<a class="toplink" href="${homePath}">Back to app</a>
        <h1>Connect Gmail</h1>
        <p>Sign in with email first, then grant Gmail send access for this account.</p>
        <div data-signed-out hidden>
          <div class="actions">
            <a class="button" href="/login?next=${encodeURIComponent(connectPath)}">Sign in with email</a>
          </div>
        </div>
        <div data-signed-in hidden>
          <div class="meta">
            <span>Signed in as <strong data-user-email></strong></span>
            <span>Gmail status: <strong data-gmail-status>Checking...</strong></span>
          </div>
          <div class="actions">
            <button data-connect type="button">Connect Gmail</button>
            <button class="danger" data-disconnect type="button" hidden>Disconnect Gmail</button>
            <button class="secondary" data-sign-out type="button">Sign out</button>
          </div>
        </div>
        <div class="status" data-status hidden></div>`,
    `<script type="module">
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const signedOut = document.querySelector("[data-signed-out]");
const signedIn = document.querySelector("[data-signed-in]");
const emailEl = document.querySelector("[data-user-email]");
const gmailStatusEl = document.querySelector("[data-gmail-status]");
const statusEl = document.querySelector("[data-status]");
const connectButton = document.querySelector("[data-connect]");
const disconnectButton = document.querySelector("[data-disconnect]");
const signOutButton = document.querySelector("[data-sign-out]");
let auth;
let currentUser;
let sessionUser;

function setStatus(message, tone) {
  statusEl.textContent = message;
  statusEl.dataset.tone = tone || "info";
  statusEl.hidden = false;
}

function clearStatus() {
  statusEl.textContent = "";
  statusEl.hidden = true;
}

function setBusy(value) {
  connectButton.disabled = value;
  disconnectButton.disabled = value;
  signOutButton.disabled = value;
}

async function authedFetch(url, options) {
  const headers = Object.assign({}, options && options.headers ? options.headers : {});
  if (currentUser) {
    headers.authorization = "Bearer " + await currentUser.getIdToken();
  }
  return fetch(url, Object.assign({}, options || {}, { credentials: "same-origin", headers: headers }));
}

async function loadSession() {
  return readJson(await fetch("/auth/session", { credentials: "same-origin" }));
}

async function readJson(response) {
  const body = await response.json().catch(function() { return {}; });
  if (!response.ok) {
    throw new Error(body.error || "Request failed with " + response.status);
  }
  return body;
}

async function loadGmailStatus() {
  gmailStatusEl.textContent = "Checking...";
  const status = await readJson(await authedFetch("/auth/google/status", { method: "GET" }));
  if (status.connected) {
    gmailStatusEl.textContent = "Connected";
    connectButton.textContent = "Reconnect Gmail";
    disconnectButton.hidden = false;
  } else {
    gmailStatusEl.textContent = "Not connected";
    connectButton.textContent = "Connect Gmail";
    disconnectButton.hidden = true;
  }
}

async function start() {
  const response = await fetch("/config/firebase");
  const settings = await response.json();
  if (!settings.configured) {
    signedOut.hidden = true;
    signedIn.hidden = true;
    setStatus("Firebase email login is not configured yet. Missing: " + settings.missing.join(", "), "error");
    return;
  }

  const app = initializeApp(settings.firebase);
  auth = getAuth(app);

  onAuthStateChanged(auth, async function(user) {
    currentUser = user;
    sessionUser = null;
    clearStatus();

    let session = { authenticated: false };
    try {
      session = await loadSession();
    } catch (err) {
      setStatus(err.message || "Could not check server session.", "error");
    }

    if (!user && !session.authenticated) {
      signedIn.hidden = true;
      signedOut.hidden = false;
      return;
    }

    sessionUser = session.authenticated ? session : null;
    emailEl.textContent = user?.email || sessionUser?.email || "signed-in user";
    signedOut.hidden = true;
    signedIn.hidden = false;
    try {
      await loadGmailStatus();
    } catch (err) {
      gmailStatusEl.textContent = "Unavailable";
      setStatus(err.message || "Could not check Gmail connection.", "error");
    }
  });

  connectButton.addEventListener("click", async function() {
    if (!currentUser && !sessionUser) return;
    setBusy(true);
    clearStatus();
    try {
      const payload = await readJson(await authedFetch("/auth/google/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      }));
      window.location.href = payload.url;
    } catch (err) {
      setStatus(err.message || "Could not start Gmail connection.", "error");
      setBusy(false);
    }
  });

  disconnectButton.addEventListener("click", async function() {
    if (!currentUser && !sessionUser) return;
    setBusy(true);
    clearStatus();
    try {
      await readJson(await authedFetch("/auth/google/revoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      }));
      setStatus("Gmail disconnected.", "success");
      await loadGmailStatus();
    } catch (err) {
      setStatus(err.message || "Could not disconnect Gmail.", "error");
    } finally {
      setBusy(false);
    }
  });

  signOutButton.addEventListener("click", async function() {
    setBusy(true);
    await fetch("/auth/session/logout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      credentials: "same-origin"
    }).catch(function() { return undefined; });
    await signOut(auth);
    window.location.assign("/login");
  });
}

start().catch(function(err) {
  setStatus(err.message || "Could not load Firebase settings.", "error");
});
</script>`,
  );
}

function scopedRouteForPath(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0 || !isPublicUserId(parts[0])) return null;
  return {
    publicUserId: parts[0],
    rest: parts.slice(1).join("/"),
  };
}

async function requireMatchingScopedUser(req, publicUserId) {
  const routeUser = await resolvePublicUser(publicUserId);
  const firebaseUser = req.firebaseUser ?? (await verifyFirebaseRequest(req));
  if (firebaseUser.uid !== routeUser.firebaseUid) {
    throw httpError(403, "This page belongs to another signed-in user.");
  }
  return routeUser;
}

async function redirectToScopedPath(req, res, suffix = "") {
  const firebaseUser = req.firebaseUser ?? (await verifyFirebaseRequest(req));
  const centralUser = await syncUserToCentralData(firebaseUser.uid);
  redirectResponse(res, `/${centralUser.publicUserId}${suffix}`);
}

async function serveScopedOnboardingPage(res, publicUserId) {
  const id = validatePublicUserId(publicUserId);
  const html = await fs.readFile(path.join(rootDir, "index.html"), "utf8");
  const scoped = html
    .replaceAll('href="/onboarding/', `href="/${id}/onboarding/`)
    .replaceAll('src="/onboarding/', `src="/${id}/onboarding/`)
    .replaceAll("https://your-passbolt-domain.example", escapeHtmlAttribute(config.passboltPublicUrl));
  htmlResponse(res, 200, scoped);
}

async function handleScopedPage(req, res, scoped) {
  await requireMatchingScopedUser(req, scoped.publicUserId);
  if (!scoped.rest) return htmlResponse(res, 200, rootPage(scoped.publicUserId));
  if (scoped.rest === "connect-gmail") return htmlResponse(res, 200, connectGmailPage(scoped.publicUserId));
  if (scoped.rest === "onboarding") return serveScopedOnboardingPage(res, scoped.publicUserId);
  if (scoped.rest === "onboarding/styles.css") {
    return serveFile(res, path.join(rootDir, "styles.css"));
  }
  if (scoped.rest.startsWith("onboarding/assets/")) {
    const assetName = scoped.rest.slice("onboarding/assets/".length);
    return serveFile(res, path.join(rootDir, "assets", assetName));
  }
  throw httpError(404, "Not found.");
}

function isPublicRoute(method, pathname) {
  const isRead = method === "GET" || method === "HEAD";
  if (isRead && pathname === "/login") return true;
  if (isRead && pathname === "/auth/firebase/finish") return true;
  if (isRead && pathname === "/config/firebase") return true;
  if (isRead && pathname === "/health") return true;
  if (method === "GET" && pathname === "/auth/google/callback") return true;
  if ((method === "GET" || method === "POST") && pathname === "/auth/session") return true;
  if (method === "POST" && pathname === "/auth/session/logout") return true;
  if (method === "POST" && pathname === "/internal/gmail/send") return true;
  if (method === "GET" && pathname === "/internal/gmail/senders") return true;
  if (method === "GET" && pathname === "/internal/central-data/status") return true;
  if (method === "POST" && pathname === "/internal/central-data/backfill") return true;
  return false;
}

function shouldRedirectToLogin(req, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  if (pathname.startsWith("/auth/") || pathname.startsWith("/gmail/")) return false;
  if (pathname === "/config/firebase" || pathname === "/health") return false;
  return true;
}

async function enforceRouteProtection(req, res, url, pathname) {
  if (isPublicRoute(req.method, pathname)) return true;
  try {
    await verifyFirebaseRequest(req);
    return true;
  } catch (err) {
    if (err.status === 401 && shouldRedirectToLogin(req, pathname)) {
      const next = `${url.pathname}${url.search}`;
      redirectResponse(res, `/login?next=${encodeURIComponent(next)}`);
      return false;
    }
    throw err;
  }
}

function rootPage(publicUserId) {
  const homePath = `/${validatePublicUserId(publicUserId)}`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Genaie Service Desk</title>
    <style>
      body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f6f7f9;color:#15171a}
      main{min-height:100vh;display:grid;place-items:center;padding:32px}
      section{width:min(720px,100%);background:#fff;border:1px solid #d8dee7;border-radius:8px;padding:28px;box-shadow:0 18px 45px rgba(22,28,36,.11)}
      h1{margin:0 0 10px;font-size:clamp(2rem,5vw,3.6rem);line-height:1.05;letter-spacing:0}
      p{margin:0 0 22px;color:#5f6875;font-size:1.05rem}
      .actions{display:flex;flex-wrap:wrap;gap:10px}
      a{display:inline-flex;min-height:44px;align-items:center;justify-content:center;padding:0 18px;border-radius:7px;background:#2f74d0;color:#fff;font-weight:750;text-decoration:none}
      a.secondary{background:#eef2f7;color:#263142;border:1px solid #cbd5e1}
      a:focus-visible,a:hover{background:#1f5ead}
      a.secondary:focus-visible,a.secondary:hover{background:#e2e8f0}
    </style>
  </head>
  <body>
    <main>
      <section>
        <h1>Genaie Service Desk</h1>
        <p>This app is being prepared for the next public service surfaces. The Webetu guide and Gmail connection live on their own routes.</p>
        <div class="actions">
          <a href="${homePath}/connect-gmail">Connect Gmail</a>
          <a class="secondary" href="${homePath}/onboarding">Open Webetu onboarding</a>
        </div>
      </section>
    </main>
  </body>
</html>`;
}

async function route(req, res) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);
  const isRead = req.method === "GET" || req.method === "HEAD";
  const scoped = scopedRouteForPath(pathname);

  if (!(await enforceRouteProtection(req, res, url, pathname))) return;

  if (isRead && scoped) return handleScopedPage(req, res, scoped);
  if (isRead && pathname === "/") return redirectToScopedPath(req, res);
  if (isRead && pathname === "/login") return htmlResponse(res, 200, loginPage());
  if (isRead && pathname === "/auth/firebase/finish") return htmlResponse(res, 200, firebaseFinishPage());
  if (isRead && pathname === "/connect-gmail") return redirectToScopedPath(req, res, "/connect-gmail");
  if (isRead && pathname === "/config/firebase") return jsonResponse(res, 200, firebaseWebConfig());
  if (req.method === "POST" && pathname === "/auth/session") return handleCreateSession(req, res);
  if (req.method === "GET" && pathname === "/auth/session") return handleSessionStatus(req, res);
  if (req.method === "POST" && pathname === "/auth/session/logout") return handleLogoutSession(req, res);
  if (isRead && (pathname === "/onboarding" || pathname === "/onboarding/")) {
    return redirectToScopedPath(req, res, "/onboarding");
  }
  if (isRead && pathname === "/onboarding/styles.css") {
    return redirectToScopedPath(req, res, "/onboarding/styles.css");
  }
  if (isRead && pathname.startsWith("/onboarding/assets/")) {
    return redirectToScopedPath(req, res, pathname);
  }
  if (isRead && pathname === "/health") return jsonResponse(res, 200, { ok: true });
  if (req.method === "POST" && pathname === "/auth/google/start") return handleStart(req, res);
  if (req.method === "GET" && pathname === "/auth/google/start") {
    throw httpError(405, "Use the scoped Connect Gmail page to start Gmail OAuth.");
  }
  if (req.method === "GET" && pathname === "/auth/google/callback") return handleCallback(req, res, url);
  if (req.method === "GET" && pathname === "/auth/google/status") return handleStatus(req, res);
  if (req.method === "POST" && pathname === "/auth/google/revoke") return handleRevoke(req, res);
  if (req.method === "POST" && pathname === "/gmail/send") return handleSend(req, res);
  if (req.method === "POST" && pathname === "/internal/gmail/send") return handleInternalSend(req, res);
  if (req.method === "GET" && pathname === "/internal/gmail/senders") return handleInternalSenders(req, res);
  if (req.method === "GET" && pathname === "/internal/central-data/status") {
    return handleInternalCentralDataStatus(req, res);
  }
  if (req.method === "POST" && pathname === "/internal/central-data/backfill") {
    return handleInternalCentralDataBackfill(req, res);
  }
  throw httpError(404, "Not found.");
}

const server = http.createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (err) {
    const status = err.status ?? 500;
    const payload = { ok: false, error: err.message ?? "Internal server error" };
    if (req.headers.accept?.includes("text/html")) {
      return htmlResponse(res, status, `<!doctype html><title>${status}</title><p>${payload.error}</p>`);
    }
    return jsonResponse(res, status, payload);
  }
});

server.listen(config.port, config.host, () => {
  console.log(`Agent Genaie listening on http://${config.host}:${config.port}`);
});
