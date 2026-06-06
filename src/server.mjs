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
const JOB_SCOUT_SETUP_TTL_SECONDS = 24 * 60 * 60;
const ACCOUNT_LINK_SETUP_TTL_SECONDS = 24 * 60 * 60;
const WEBETU_FALLBACK_RESTAURANT = Object.freeze({
  catalogId: "bab-ezzouar-03",
  name: "الإقامة الجامعية 03 باب الزوار",
  idDepot: 190,
  residence: 5185801,
  wilaya: null,
  active: true,
});

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
  jobScoutSetupSecret:
    process.env.JOB_SCOUT_SETUP_SECRET ??
    process.env.OAUTH_STATE_SECRET ??
    process.env.TOKEN_ENCRYPTION_SECRET ??
    "",
  accountLinkSetupSecret:
    process.env.ACCOUNT_LINK_SETUP_SECRET ??
    process.env.JOB_SCOUT_SETUP_SECRET ??
    process.env.OAUTH_STATE_SECRET ??
    process.env.TOKEN_ENCRYPTION_SECRET ??
    "",
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
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
      if (key === "jobScoutSetupSecret") return "JOB_SCOUT_SETUP_SECRET";
      if (key === "accountLinkSetupSecret") return "ACCOUNT_LINK_SETUP_SECRET";
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

function normalizePhone(value) {
  const text = String(value ?? "").trim();
  const digits = text.replace(/\D/g, "");
  if (!digits) throw httpError(400, "phone is required.");
  const phone = `+${digits}`;
  if (phone.length < 9 || phone.length > 16) throw httpError(400, "phone must normalize to 9-16 digits.");
  return phone;
}

function whatsappPhoneHash(phone) {
  return crypto.createHash("sha256").update(`whatsapp:${normalizePhone(phone)}`).digest("hex").slice(0, 12);
}

function maskPhone(phoneInput) {
  const phone = normalizePhone(phoneInput);
  if (phone.length <= 7) return phone;
  return `${phone.slice(0, 4)}...${phone.slice(-4)}`;
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

function webetuCredentialRefId(userId) {
  return credentialRefId(userId, "webetu", "username_password");
}

function jobApplicationId(userId, company, role) {
  const key = [validateFirebaseUid(userId), String(company ?? "").trim().toLowerCase(), String(role ?? "").trim().toLowerCase()].join("\n");
  return crypto.createHash("sha256").update(key).digest("hex");
}

function normalizeStringList(value, maxItems = 24) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  const output = [];
  const seen = new Set();
  for (const item of values) {
    const text = String(item ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(text.slice(0, 240));
    if (output.length >= maxItems) break;
  }
  return output;
}

function normalizeJobPreferences(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const maxApplications = Number.parseInt(source.maxApplicationsPerRun ?? "2", 10);
  return {
    targetRoles: normalizeStringList(source.targetRoles ?? source.roles),
    locations: normalizeStringList(source.locations),
    qualifications: normalizeStringList(source.qualifications),
    experience: normalizeStringList(source.experience),
    skills: normalizeStringList(source.skills),
    exclusions: normalizeStringList(source.exclusions),
    promptNotes: normalizeStringList(source.promptNotes ?? source.notes, 12),
    autoApply: source.autoApply === false ? false : true,
    maxApplicationsPerRun: Number.isFinite(maxApplications) ? Math.min(Math.max(maxApplications, 0), 5) : 2,
  };
}

function normalizeCvFileRef(value) {
  const text = String(value ?? "").trim();
  if (!text) throw httpError(400, "cvFileRef is required.");
  if (text.length > 500) throw httpError(400, "cvFileRef is too long.");
  if (text.includes("\0")) throw httpError(400, "cvFileRef is invalid.");
  return text;
}

function normalizeWebetuCredentials(input = {}) {
  const username = rejectHeaderInjection(input.username, "username");
  const password = String(input.password ?? "");
  if (!username) throw httpError(400, "username is required.");
  if (username.length > 120) throw httpError(400, "username is too long.");
  if (!password) throw httpError(400, "password is required.");
  if (password.length > 256) throw httpError(400, "password is too long.");
  if (password.includes("\0")) throw httpError(400, "password is invalid.");
  return { username, password };
}

function normalizeRestaurantLookup(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function normalizeRestaurantDate(value) {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw httpError(400, "date must be YYYY-MM-DD.");
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw httpError(400, "date must be a valid calendar date.");
  }
  return text;
}

function webetuRestaurantOverrideId(userId, date) {
  return `${validateFirebaseUid(userId)}_${normalizeRestaurantDate(date)}`;
}

function builtInWebetuRestaurants() {
  return [WEBETU_FALLBACK_RESTAURANT];
}

function publicRestaurantFields(entry) {
  if (!entry) return null;
  const name = entry.name ?? entry.nameAR ?? entry.nameFR ?? "";
  return {
    catalogId: entry.catalogId ?? null,
    name,
    nameAR: entry.nameAR ?? null,
    nameFR: entry.nameFR ?? null,
    breakfast: entry.breakfast == null ? null : Boolean(entry.breakfast),
    lunch: entry.lunch == null ? null : Boolean(entry.lunch),
    dinner: entry.dinner == null ? null : Boolean(entry.dinner),
  };
}

function storedRestaurantFields(entry, source = "catalog") {
  if (!entry || !entry.name || !entry.idDepot) throw httpError(400, "Restaurant entry is incomplete.");
  return {
    catalogId: entry.catalogId ?? `onou-depot-${Number(entry.idDepot)}`,
    name: entry.name,
    nameAR: entry.nameAR ?? null,
    nameFR: entry.nameFR ?? null,
    idDepot: Number(entry.idDepot),
    residence: entry.residence == null ? null : Number(entry.residence),
    wilaya: entry.wilaya == null ? null : String(entry.wilaya),
    breakfast: entry.breakfast == null ? null : Boolean(entry.breakfast),
    lunch: entry.lunch == null ? null : Boolean(entry.lunch),
    dinner: entry.dinner == null ? null : Boolean(entry.dinner),
    source,
    selectedAt: FieldValue.serverTimestamp(),
    lastVerifiedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

function liveWebetuRestaurantFromPayload(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw httpError(400, "restaurant must be a supported restaurant object.");
  }
  const idDepot = Number(input.idDepot ?? input.id_depot ?? input.id);
  if (!Number.isInteger(idDepot) || idDepot <= 0) {
    throw httpError(400, "restaurant idDepot is required.");
  }
  const nameAR = String(input.nameAR ?? input.nameAr ?? input.name_ar ?? "").trim();
  const nameFR = String(input.nameFR ?? input.nameFr ?? input.name_fr ?? input.nameEN ?? "").trim();
  const name = String(input.name ?? (nameAR || nameFR)).trim();
  if (!name) throw httpError(400, "restaurant name is required.");
  return {
    catalogId: String(input.catalogId ?? input.catalog_id ?? `onou-depot-${idDepot}`),
    name,
    nameAR: nameAR || name,
    nameFR: nameFR || name,
    idDepot,
    residence: input.residence == null || input.residence === "" ? null : Number(input.residence),
    wilaya: input.wilaya == null || input.wilaya === "" ? null : String(input.wilaya),
    breakfast: input.breakfast == null ? null : Boolean(input.breakfast),
    lunch: input.lunch == null ? null : Boolean(input.lunch),
    dinner: input.dinner == null ? null : Boolean(input.dinner),
    source: String(input.source ?? "onou_getdepotres"),
  };
}

async function ensureWebetuRestaurantCatalog() {
  const db = getFirestoreDb();
  const batch = db.batch();
  let writes = 0;
  for (const restaurant of builtInWebetuRestaurants()) {
    const ref = db.collection("webetuRestaurantCatalog").doc(restaurant.catalogId);
    const snap = await ref.get();
    if (snap.exists) continue;
    batch.set(
      ref,
      {
        ...restaurant,
        searchName: normalizeRestaurantLookup(restaurant.name),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    writes += 1;
  }
  if (writes > 0) await batch.commit();
}

async function listWebetuRestaurantCatalog() {
  await ensureWebetuRestaurantCatalog();
  const snapshot = await getFirestoreDb().collection("webetuRestaurantCatalog").where("active", "==", true).get();
  const restaurants = [];
  const seen = new Set();
  for (const restaurant of builtInWebetuRestaurants()) {
    restaurants.push({ ...restaurant, searchName: normalizeRestaurantLookup(restaurant.name) });
    seen.add(restaurant.catalogId);
  }
  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (seen.has(doc.id)) continue;
    if (!data?.name || !data?.idDepot) continue;
    restaurants.push({
      catalogId: data.catalogId ?? doc.id,
      name: String(data.name),
      idDepot: Number(data.idDepot),
      residence: data.residence == null ? null : Number(data.residence),
      wilaya: data.wilaya == null ? null : String(data.wilaya),
      active: data.active !== false,
      searchName: data.searchName ?? normalizeRestaurantLookup(data.name),
    });
  }
  restaurants.sort((a, b) => String(a.name).localeCompare(String(b.name), "ar"));
  return restaurants;
}

async function resolveWebetuRestaurant(input) {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return liveWebetuRestaurantFromPayload(input);
  }
  const lookup = normalizeRestaurantLookup(input);
  if (!lookup) throw httpError(400, "restaurant is required.");
  const restaurants = await listWebetuRestaurantCatalog();
  const match = restaurants.find(
    (entry) => normalizeRestaurantLookup(entry.catalogId) === lookup || normalizeRestaurantLookup(entry.name) === lookup,
  );
  if (!match) {
    throw httpError(404, "Restaurant is not supported yet. Ask for the supported restaurant list.");
  }
  return match;
}

function usernameHash(username) {
  return crypto.createHash("sha256").update(`webetu:${String(username ?? "").trim()}`).digest("hex").slice(0, 16);
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
  const providerIds = Array.isArray(user.providerData)
    ? user.providerData.map((entry) => entry.providerId).filter(Boolean)
    : [];
  return {
    userId: user.uid,
    updatedAt: FieldValue.serverTimestamp(),
    profile: {
      email: user.email ?? "",
      emailLower: user.email ? String(user.email).trim().toLowerCase() : "",
      emailVerified: Boolean(user.emailVerified),
      displayName: user.displayName ?? null,
      photoUrl: user.photoURL ?? null,
      firstName,
      lastName,
    },
    identities: {
      firebaseUid: user.uid,
      googleProviderUid: googleProvider?.uid ?? null,
      providerIds,
    },
  };
}

function isGoogleSignIn(decodedToken) {
  return decodedToken?.firebase?.sign_in_provider === "google.com";
}

async function assertNoDuplicateCentralEmail(firebaseUser) {
  if (!isGoogleSignIn(firebaseUser)) return;
  const email = String(firebaseUser.email ?? "").trim();
  if (!email) return;
  const emailLower = email.toLowerCase();
  const db = getFirestoreDb();
  const matches = new Map();
  const exact = await db.collection("users").where("profile.email", "==", email).limit(5).get();
  for (const doc of exact.docs) matches.set(doc.id, doc);
  const lower = await db.collection("users").where("profile.emailLower", "==", emailLower).limit(5).get();
  for (const doc of lower.docs) matches.set(doc.id, doc);
  for (const docId of matches.keys()) {
    if (docId !== firebaseUser.uid) {
      throw httpError(409, "A different app account already uses this email. Sign in with your original method or ask support to link the accounts.");
    }
  }
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

async function getWebetuCredentialStatus(uid) {
  const user = await syncUserToCentralData(uid);
  const credId = webetuCredentialRefId(user.uid);
  const db = getFirestoreDb();
  const [snap, userSnap, webetuSnap] = await Promise.all([
    db.collection("credentialRefs").doc(credId).get(),
    db.collection("users").doc(user.uid).get(),
    db.collection("webetuUsers").doc(user.uid).get(),
  ]);
  const userData = userSnap.exists ? userSnap.data() : {};
  const identities = userData?.identities && typeof userData.identities === "object" ? userData.identities : {};
  const phone = identities.whatsappPhone ? normalizePhone(identities.whatsappPhone) : null;
  const phoneHash = identities.whatsappPhoneHash || (phone ? whatsappPhoneHash(phone) : null);
  const webetuData = webetuSnap.exists ? webetuSnap.data() : {};
  const account = {
    whatsappLinked: Boolean(phone && phoneHash),
    maskedPhone: phone ? maskPhone(phone) : null,
    phoneHash: phoneHash ? String(phoneHash).slice(0, 12) : null,
    webetuStatus: webetuData?.status ?? null,
    ...webetuPreferencesFromData(webetuData),
  };
  if (!snap.exists) {
    return {
      configured: false,
      status: "not_saved",
      updatedAt: null,
      provider: null,
      ...account,
    };
  }

  const data = snap.data();
  return {
    configured: data?.status === "ready" && Boolean(data?.encryptedSecret),
    status: data?.status ?? "not_saved",
    updatedAt: firestoreTimestampToIso(data?.updatedAt),
    provider: data?.provider?.type ?? null,
    ...account,
  };
}

async function saveWebetuCredentials(uid, body) {
  const credentials = normalizeWebetuCredentials(body);
  const user = await syncUserToCentralData(uid);
  const db = getFirestoreDb();
  const userId = user.uid;
  const credId = webetuCredentialRefId(userId);
  const subId = serviceSubscriptionId(userId, "webetu");
  const now = FieldValue.serverTimestamp();
  const [credSnap, subSnap, userSnap, webetuSnap] = await Promise.all([
    db.collection("credentialRefs").doc(credId).get(),
    db.collection("serviceSubscriptions").doc(subId).get(),
    db.collection("users").doc(userId).get(),
    db.collection("webetuUsers").doc(userId).get(),
  ]);
  const existingCred = credSnap.exists ? credSnap.data() : {};
  const existingSub = subSnap.exists ? subSnap.data() : {};
  const existingWebetu = webetuSnap.exists ? webetuSnap.data() : {};
  const userData = userSnap.exists ? userSnap.data() : {};
  const identities = userData?.identities && typeof userData.identities === "object" ? userData.identities : {};
  const phone = identities.whatsappPhone ? normalizePhone(identities.whatsappPhone) : null;
  const phoneHash = identities.whatsappPhoneHash || (phone ? whatsappPhoneHash(phone) : null);
  const webetuStatus = phone && phoneHash ? "active" : "credential_ready";
  const encryptedSecret = encryptCentralSecret(credentials, `credentialRefs/${credId}`);
  const batch = db.batch();

  batch.set(
    db.collection("users").doc(userId),
    {
      updatedAt: now,
      serviceStatus: {
        webetu: webetuStatus,
      },
    },
    { merge: true },
  );

  batch.set(
    db.collection("serviceSubscriptions").doc(subId),
    {
      subscriptionId: subId,
      userId,
      service: "webetu",
      status: webetuStatus === "active" ? "active" : "pending",
      createdAt: existingSub?.createdAt ?? now,
      updatedAt: now,
      preferences: existingSub?.preferences && typeof existingSub.preferences === "object" ? existingSub.preferences : {},
      metadata: {
        ...(existingSub?.metadata && typeof existingSub.metadata === "object" ? existingSub.metadata : {}),
        credentialRefId: credId,
        setupStatus: webetuStatus,
        phoneLinkRef: phoneHash ? `phoneLinks/${phoneHash}` : null,
        setupSource: "dashboard",
      },
    },
    { merge: true },
  );

  batch.set(
    db.collection("credentialRefs").doc(credId),
    {
      credentialRefId: credId,
      userId,
      service: "webetu",
      purpose: "username_password",
      provider: {
        type: "firestore_encrypted",
        ref: `credentialRefs/${credId}`,
        project: config.firebaseProjectId || null,
        environment: "prod",
      },
      status: "ready",
      encryptedSecret,
      metadata: {
        ...(existingCred?.metadata && typeof existingCred.metadata === "object" ? existingCred.metadata : {}),
        usernameHash: usernameHash(credentials.username),
        source: "dashboard",
      },
      createdAt: existingCred?.createdAt ?? now,
      updatedAt: now,
      lastVerifiedAt: null,
      revokedAt: null,
    },
    { merge: true },
  );

  batch.set(
    db.collection("webetuUsers").doc(userId),
    {
      webetuUserId: userId,
      userId,
      firebaseUid: userId,
      publicUserId: user.publicUserId ?? userData?.publicUserId ?? null,
      profileRef: `users/${userId}`,
      credentialRefId: credId,
      credentialProvider: "firestore_encrypted",
      status: webetuStatus,
      delivery: {
        channel: "whatsapp",
        phoneLinkRef: phoneHash ? `phoneLinks/${phoneHash}` : null,
        phoneHash: phoneHash ? String(phoneHash).slice(0, 12) : null,
      },
      createdAt: existingWebetu?.createdAt ?? now,
      updatedAt: now,
      disabledAt: null,
    },
    { merge: true },
  );

  await batch.commit();
  return {
    configured: true,
    status: "ready",
    updatedAt: new Date().toISOString(),
    provider: "firestore_encrypted",
    whatsappLinked: Boolean(phone && phoneHash),
    maskedPhone: phone ? maskPhone(phone) : null,
    phoneHash: phoneHash ? String(phoneHash).slice(0, 12) : null,
    webetuStatus,
  };
}

async function revokeWebetuCredentials(uid) {
  const user = await syncUserToCentralData(uid);
  const db = getFirestoreDb();
  const userId = user.uid;
  const credId = webetuCredentialRefId(userId);
  const subId = serviceSubscriptionId(userId, "webetu");
  const now = FieldValue.serverTimestamp();
  const [credSnap, subSnap, userSnap] = await Promise.all([
    db.collection("credentialRefs").doc(credId).get(),
    db.collection("serviceSubscriptions").doc(subId).get(),
    db.collection("users").doc(userId).get(),
  ]);
  const existingCred = credSnap.exists ? credSnap.data() : {};
  const existingSub = subSnap.exists ? subSnap.data() : {};
  const userData = userSnap.exists ? userSnap.data() : {};
  const identities = userData?.identities && typeof userData.identities === "object" ? userData.identities : {};
  const phone = identities.whatsappPhone ? normalizePhone(identities.whatsappPhone) : null;
  const phoneHash = identities.whatsappPhoneHash || (phone ? whatsappPhoneHash(phone) : null);
  const batch = db.batch();

  batch.set(
    db.collection("users").doc(userId),
    {
      updatedAt: now,
      serviceStatus: {
        webetu: "disabled",
      },
    },
    { merge: true },
  );

  batch.set(
    db.collection("serviceSubscriptions").doc(subId),
    {
      subscriptionId: subId,
      userId,
      service: "webetu",
      status: "disabled",
      createdAt: existingSub?.createdAt ?? now,
      updatedAt: now,
      preferences: existingSub?.preferences && typeof existingSub.preferences === "object" ? existingSub.preferences : {},
      metadata: {
        ...(existingSub?.metadata && typeof existingSub.metadata === "object" ? existingSub.metadata : {}),
        credentialRefId: credId,
        setupSource: "dashboard",
      },
    },
    { merge: true },
  );

  batch.set(
    db.collection("credentialRefs").doc(credId),
    {
      credentialRefId: credId,
      userId,
      service: "webetu",
      purpose: "username_password",
      provider: existingCred?.provider ?? {
        type: "firestore_encrypted",
        ref: `credentialRefs/${credId}`,
        project: config.firebaseProjectId || null,
        environment: "prod",
      },
      status: "revoked",
      encryptedSecret: null,
      metadata: {
        ...(existingCred?.metadata && typeof existingCred.metadata === "object" ? existingCred.metadata : {}),
        source: "dashboard",
      },
      createdAt: existingCred?.createdAt ?? now,
      updatedAt: now,
      lastVerifiedAt: existingCred?.lastVerifiedAt ?? null,
      revokedAt: now,
    },
    { merge: true },
  );

  batch.set(
    db.collection("webetuUsers").doc(userId),
    {
      webetuUserId: userId,
      userId,
      firebaseUid: userId,
      publicUserId: user.publicUserId ?? null,
      profileRef: `users/${userId}`,
      credentialRefId: credId,
      credentialProvider: "firestore_encrypted",
      status: "disabled",
      updatedAt: now,
      disabledAt: now,
    },
    { merge: true },
  );

  await batch.commit();
  return {
    configured: false,
    status: "revoked",
    updatedAt: new Date().toISOString(),
    provider: "firestore_encrypted",
    whatsappLinked: Boolean(phone && phoneHash),
    maskedPhone: phone ? maskPhone(phone) : null,
    phoneHash: phoneHash ? String(phoneHash).slice(0, 12) : null,
    webetuStatus: "disabled",
  };
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

function jobScoutTokenHash(token) {
  requireConfig(["jobScoutSetupSecret"]);
  return crypto.createHmac("sha256", config.jobScoutSetupSecret).update(String(token ?? "")).digest("hex");
}

function accountLinkTokenHash(token) {
  requireConfig(["accountLinkSetupSecret"]);
  return crypto.createHmac("sha256", config.accountLinkSetupSecret).update(String(token ?? "")).digest("hex");
}

function firestoreTimestampToIso(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return null;
}

function normalizeAccountLinkPurpose(value) {
  const purpose = String(value ?? "account").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 40);
  if (!purpose) return "account";
  return purpose;
}

function normalizeAccountLinkNextPath(value) {
  const text = String(value ?? "/").trim();
  if (!text || !text.startsWith("/") || text.startsWith("//")) return "/";
  if (text === "/" || text === "/connect-gmail" || text === "/vault" || text === "/onboarding") return text;
  const match = text.match(/^\/(connect-gmail|vault|onboarding)\/?(\?.*)?$/);
  if (match) return `/${match[1]}${match[2] ?? ""}`;
  return "/";
}

function scopedPathForAccountLink(nextPath, publicUserId) {
  const id = validatePublicUserId(publicUserId);
  const normalized = normalizeAccountLinkNextPath(nextPath);
  if (normalized === "/") return `/${id}`;
  if (normalized === "/connect-gmail") return `/${id}/connect-gmail`;
  if (normalized === "/vault") return `/${id}/vault`;
  if (normalized === "/onboarding") return "/onboarding";
  return `/${id}`;
}

async function writePhoneLinkForUser(db, user, phoneInput, options = {}) {
  const phone = normalizePhone(phoneInput);
  const phoneHash = whatsappPhoneHash(phone);
  const ref = db.collection("phoneLinks").doc(phoneHash);
  const existing = await ref.get();
  if (existing.exists) {
    const data = existing.data();
    if (data?.userId && data.userId !== user.uid && !data?.revokedAt) {
      throw httpError(409, "This WhatsApp phone is already linked to another app account.");
    }
  }

  return {
    ref,
    phone,
    phoneHash,
    data: {
      phoneHash,
      phone,
      userId: user.uid,
      firebaseUid: user.uid,
      publicUserId: user.publicUserId ?? null,
      channel: "whatsapp",
      source: options.source ?? "account_link",
      purpose: normalizeAccountLinkPurpose(options.purpose),
      status: "linked",
      createdAt: existing.exists ? existing.data()?.createdAt ?? FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      linkedAt: FieldValue.serverTimestamp(),
      revokedAt: null,
    },
  };
}

async function createAccountLinkInvite(body) {
  const phone = normalizePhone(body.phone);
  const phoneHash = whatsappPhoneHash(phone);
  const parsedTtl = Number.parseInt(body.ttlSeconds ?? `${ACCOUNT_LINK_SETUP_TTL_SECONDS}`, 10);
  const ttlSeconds = Number.isFinite(parsedTtl)
    ? Math.min(Math.max(parsedTtl, 300), 7 * 24 * 60 * 60)
    : ACCOUNT_LINK_SETUP_TTL_SECONDS;
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = accountLinkTokenHash(token);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  const purpose = normalizeAccountLinkPurpose(body.purpose);
  const nextPath = normalizeAccountLinkNextPath(body.nextPath);

  await getFirestoreDb().collection("accountLinkInvites").doc(tokenHash).set({
    tokenHash,
    channel: "whatsapp",
    phone,
    phoneHash,
    purpose,
    nextPath,
    status: "created",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    expiresAt,
    usedAt: null,
    usedBy: null,
  });

  const setupUrl = new URL("/account-link/setup", config.publicBaseUrl);
  setupUrl.searchParams.set("token", token);
  return { setupUrl: setupUrl.toString(), phoneHash, purpose, nextPath, expiresAt: expiresAt.toISOString(), ttlSeconds };
}

async function getAccountLinkInvite(token) {
  const text = String(token ?? "").trim();
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(text)) throw httpError(400, "Invalid account link token.");
  const tokenHash = accountLinkTokenHash(text);
  const ref = getFirestoreDb().collection("accountLinkInvites").doc(tokenHash);
  const snap = await ref.get();
  if (!snap.exists) throw httpError(404, "Account link was not found.");
  const data = snap.data();
  const expiresAt = data?.expiresAt?.toDate?.() ?? null;
  if (!expiresAt || expiresAt.getTime() < Date.now()) throw httpError(410, "Account link expired.");
  return { ref, data };
}

async function bindAccountLinkInviteToUser(token, firebaseUser) {
  const { ref, data } = await getAccountLinkInvite(token);
  const db = getFirestoreDb();
  const user = await syncUserToCentralData(firebaseUser.uid);
  const now = FieldValue.serverTimestamp();
  const purpose = normalizeAccountLinkPurpose(data.purpose);
  const phoneLink = await writePhoneLinkForUser(db, user, data.phone, {
    purpose,
    source: "account_link_invite",
  });
  const webetuCredId = webetuCredentialRefId(user.uid);
  const webetuCredSnap = await db.collection("credentialRefs").doc(webetuCredId).get();
  const hasReadyWebetuCredential = webetuCredSnap.exists && webetuCredSnap.data()?.status === "ready" && Boolean(webetuCredSnap.data()?.encryptedSecret);
  const batch = db.batch();

  batch.set(phoneLink.ref, phoneLink.data, { merge: true });
  batch.set(
    db.collection("users").doc(user.uid),
    {
      updatedAt: now,
      identities: {
        whatsappPhone: phoneLink.phone,
        whatsappPhoneHash: phoneLink.phoneHash,
        whatsappPhoneLinkedAt: now,
      },
    },
    { merge: true },
  );
  batch.set(
    ref,
    {
      status: "used",
      usedAt: now,
      usedBy: user.uid,
      updatedAt: now,
    },
    { merge: true },
  );
  if (purpose === "webetu" || hasReadyWebetuCredential) {
    const webetuStatus = hasReadyWebetuCredential ? "active" : "pending_credentials";
    batch.set(
      db.collection("webetuUsers").doc(user.uid),
      {
        webetuUserId: user.uid,
        userId: user.uid,
        firebaseUid: user.uid,
        publicUserId: user.publicUserId ?? null,
        profileRef: `users/${user.uid}`,
        credentialRefId: webetuCredId,
        credentialProvider: "firestore_encrypted",
        status: webetuStatus,
        delivery: {
          channel: "whatsapp",
          phoneLinkRef: `phoneLinks/${phoneLink.phoneHash}`,
          phoneHash: phoneLink.phoneHash,
        },
        updatedAt: now,
        disabledAt: null,
      },
      { merge: true },
    );
    batch.set(
      db.collection("users").doc(user.uid),
      {
        updatedAt: now,
        serviceStatus: {
          webetu: webetuStatus,
        },
      },
      { merge: true },
    );
  }

  await batch.commit();
  return {
    userId: user.uid,
    publicUserId: user.publicUserId ?? null,
    email: user.email ?? null,
    phoneHash: phoneLink.phoneHash,
    maskedPhone: maskPhone(phoneLink.phone),
    purpose,
    nextPath: normalizeAccountLinkNextPath(data.nextPath),
  };
}

async function getAccountLinkStatusForPhone(phoneInput) {
  const phone = normalizePhone(phoneInput);
  const phoneHash = whatsappPhoneHash(phone);
  const db = getFirestoreDb();
  const linkSnap = await db.collection("phoneLinks").doc(phoneHash).get();
  if (linkSnap.exists && linkSnap.data()?.userId && !linkSnap.data()?.revokedAt) {
    const link = linkSnap.data();
    const userSnap = await db.collection("users").doc(link.userId).get();
    const user = userSnap.exists ? userSnap.data() : {};
    return {
      linked: true,
      phoneHash,
      maskedPhone: maskPhone(phone),
      userId: link.userId,
      publicUserId: link.publicUserId ?? user?.publicUserId ?? null,
      email: user?.profile?.email ?? null,
      status: link.status ?? "linked",
    };
  }

  const snapshot = await db.collection("users").where("identities.whatsappPhoneHash", "==", phoneHash).limit(2).get();
  if (snapshot.size > 1) throw httpError(409, "More than one app user is linked to this WhatsApp phone.");
  if (snapshot.empty) {
    return { linked: false, phoneHash, maskedPhone: maskPhone(phone), userId: null, publicUserId: null, email: null, status: "not_linked" };
  }

  const doc = snapshot.docs[0];
  const user = doc.data();
  await db.collection("phoneLinks").doc(phoneHash).set(
    {
      phoneHash,
      phone,
      userId: doc.id,
      firebaseUid: doc.id,
      publicUserId: user?.publicUserId ?? null,
      channel: "whatsapp",
      source: "users_identity_backfill",
      purpose: "account",
      status: "linked",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      linkedAt: FieldValue.serverTimestamp(),
      revokedAt: null,
    },
    { merge: true },
  );
  return {
    linked: true,
    phoneHash,
    maskedPhone: maskPhone(phone),
    userId: doc.id,
    publicUserId: user?.publicUserId ?? null,
    email: user?.profile?.email ?? null,
    status: "linked",
  };
}

async function getLinkedUserForWebetuPhone(phoneInput) {
  const status = await getAccountLinkStatusForPhone(phoneInput);
  if (!status.linked || !status.userId) {
    throw httpError(404, "This WhatsApp phone is not linked to an app account yet.");
  }
  return status;
}

function webetuPreferencesFromData(data) {
  const preferences = data?.preferences && typeof data.preferences === "object" ? data.preferences : {};
  const restaurant = preferences.defaultRestaurant && typeof preferences.defaultRestaurant === "object"
    ? preferences.defaultRestaurant
    : null;
  return {
    defaultRestaurant: publicRestaurantFields(restaurant),
  };
}

async function getWebetuPreferencesForPhone(phoneInput) {
  const linked = await getLinkedUserForWebetuPhone(phoneInput);
  const webetuSnap = await getFirestoreDb().collection("webetuUsers").doc(linked.userId).get();
  const webetuData = webetuSnap.exists ? webetuSnap.data() : {};
  return {
    linked: true,
    maskedPhone: linked.maskedPhone,
    userId: linked.userId,
    publicUserId: linked.publicUserId ?? null,
    email: linked.email ?? null,
    webetuStatus: webetuData?.status ?? null,
    ...webetuPreferencesFromData(webetuData),
  };
}

async function setWebetuDefaultRestaurantForPhone(body) {
  const linked = await getLinkedUserForWebetuPhone(body.phone);
  const restaurant = await resolveWebetuRestaurant(body.restaurant);
  const db = getFirestoreDb();
  const ref = db.collection("webetuUsers").doc(linked.userId);
  const snap = await ref.get();
  const existing = snap.exists ? snap.data() : {};
  const preferences = existing?.preferences && typeof existing.preferences === "object" ? existing.preferences : {};
  const now = FieldValue.serverTimestamp();
  const webetuStatus = existing?.status ?? "pending_credentials";
  await ref.set(
    {
      webetuUserId: linked.userId,
      userId: linked.userId,
      firebaseUid: linked.userId,
      publicUserId: linked.publicUserId ?? null,
      profileRef: `users/${linked.userId}`,
      status: webetuStatus,
      preferences: {
        ...preferences,
        defaultRestaurant: storedRestaurantFields(restaurant, restaurant.source ?? "agent_confirmed"),
      },
      delivery: {
        ...(existing?.delivery && typeof existing.delivery === "object" ? existing.delivery : {}),
        channel: "whatsapp",
        phoneLinkRef: `phoneLinks/${linked.phoneHash}`,
        phoneHash: linked.phoneHash,
      },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      disabledAt: existing?.disabledAt ?? null,
    },
    { merge: true },
  );
  return {
    linked: true,
    maskedPhone: linked.maskedPhone,
    userId: linked.userId,
    publicUserId: linked.publicUserId ?? null,
    defaultRestaurant: publicRestaurantFields(restaurant),
    status: "saved",
  };
}

async function setWebetuRestaurantOverrideForPhone(body) {
  const linked = await getLinkedUserForWebetuPhone(body.phone);
  const date = normalizeRestaurantDate(body.date);
  const restaurant = await resolveWebetuRestaurant(body.restaurant);
  const db = getFirestoreDb();
  const ref = db.collection("webetuRestaurantOverrides").doc(webetuRestaurantOverrideId(linked.userId, date));
  const existing = await ref.get();
  const now = FieldValue.serverTimestamp();
  await ref.set(
    {
      overrideId: ref.id,
      userId: linked.userId,
      date,
      restaurant: storedRestaurantFields(restaurant, restaurant.source ?? "agent_confirmed"),
      status: "active",
      source: "agent_confirmed",
      createdAt: existing.exists ? existing.data()?.createdAt ?? now : now,
      updatedAt: now,
    },
    { merge: true },
  );
  return {
    linked: true,
    maskedPhone: linked.maskedPhone,
    userId: linked.userId,
    publicUserId: linked.publicUserId ?? null,
    date,
    restaurant: publicRestaurantFields(restaurant),
    status: "saved",
  };
}

async function getSignedInAccountStatus(uid) {
  const user = await syncUserToCentralData(uid);
  const snap = await getFirestoreDb().collection("users").doc(user.uid).get();
  const data = snap.exists ? snap.data() : {};
  const identities = data?.identities && typeof data.identities === "object" ? data.identities : {};
  const phone = identities.whatsappPhone ? normalizePhone(identities.whatsappPhone) : null;
  const phoneHash = identities.whatsappPhoneHash || (phone ? whatsappPhoneHash(phone) : null);
  return {
    userId: user.uid,
    publicUserId: user.publicUserId ?? data?.publicUserId ?? null,
    email: user.email ?? data?.profile?.email ?? null,
    profile: data?.profile ?? {},
    whatsappLinked: Boolean(phone && phoneHash),
    maskedPhone: phone ? maskPhone(phone) : null,
    phoneHash: phoneHash ? String(phoneHash).slice(0, 12) : null,
  };
}

async function createJobScoutInvite(phoneInput, ttlSecondsInput) {
  const phone = normalizePhone(phoneInput);
  const phoneHash = whatsappPhoneHash(phone);
  const parsedTtl = Number.parseInt(ttlSecondsInput ?? `${JOB_SCOUT_SETUP_TTL_SECONDS}`, 10);
  const ttlSeconds = Number.isFinite(parsedTtl)
    ? Math.min(Math.max(parsedTtl, 300), 7 * 24 * 60 * 60)
    : JOB_SCOUT_SETUP_TTL_SECONDS;
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = jobScoutTokenHash(token);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  await getFirestoreDb().collection("jobSetupLinks").doc(tokenHash).set({
    tokenHash,
    service: "jobs",
    channel: "whatsapp",
    phone,
    phoneHash,
    status: "created",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    expiresAt,
    usedAt: null,
    usedBy: null,
  });

  const setupUrl = new URL("/job-scout/setup", config.publicBaseUrl);
  setupUrl.searchParams.set("token", token);
  return { setupUrl: setupUrl.toString(), phoneHash, expiresAt: expiresAt.toISOString(), ttlSeconds };
}

async function getJobScoutInvite(token) {
  const text = String(token ?? "").trim();
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(text)) throw httpError(400, "Invalid Job Scout setup token.");
  const tokenHash = jobScoutTokenHash(text);
  const ref = getFirestoreDb().collection("jobSetupLinks").doc(tokenHash);
  const snap = await ref.get();
  if (!snap.exists) throw httpError(404, "Job Scout setup link was not found.");
  const data = snap.data();
  const expiresAt = data?.expiresAt?.toDate?.() ?? null;
  if (!expiresAt || expiresAt.getTime() < Date.now()) throw httpError(410, "Job Scout setup link expired.");
  return { ref, data };
}

async function bindJobScoutInviteToUser(token, firebaseUser) {
  const { ref, data } = await getJobScoutInvite(token);
  const phone = normalizePhone(data.phone);
  const phoneHash = data.phoneHash || whatsappPhoneHash(phone);
  const user = await syncUserToCentralData(firebaseUser.uid);
  const db = getFirestoreDb();
  const now = FieldValue.serverTimestamp();
  const subId = serviceSubscriptionId(user.uid, "jobs");
  const subRef = db.collection("serviceSubscriptions").doc(subId);
  const existingSub = await subRef.get();
  const existing = existingSub.exists ? existingSub.data() : {};
  const existingMetadata = existing?.metadata && typeof existing.metadata === "object" ? existing.metadata : {};
  const existingPreferences = existing?.preferences && typeof existing.preferences === "object" ? existing.preferences : {};
  const setupStatus = existingMetadata.cvFileRef ? "profile_saved" : "linked";
  const phoneLink = await writePhoneLinkForUser(db, user, phone, {
    purpose: "jobs",
    source: "job_scout_invite",
  });
  const batch = db.batch();

  batch.set(phoneLink.ref, phoneLink.data, { merge: true });

  batch.set(
    db.collection("users").doc(user.uid),
    {
      updatedAt: now,
      identities: {
        whatsappPhone: phone,
        whatsappPhoneHash: phoneHash,
      },
    },
    { merge: true },
  );

  batch.set(
    subRef,
    {
      subscriptionId: subId,
      userId: user.uid,
      service: "jobs",
      status: existing?.status === "active" ? "active" : "pending",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      preferences: existingPreferences,
      metadata: {
        ...existingMetadata,
        whatsappPhone: phone,
        whatsappPhoneHash: phoneHash,
        setupStatus,
        linkedAt: now,
      },
    },
    { merge: true },
  );

  batch.set(
    ref,
    {
      status: "used",
      usedAt: now,
      usedBy: user.uid,
      updatedAt: now,
    },
    { merge: true },
  );

  await batch.commit();
  return { userId: user.uid, publicUserId: user.publicUserId ?? null, email: user.email ?? null, phoneHash, status: setupStatus };
}

async function findJobScoutUserByPhone(phoneInput) {
  const phone = normalizePhone(phoneInput);
  const phoneHash = whatsappPhoneHash(phone);
  const snapshot = await getFirestoreDb()
    .collection("users")
    .where("identities.whatsappPhoneHash", "==", phoneHash)
    .limit(2)
    .get();
  if (snapshot.empty) throw httpError(404, "No app user is linked to this WhatsApp phone yet.");
  if (snapshot.size > 1) throw httpError(409, "More than one app user is linked to this WhatsApp phone.");
  const doc = snapshot.docs[0];
  return { userId: doc.id, user: doc.data(), phone, phoneHash };
}

async function saveJobScoutProfile(body) {
  const { userId, user, phone, phoneHash } = await findJobScoutUserByPhone(body.phone);
  const preferences = normalizeJobPreferences(body.preferences ?? body.profile ?? {});
  const cvFileRef = normalizeCvFileRef(body.cvFileRef);
  const db = getFirestoreDb();
  const subId = serviceSubscriptionId(userId, "jobs");
  const subRef = db.collection("serviceSubscriptions").doc(subId);
  const subSnap = await subRef.get();
  const existing = subSnap.exists ? subSnap.data() : {};
  const existingMetadata = existing?.metadata && typeof existing.metadata === "object" ? existing.metadata : {};
  const gmailSnap = await db.collection("gmailConnections").doc(userId).get();
  const gmail = gmailSnap.exists ? gmailSnap.data() : {};
  const senderEmail = gmail?.senderEmail ?? user?.profile?.email ?? null;
  const now = FieldValue.serverTimestamp();
  const batch = db.batch();

  batch.set(
    db.collection("users").doc(userId),
    {
      updatedAt: now,
      serviceStatus: {
        jobs: "active",
      },
      identities: {
        whatsappPhone: phone,
        whatsappPhoneHash: phoneHash,
      },
    },
    { merge: true },
  );

  batch.set(
    subRef,
    {
      subscriptionId: subId,
      userId,
      service: "jobs",
      status: "active",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      preferences,
      metadata: {
        ...existingMetadata,
        whatsappPhone: phone,
        whatsappPhoneHash: phoneHash,
        cvFileRef,
        senderEmail,
        setupStatus: "profile_saved",
        profileSource: "whatsapp",
        profileUpdatedAt: now,
      },
    },
    { merge: true },
  );

  await batch.commit();
  return { userId, publicUserId: user.publicUserId ?? null, phoneHash, status: "active", senderEmail, cvFileRef };
}

async function listJobScoutSubscribers(limitInput = 10) {
  const parsedLimit = Number.parseInt(limitInput ?? "10", 10);
  const limit = Math.min(Math.max(Number.isFinite(parsedLimit) ? parsedLimit : 10, 1), 100);
  const db = getFirestoreDb();
  const snapshot = await db.collection("serviceSubscriptions").where("service", "==", "jobs").get();
  const subscribers = [];
  const skipped = [];

  for (const doc of snapshot.docs) {
    if (subscribers.length >= limit) break;
    const sub = doc.data();
    if (sub.status !== "active") continue;
    const metadata = sub.metadata && typeof sub.metadata === "object" ? sub.metadata : {};
    const userSnap = await db.collection("users").doc(sub.userId).get();
    const gmailSnap = await db.collection("gmailConnections").doc(sub.userId).get();
    const user = userSnap.exists ? userSnap.data() : null;
    const gmail = gmailSnap.exists ? gmailSnap.data() : null;
    const missing = [];
    if (!user) missing.push("user");
    if (!metadata.whatsappPhone) missing.push("whatsapp");
    if (!metadata.cvFileRef) missing.push("cv");
    if (!gmail?.connected) missing.push("gmail");
    if (!gmail?.senderEmail) missing.push("senderEmail");
    if (missing.length > 0) {
      skipped.push({ userId: sub.userId, reason: missing.join(",") });
      continue;
    }
    subscribers.push({
      userId: sub.userId,
      subscriptionId: sub.subscriptionId ?? doc.id,
      publicUserId: user?.publicUserId ?? null,
      profile: user?.profile ?? {},
      whatsappPhone: metadata.whatsappPhone,
      whatsappPhoneHash: metadata.whatsappPhoneHash ?? whatsappPhoneHash(metadata.whatsappPhone),
      senderEmail: gmail.senderEmail,
      cvFileRef: metadata.cvFileRef,
      preferences: normalizeJobPreferences(sub.preferences),
      metadata: {
        setupStatus: metadata.setupStatus ?? null,
        profileUpdatedAt: firestoreTimestampToIso(metadata.profileUpdatedAt),
      },
    });
  }

  return { subscribers, skipped, totalSubscriptions: snapshot.size };
}

async function listJobApplications(userIdInput) {
  const userId = validateFirebaseUid(userIdInput);
  const snapshot = await getFirestoreDb().collection("jobApplications").where("userId", "==", userId).get();
  return snapshot.docs.map((doc) => ({ applicationId: doc.id, ...doc.data() }));
}

async function recordJobApplication(body) {
  const userId = validateFirebaseUid(body.userId);
  const company = String(body.company ?? "").replace(/\s+/g, " ").trim();
  const role = String(body.role ?? "").replace(/\s+/g, " ").trim();
  if (!company) throw httpError(400, "company is required.");
  if (!role) throw httpError(400, "role is required.");
  const status = String(body.status ?? "skipped");
  const allowedStatuses = new Set(["applied", "skipped", "physical_submission", "failed"]);
  if (!allowedStatuses.has(status)) throw httpError(400, "status is invalid.");

  const db = getFirestoreDb();
  const applicationId = jobApplicationId(userId, company, role);
  const ref = db.collection("jobApplications").doc(applicationId);
  const existing = await ref.get();
  if (existing.exists && body.replace !== true) {
    return { duplicate: true, applicationId, existing: existing.data() };
  }

  const userSnap = await db.collection("users").doc(userId).get();
  const gmailSnap = await db.collection("gmailConnections").doc(userId).get();
  const user = userSnap.exists ? userSnap.data() : {};
  const gmail = gmailSnap.exists ? gmailSnap.data() : {};
  const now = FieldValue.serverTimestamp();
  const record = {
    applicationId,
    userId,
    subscriptionId: serviceSubscriptionId(userId, "jobs"),
    applicant: {
      email: user?.profile?.email ?? null,
      displayName: user?.profile?.displayName ?? null,
    },
    sender: {
      email: gmail?.senderEmail ?? body.senderEmail ?? null,
      gmailConnectionId: gmailSnap.exists ? userId : null,
    },
    company,
    role,
    applicationEmail: body.applicationEmail ? rejectHeaderInjection(body.applicationEmail, "applicationEmail") : null,
    source: String(body.source ?? "").slice(0, 240),
    sourceUrl: String(body.sourceUrl ?? "").slice(0, 1000) || null,
    status,
    appliedAt: status === "applied" ? now : null,
    createdAt: existing.exists ? existing.data()?.createdAt ?? now : now,
    updatedAt: now,
    notes: body.notes ? String(body.notes).slice(0, 2000) : null,
    messageId: body.messageId ? String(body.messageId).slice(0, 240) : null,
    closing: body.closing ? String(body.closing).slice(0, 120) : null,
    matchReason: body.matchReason ? String(body.matchReason).slice(0, 1000) : null,
  };
  await ref.set(record, { merge: true });
  return { duplicate: false, applicationId, status };
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

function scopedReturnPath(value, publicUserId) {
  const basePath = `/${validatePublicUserId(publicUserId)}`;
  const text = String(value ?? "");
  if (text === basePath || text === `${basePath}/connect-gmail` || text === `${basePath}/vault`) return text;
  return null;
}

async function handleStart(req, res) {
  const firebaseUser = await verifyFirebaseRequest(req);
  const body = await readJsonBody(req);
  const centralUser = await syncUserToCentralData(firebaseUser.uid);
  requireConfig(["clientId", "oauthStateSecret"]);
  const returnPath = scopedReturnPath(body.returnPath, centralUser.publicUserId) ?? `/${centralUser.publicUserId}/connect-gmail`;
  const state = signState({ uid: firebaseUser.uid, nonce: crypto.randomUUID(), ts: Date.now(), returnPath });
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
  const fallbackReturnPath = centralConnection?.publicUserId ? `/${centralConnection.publicUserId}/connect-gmail` : "/connect-gmail";
  const returnPath = typeof state.returnPath === "string" && state.returnPath.startsWith("/") && !state.returnPath.startsWith("//")
    ? state.returnPath
    : fallbackReturnPath;
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

async function handleWebetuCredentialStatus(req, res) {
  const firebaseUser = await verifyFirebaseRequest(req);
  const status = await getWebetuCredentialStatus(firebaseUser.uid);
  jsonResponse(res, 200, status);
}

async function handleSaveWebetuCredentials(req, res) {
  const firebaseUser = await verifyFirebaseRequest(req);
  const body = await readJsonBody(req);
  const status = await saveWebetuCredentials(firebaseUser.uid, body);
  jsonResponse(res, 200, { ok: true, ...status });
}

async function handleRevokeWebetuCredentials(req, res) {
  const firebaseUser = await verifyFirebaseRequest(req);
  await readJsonBody(req);
  const status = await revokeWebetuCredentials(firebaseUser.uid);
  jsonResponse(res, 200, { ok: true, ...status });
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

async function handleInternalJobScoutInvite(req, res) {
  verifyInternalApiKey(req);
  const body = await readJsonBody(req);
  const invite = await createJobScoutInvite(body.phone, body.ttlSeconds);
  jsonResponse(res, 200, { ok: true, ...invite });
}

async function handleInternalAccountLinkInvite(req, res) {
  verifyInternalApiKey(req);
  const body = await readJsonBody(req);
  const invite = await createAccountLinkInvite(body);
  jsonResponse(res, 200, { ok: true, ...invite });
}

async function handleInternalAccountLinkStatus(req, res, url) {
  verifyInternalApiKey(req);
  const phone = url.searchParams.get("phone");
  if (!phone) throw httpError(400, "phone is required.");
  const status = await getAccountLinkStatusForPhone(phone);
  jsonResponse(res, 200, { ok: true, ...status });
}

async function handleInternalWebetuRestaurants(req, res) {
  verifyInternalApiKey(req);
  const restaurants = (await listWebetuRestaurantCatalog()).map(publicRestaurantFields);
  jsonResponse(res, 200, { ok: true, restaurants, count: restaurants.length });
}

async function handleInternalWebetuPreferences(req, res, url) {
  verifyInternalApiKey(req);
  const phone = url.searchParams.get("phone");
  if (!phone) throw httpError(400, "phone is required.");
  const preferences = await getWebetuPreferencesForPhone(phone);
  jsonResponse(res, 200, { ok: true, ...preferences });
}

async function handleInternalWebetuDefaultRestaurant(req, res) {
  verifyInternalApiKey(req);
  const body = await readJsonBody(req);
  const result = await setWebetuDefaultRestaurantForPhone(body);
  jsonResponse(res, 200, { ok: true, ...result });
}

async function handleInternalWebetuRestaurantOverride(req, res) {
  verifyInternalApiKey(req);
  const body = await readJsonBody(req);
  const result = await setWebetuRestaurantOverrideForPhone(body);
  jsonResponse(res, 200, { ok: true, ...result });
}

async function handleInternalJobScoutProfile(req, res) {
  verifyInternalApiKey(req);
  const body = await readJsonBody(req);
  const result = await saveJobScoutProfile(body);
  jsonResponse(res, 200, { ok: true, ...result });
}

async function handleInternalJobScoutSubscribers(req, res, url) {
  verifyInternalApiKey(req);
  const result = await listJobScoutSubscribers(url.searchParams.get("limit") ?? "10");
  jsonResponse(res, 200, { ok: true, ...result });
}

async function handleInternalJobScoutApplications(req, res, url) {
  verifyInternalApiKey(req);
  if (req.method === "GET") {
    const userId = url.searchParams.get("userId");
    if (!userId) throw httpError(400, "userId is required.");
    const applications = await listJobApplications(userId);
    return jsonResponse(res, 200, { ok: true, applications });
  }
  const body = await readJsonBody(req);
  const result = await recordJobApplication(body);
  return jsonResponse(res, 200, { ok: true, ...result });
}

async function handleJobScoutSetup(req, res, url) {
  const firebaseUser = req.firebaseUser ?? (await verifyFirebaseRequest(req));
  const token = url.searchParams.get("token");
  const result = await bindJobScoutInviteToUser(token, firebaseUser);
  if (result.publicUserId) {
    return redirectResponse(res, `/${validatePublicUserId(result.publicUserId)}/connect-gmail`);
  }
  return htmlResponse(res, 200, jobScoutSetupPage(result));
}

async function handleAccountLinkSetup(req, res, url) {
  const firebaseUser = req.firebaseUser ?? (await verifyFirebaseRequest(req));
  const token = url.searchParams.get("token");
  const result = await bindAccountLinkInviteToUser(token, firebaseUser);
  if (result.publicUserId) {
    return redirectResponse(res, scopedPathForAccountLink(result.nextPath, result.publicUserId));
  }
  return htmlResponse(res, 200, accountLinkSetupPage(result));
}

async function handleAccountStatus(req, res) {
  const firebaseUser = await verifyFirebaseRequest(req);
  const status = await getSignedInAccountStatus(firebaseUser.uid);
  jsonResponse(res, 200, status);
}

async function handleCreateSession(req, res) {
  const body = await readJsonBody(req);
  const idToken = typeof body.idToken === "string" ? body.idToken.trim() : "";
  const firebaseUser = await verifyFirebaseIdToken(idToken);
  await assertNoDuplicateCentralEmail(firebaseUser);
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
      button.google{width:100%;background:#fff;color:#202124;border:1px solid #cbd5e1;gap:10px}
      button.google:before{content:"G";display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:#f8fafc;color:#1a73e8;font-weight:900}
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
      .divider{display:flex;align-items:center;gap:12px;margin:18px 0;color:#6b7280;font-size:.92rem}
      .divider:before,.divider:after{content:"";height:1px;background:#d8dee7;flex:1}
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

function jobScoutSetupPage(result) {
  const connectPath = result.publicUserId ? `/${validatePublicUserId(result.publicUserId)}/connect-gmail` : "/connect-gmail";
  const email = result.email ? escapeHtml(result.email) : "your signed-in account";
  return authPage(
    "Job Scout setup",
    `<a class="toplink" href="/">Back to app</a>
        <h1>Job Scout setup linked</h1>
        <p>This WhatsApp chat is now linked to ${email} for Job Scout.</p>
        <div class="meta">
          <div><strong>Status:</strong> ${escapeHtml(result.status)}</div>
        </div>
        <p style="margin-top:18px">Next, connect Gmail so applications can be sent from your approved sender account. Then return to WhatsApp and choose guided questions or CV autofill.</p>
        <div class="actions">
          <a class="button" href="${escapeHtmlAttribute(connectPath)}">Connect Gmail</a>
        </div>`,
    "",
  );
}

function accountLinkSetupPage(result) {
  const destination = result.publicUserId ? scopedPathForAccountLink(result.nextPath, result.publicUserId) : "/";
  const email = result.email ? escapeHtml(result.email) : "your signed-in account";
  return authPage(
    "Account linked",
    `<a class="toplink" href="/">Back to app</a>
        <h1>Account linked</h1>
        <p>This WhatsApp chat is now linked to ${email}.</p>
        <div class="meta">
          <div><strong>WhatsApp:</strong> ${escapeHtml(result.maskedPhone ?? "linked")}</div>
          <div><strong>Purpose:</strong> ${escapeHtml(result.purpose ?? "account")}</div>
        </div>
        <div class="actions">
          <a class="button" href="${escapeHtmlAttribute(destination)}">Continue</a>
        </div>`,
    "",
  );
}

function loginRedirectHelpersScript() {
  return `const params = new URLSearchParams(window.location.search);

function safeNext(value) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "";
}

const nextPath = safeNext(params.get("next"));

function destinationForSession(session) {
  const publicUserId = session && session.publicUserId;
  if (!publicUserId) return nextPath || "/";
  if (!nextPath || nextPath === "/") return "/" + publicUserId;
  const genericScopedMatch = nextPath.match(/^\\/(connect-gmail|vault|onboarding)\\/?(\\?.*)?$/);
  if (genericScopedMatch) {
    return "/" + publicUserId + "/" + genericScopedMatch[1] + (genericScopedMatch[2] || "");
  }
  return nextPath;
}
`;
}

function loginPage() {
  return authPage(
    "Sign in",
    `<a class="toplink" href="/">Back to app</a>
        <h1>Sign in</h1>
        <p>Continue with Google, or use an email sign-in link if you prefer.</p>
        <button class="google" data-google-submit type="button">Continue with Google</button>
        <div class="divider">or</div>
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
import { getAuth, GoogleAuthProvider, onAuthStateChanged, sendSignInLinkToEmail, signInWithPopup } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const form = document.querySelector("[data-login-form]");
const emailInput = document.querySelector("[data-email]");
const submitButton = document.querySelector("[data-submit]");
const googleButton = document.querySelector("[data-google-submit]");
const statusEl = document.querySelector("[data-status]");
const emailStorageKey = "agentGenaieEmailForSignIn";
${loginRedirectHelpersScript()}

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
  googleButton.disabled = value;
}

async function start() {
  const response = await fetch("/config/firebase");
  const settings = await response.json();
  if (!settings.configured) {
    form.hidden = true;
    googleButton.hidden = true;
    setStatus("Firebase login is not configured yet. Missing: " + settings.missing.join(", "), "error");
    return;
  }

  const app = initializeApp(settings.firebase);
  const auth = getAuth(app);
  const googleProvider = new GoogleAuthProvider();
  googleProvider.addScope("email");
  googleProvider.addScope("profile");
  googleProvider.setCustomParameters({ prompt: "select_account" });
  let manualSignInInProgress = false;

  onAuthStateChanged(auth, async function(user) {
    if (!user) return;
    if (manualSignInInProgress) return;
    try {
      const session = await createSession(user);
      window.location.assign(destinationForSession(session));
    } catch (err) {
      setStatus(err.message || "Could not create server session.", "error");
    }
  });

  googleButton.addEventListener("click", async function() {
    setBusy(true);
    setStatus("Opening Google sign-in...");
    manualSignInInProgress = true;
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const session = await createSession(result.user);
      setStatus("Signed in with Google. Opening app.", "success");
      window.location.assign(destinationForSession(session));
    } catch (err) {
      manualSignInInProgress = false;
      setStatus(err.message || "Could not finish Google sign-in.", "error");
      setBusy(false);
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
      setStatus("Check your email for the sign-in link. If you do not see it, check your Spam or Junk folder.", "success");
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
let auth;
${loginRedirectHelpersScript()}

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

async function servePublicOnboardingPage(res) {
  const html = await fs.readFile(path.join(rootDir, "index.html"), "utf8");
  const publicHtml = html.replaceAll("https://your-passbolt-domain.example", escapeHtmlAttribute(config.passboltPublicUrl));
  htmlResponse(res, 200, publicHtml);
}

function onboardingAssetPath(assetName) {
  const text = String(assetName ?? "");
  if (!text || text.includes("/") || text.includes("\\") || text.includes("..")) throw httpError(404, "Not found.");
  return path.join(rootDir, "assets", text);
}

function privacyPolicyPage() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Privacy & Policy</title>
    <style>
      :root{color-scheme:light;--bg:#f6f7f9;--panel:#fff;--border:#d8dee7;--text:#15171a;--muted:#5f6875;--blue:#2f74d0}
      *{box-sizing:border-box}
      body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--text)}
      main{min-height:100vh;padding:28px}
      .shell{width:min(860px,100%);margin:0 auto;display:grid;gap:16px}
      header,section{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:22px;box-shadow:0 12px 32px rgba(22,28,36,.07)}
      h1,h2{margin:0 0 10px;letter-spacing:0;line-height:1.2}
      h1{font-size:2rem}
      h2{font-size:1.18rem}
      p{margin:0 0 12px;color:var(--muted);line-height:1.58}
      p:last-child{margin-bottom:0}
      a{color:var(--blue);font-weight:750;text-decoration:none}
      a:hover{text-decoration:underline}
      .actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:14px}
      .button{display:inline-flex;min-height:42px;align-items:center;justify-content:center;border-radius:7px;background:var(--blue);color:#fff;padding:0 14px;text-decoration:none}
      .button.secondary{background:#eef2f7;color:#263142;border:1px solid #cbd5e1}
      @media (max-width:680px){main{padding:18px}header,section{padding:18px}}
    </style>
  </head>
  <body>
    <main>
      <div class="shell">
        <header>
          <h1>Privacy & Policy</h1>
          <p>This page explains how Genaie uses Webetu credentials and Gmail permissions.</p>
          <div class="actions">
            <a class="button" href="/login">Sign in</a>
            <a class="button secondary" href="/onboarding">Webetu onboarding</a>
          </div>
        </header>
        <section>
          <h2>Webetu Credentials</h2>
          <p>Your Webetu username and password are used only to sign in to Webetu for the meal reservation service.</p>
          <p>They are encrypted before storage. The application is designed so secret credentials are not shown to the agent or developers in the user interface, logs, or API responses.</p>
          <p>If you no longer need the service, or if you no longer trust the service, you can remove your saved credentials from the Credentials Vault. You are encouraged to remove credentials that you no longer need.</p>
        </section>
        <section>
          <h2>Gmail Permissions</h2>
          <p>The Gmail permission requested by this application is send-only. It allows the application to send emails on your behalf so it can complete job applications.</p>
          <p>This permission is not used to read your emails. It is not used for anything other than sending job application emails for services you have enabled.</p>
          <p>If you no longer need the service, or if you do not trust the service, you can revoke Gmail permission from the app. You are encouraged to revoke permissions that you no longer need.</p>
        </section>
      </div>
    </main>
  </body>
</html>`;
}

async function handleScopedPage(req, res, scoped) {
  await requireMatchingScopedUser(req, scoped.publicUserId);
  if (!scoped.rest) return htmlResponse(res, 200, rootPage(scoped.publicUserId));
  if (scoped.rest === "connect-gmail") return htmlResponse(res, 200, connectGmailPage(scoped.publicUserId));
  if (scoped.rest === "vault") return htmlResponse(res, 200, vaultPage(scoped.publicUserId));
  if (scoped.rest === "onboarding") return serveScopedOnboardingPage(res, scoped.publicUserId);
  if (scoped.rest === "onboarding/styles.css") {
    return serveFile(res, path.join(rootDir, "styles.css"));
  }
  if (scoped.rest.startsWith("onboarding/assets/")) {
    const assetName = scoped.rest.slice("onboarding/assets/".length);
    return serveFile(res, onboardingAssetPath(assetName));
  }
  throw httpError(404, "Not found.");
}

function isPublicRoute(method, pathname) {
  const isRead = method === "GET" || method === "HEAD";
  if (isRead && pathname === "/login") return true;
  if (isRead && pathname === "/auth/firebase/finish") return true;
  if (isRead && pathname === "/config/firebase") return true;
  if (isRead && pathname === "/health") return true;
  if (isRead && (pathname === "/onboarding" || pathname === "/onboarding/")) return true;
  if (isRead && pathname === "/onboarding/styles.css") return true;
  if (isRead && pathname.startsWith("/onboarding/assets/")) return true;
  if (isRead && pathname === "/privacy-policy") return true;
  if (method === "GET" && pathname === "/auth/google/callback") return true;
  if ((method === "GET" || method === "POST") && pathname === "/auth/session") return true;
  if (method === "POST" && pathname === "/auth/session/logout") return true;
  if (method === "POST" && pathname === "/internal/gmail/send") return true;
  if (method === "GET" && pathname === "/internal/gmail/senders") return true;
  if (method === "GET" && pathname === "/internal/central-data/status") return true;
  if (method === "POST" && pathname === "/internal/central-data/backfill") return true;
  if (method === "POST" && pathname === "/internal/account-link/invite") return true;
  if (method === "GET" && pathname === "/internal/account-link/status") return true;
  if (method === "GET" && pathname === "/internal/webetu/restaurants") return true;
  if (method === "GET" && pathname === "/internal/webetu/preferences") return true;
  if (method === "POST" && pathname === "/internal/webetu/preferences/default") return true;
  if (method === "POST" && pathname === "/internal/webetu/preferences/override") return true;
  if (method === "POST" && pathname === "/internal/job-scout/invite") return true;
  if (method === "POST" && pathname === "/internal/job-scout/profile") return true;
  if (method === "GET" && pathname === "/internal/job-scout/subscribers") return true;
  if ((method === "GET" || method === "POST") && pathname === "/internal/job-scout/applications") return true;
  return false;
}

function shouldRedirectToLogin(req, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  if (pathname.startsWith("/auth/") || pathname.startsWith("/gmail/")) return false;
  if (pathname === "/config/firebase" || pathname === "/health") return false;
  if (pathname === "/privacy-policy") return false;
  if (pathname === "/onboarding" || pathname === "/onboarding/" || pathname === "/onboarding/styles.css") return false;
  if (pathname.startsWith("/onboarding/assets/")) return false;
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
    <title>Genaie Dashboard</title>
    <style>
      :root{color-scheme:light;--bg:#f6f7f9;--panel:#fff;--border:#d8dee7;--text:#15171a;--muted:#5f6875;--blue:#2f74d0}
      *{box-sizing:border-box}
      body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--text)}
      main{min-height:100vh;padding:28px}
      .shell{width:min(1120px,100%);margin:0 auto;display:grid;gap:18px}
      header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:6px 0 8px}
      h1{margin:0;font-size:1.85rem;line-height:1.15;letter-spacing:0}
      h2{margin:0;font-size:1.12rem;line-height:1.25;letter-spacing:0}
      p{margin:0;color:var(--muted);line-height:1.5}
      .tabs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
      .tab{display:grid;gap:8px;min-height:132px;background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:20px;text-decoration:none;color:var(--text);box-shadow:0 14px 36px rgba(22,28,36,.08)}
      .tab:hover{border-color:#9eb6d6;box-shadow:0 18px 42px rgba(22,28,36,.12)}
      .tab:focus-visible{outline:3px solid rgba(47,116,208,.28);outline-offset:2px}
      .tab strong{font-size:1.08rem}
      .tab span{color:var(--muted);line-height:1.45}
      .status-strip{display:flex;flex-wrap:wrap;gap:10px;align-items:center;background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:14px 16px}
      .status-pill{display:inline-flex;align-items:center;min-height:30px;border-radius:999px;border:1px solid #cbd5e1;background:#f8fafc;color:#303846;padding:0 10px;font-size:.88rem;font-weight:800;white-space:nowrap}
      .status-pill[data-tone="success"]{border-color:#7fc9a2;background:#eefaf3;color:#11603a}
      .status-pill[data-tone="error"]{border-color:#f1a7a1;background:#fff1f0;color:#9f2419}
      .header-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end}
      .toplink{display:inline-flex;color:var(--blue);font-weight:750;text-decoration:none}
      .toplink:hover{text-decoration:underline}
      button.secondary{display:inline-flex;min-height:38px;align-items:center;justify-content:center;border:1px solid #cbd5e1;border-radius:7px;background:#eef2f7;color:#263142;font:inherit;font-weight:750;padding:0 12px;cursor:pointer}
      button.secondary:hover:not(:disabled){filter:brightness(.96)}
      button.secondary:disabled{opacity:.55;cursor:not-allowed}
      button.secondary:focus-visible{outline:3px solid rgba(47,116,208,.28);outline-offset:2px}
      .account-error{color:#9f2419;font-size:.95rem}
      @media (max-width:760px){main{padding:18px}.tabs{grid-template-columns:1fr}header{align-items:flex-start;flex-direction:column}}
    </style>
  </head>
  <body>
    <main>
      <div class="shell">
        <header>
          <div>
            <h1>Genaie Dashboard</h1>
            <p>Choose the service area you want to manage.</p>
          </div>
          <div class="header-actions">
            <a class="toplink" href="/privacy-policy">Privacy & Policy</a>
            <button class="secondary" data-sign-out type="button">Sign out</button>
          </div>
        </header>
        <div class="status-strip" aria-label="Account status">
          <span class="status-pill" data-whatsapp-status>WhatsApp: Checking...</span>
          <p data-account-copy>Loading account link status.</p>
          <p class="account-error" data-account-error hidden></p>
        </div>
        <div class="tabs" aria-label="Dashboard tabs">
          <a class="tab" href="${homePath}/connect-gmail">
            <strong>Connect Gmail</strong>
            <span>Approve or revoke Gmail send access for job application emails.</span>
          </a>
          <a class="tab" href="${homePath}/vault">
            <strong>Credentials Vault</strong>
            <span>Save, update, or remove encrypted Webetu credentials.</span>
          </a>
          <a class="tab" href="/onboarding">
            <strong>Webetu Onboarding</strong>
            <span>Open the public setup guide for Webetu meal reservations.</span>
          </a>
          <a class="tab" href="/privacy-policy">
            <strong>Privacy & Policy</strong>
            <span>Read how credentials and Gmail permissions are used.</span>
          </a>
        </div>
      </div>
    </main>
    <script type="module">
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const whatsappStatus = document.querySelector("[data-whatsapp-status]");
const accountCopy = document.querySelector("[data-account-copy]");
const accountError = document.querySelector("[data-account-error]");
const signOutButton = document.querySelector("[data-sign-out]");
function setWhatsAppStatus(label, tone) {
  whatsappStatus.textContent = label;
  whatsappStatus.dataset.tone = tone || "info";
}
async function signOutFirebase() {
  const response = await fetch("/config/firebase");
  const settings = await response.json().catch(function() { return {}; });
  if (!settings.configured) return;
  const app = initializeApp(settings.firebase);
  await signOut(getAuth(app));
}
async function signOutDashboard() {
  signOutButton.disabled = true;
  accountError.hidden = true;
  try {
    const response = await fetch("/auth/session/logout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: "{}"
    });
    if (!response.ok) throw new Error("Could not sign out.");
    await signOutFirebase();
    window.location.assign("/login");
  } catch (err) {
    accountError.textContent = err.message || "Could not sign out.";
    accountError.hidden = false;
    signOutButton.disabled = false;
  }
}
signOutButton.addEventListener("click", signOutDashboard);
fetch("/account/status", { credentials: "same-origin" })
  .then(function(response) { return response.json(); })
  .then(function(status) {
    if (status.whatsappLinked) {
      setWhatsAppStatus("WhatsApp: Linked", "success");
      accountCopy.textContent = "This chat is linked to " + (status.maskedPhone || "your WhatsApp number") + ".";
    } else {
      setWhatsAppStatus("WhatsApp: Not linked", "error");
      accountCopy.textContent = "Open a service link from WhatsApp to connect this login to your chat.";
    }
  })
  .catch(function() {
    setWhatsAppStatus("WhatsApp: Unavailable", "error");
    accountCopy.textContent = "Could not load account link status.";
  });
    </script>
  </body>
</html>`;
}

function vaultPage(publicUserId) {
  const homePath = `/${validatePublicUserId(publicUserId)}`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Credentials Vault</title>
    <style>
      :root{color-scheme:light;--bg:#f6f7f9;--panel:#fff;--border:#d8dee7;--text:#15171a;--muted:#5f6875;--blue:#2f74d0;--green:#11603a;--red:#b42318}
      *{box-sizing:border-box}
      body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--text)}
      main{min-height:100vh;padding:28px}
      .shell{width:min(760px,100%);margin:0 auto;display:grid;gap:18px}
      .panel{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:22px;box-shadow:0 14px 36px rgba(22,28,36,.08);display:grid;gap:16px}
      .panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
      h1{margin:0;font-size:1.85rem;line-height:1.15;letter-spacing:0}
      p{margin:0;color:var(--muted);line-height:1.5}
      label{display:grid;gap:7px;font-weight:750;color:#303846}
      form{display:grid;gap:12px}
      input{width:100%;min-height:44px;border:1px solid #b9c3d1;border-radius:7px;padding:0 12px;font:inherit;background:#fff;color:var(--text)}
      input:focus{outline:3px solid rgba(47,116,208,.18);border-color:var(--blue)}
      .password-field{position:relative;display:block}
      .password-field input{padding-right:82px}
      button.password-toggle{position:absolute;right:6px;top:50%;transform:translateY(-50%);min-height:32px;border-radius:6px;background:#eef2f7;color:#263142;border:1px solid #cbd5e1;padding:0 10px;font-size:.88rem;font-weight:800}
      .password-toggle:hover:not(:disabled){filter:brightness(.96)}
      .status-pill{display:inline-flex;align-items:center;min-height:30px;border-radius:999px;border:1px solid #cbd5e1;background:#f8fafc;color:#303846;padding:0 10px;font-size:.88rem;font-weight:800;white-space:nowrap}
      .status-pill[data-tone="success"]{border-color:#7fc9a2;background:#eefaf3;color:var(--green)}
      .status-pill[data-tone="error"]{border-color:#f1a7a1;background:#fff1f0;color:#9f2419}
      .actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
      button,a.button{display:inline-flex;min-height:42px;align-items:center;justify-content:center;border:0;border-radius:7px;background:var(--blue);color:#fff;font:inherit;font-weight:750;text-decoration:none;padding:0 14px;cursor:pointer}
      button.secondary,a.secondary{background:#eef2f7;color:#263142;border:1px solid #cbd5e1}
      button.danger{background:var(--red)}
      button:disabled{opacity:.55;cursor:not-allowed}
      button:hover:not(:disabled),a.button:hover{filter:brightness(.94)}
      button:focus-visible,a.button:focus-visible,input:focus-visible{outline:3px solid rgba(47,116,208,.28);outline-offset:2px}
      .message{min-height:22px;color:var(--muted);font-size:.95rem;line-height:1.45}
      .message[data-tone="success"]{color:var(--green)}
      .message[data-tone="error"]{color:#9f2419}
      .account-meta{display:flex;flex-wrap:wrap;gap:10px;align-items:center;color:var(--muted)}
      @media (max-width:680px){main{padding:18px}.panel{padding:18px}.panel-head{flex-direction:column}}
    </style>
  </head>
  <body>
    <main>
      <div class="shell">
        <a class="button secondary" href="${homePath}">Back to dashboard</a>
        <section class="panel" aria-labelledby="vault-title">
	          <div class="panel-head">
	            <div>
	              <h1 id="vault-title">Credentials Vault</h1>
	              <p>Save the Webetu account used for meal reservations.</p>
	            </div>
	            <span class="status-pill" data-webetu-status>Checking...</span>
	          </div>
	          <div class="account-meta">
	            <span class="status-pill" data-whatsapp-status>WhatsApp: Checking...</span>
	            <span data-whatsapp-copy>Checking account link.</span>
	          </div>
	          <form data-webetu-form>
            <label>
              Webetu username
              <input data-webetu-username name="username" autocomplete="username" maxlength="120" required>
            </label>
            <label>
              Webetu password
              <span class="password-field">
                <input data-webetu-password name="password" type="password" autocomplete="current-password" maxlength="256" required>
                <button class="password-toggle" data-webetu-password-toggle type="button" aria-label="Show Webetu password" aria-pressed="false">Show</button>
              </span>
            </label>
            <div class="actions">
              <button data-webetu-save type="submit">Save credentials</button>
              <button class="danger" data-webetu-revoke type="button" hidden>Revoke</button>
              <a class="button secondary" href="/onboarding">Webetu onboarding</a>
              <a class="button secondary" href="/privacy-policy">Privacy & Policy</a>
            </div>
          </form>
          <div class="message" data-webetu-message></div>
        </section>
      </div>
    </main>
    <script>
const webetuForm = document.querySelector("[data-webetu-form]");
const webetuUsername = document.querySelector("[data-webetu-username]");
const webetuPassword = document.querySelector("[data-webetu-password]");
const webetuPasswordToggle = document.querySelector("[data-webetu-password-toggle]");
const webetuSaveButton = document.querySelector("[data-webetu-save]");
const webetuRevokeButton = document.querySelector("[data-webetu-revoke]");
const webetuStatus = document.querySelector("[data-webetu-status]");
const webetuMessage = document.querySelector("[data-webetu-message]");
const whatsappStatus = document.querySelector("[data-whatsapp-status]");
const whatsappCopy = document.querySelector("[data-whatsapp-copy]");

function setMessage(el, message, tone) {
  el.textContent = message || "";
  el.dataset.tone = tone || "info";
}

function setPill(el, label, tone) {
  el.textContent = label;
  el.dataset.tone = tone || "info";
}

function setBusy(value) {
  webetuSaveButton.disabled = value;
  webetuRevokeButton.disabled = value;
}

function setPasswordVisible(value) {
  webetuPassword.type = value ? "text" : "password";
  webetuPasswordToggle.textContent = value ? "Hide" : "Show";
  webetuPasswordToggle.setAttribute("aria-label", value ? "Hide Webetu password" : "Show Webetu password");
  webetuPasswordToggle.setAttribute("aria-pressed", value ? "true" : "false");
}

async function readJson(response) {
  const body = await response.json().catch(function() { return {}; });
  if (!response.ok) throw new Error(body.error || "Request failed with " + response.status);
  return body;
}

function webetuLabel(status) {
  if (status && status.configured) return "Saved";
  if (status && status.status === "revoked") return "Revoked";
  if (status && status.status === "not_saved") return "Not saved";
  return "Unavailable";
}

function updateWhatsAppStatus(status) {
  if (status && status.whatsappLinked) {
    setPill(whatsappStatus, "WhatsApp: Linked", "success");
    whatsappCopy.textContent = "Reservations will report to " + (status.maskedPhone || "the linked WhatsApp chat") + ".";
    return;
  }
  setPill(whatsappStatus, "WhatsApp: Not linked", "error");
  whatsappCopy.textContent = "Open a service setup link from WhatsApp first, then return here.";
}

async function loadWebetuStatus() {
  setPill(webetuStatus, "Checking...");
  const status = await readJson(await fetch("/webetu/credentials/status", {
    method: "GET",
    credentials: "same-origin"
  }));
  const label = webetuLabel(status);
  setPill(webetuStatus, label, status.configured ? "success" : status.status === "revoked" ? "error" : "info");
  updateWhatsAppStatus(status);
  webetuSaveButton.textContent = status.configured ? "Update credentials" : "Save credentials";
  webetuRevokeButton.hidden = !status.configured;
}

webetuForm.addEventListener("submit", async function(event) {
  event.preventDefault();
  setBusy(true);
  setMessage(webetuMessage, "");
  try {
    await readJson(await fetch("/webetu/credentials", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        username: webetuUsername.value,
        password: webetuPassword.value
      })
    }));
    webetuPassword.value = "";
    setPasswordVisible(false);
    setMessage(webetuMessage, "Webetu credentials saved.", "success");
    await loadWebetuStatus();
  } catch (err) {
    setMessage(webetuMessage, err.message || "Could not save Webetu credentials.", "error");
  } finally {
    setBusy(false);
  }
});

webetuRevokeButton.addEventListener("click", async function() {
  setBusy(true);
  setMessage(webetuMessage, "");
  try {
    await readJson(await fetch("/webetu/credentials/revoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: "{}"
    }));
    webetuPassword.value = "";
    setPasswordVisible(false);
    setMessage(webetuMessage, "Webetu credentials revoked.", "success");
    await loadWebetuStatus();
  } catch (err) {
    setMessage(webetuMessage, err.message || "Could not revoke Webetu credentials.", "error");
  } finally {
    setBusy(false);
  }
});

webetuPasswordToggle.addEventListener("click", function() {
  setPasswordVisible(webetuPassword.type === "password");
  webetuPassword.focus();
});

loadWebetuStatus().catch(function(err) {
  setPill(webetuStatus, "Unavailable", "error");
  setPill(whatsappStatus, "WhatsApp: Unavailable", "error");
  setMessage(webetuMessage, err.message || "Could not load credential status.", "error");
});
</script>
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
  if (isRead && pathname === "/job-scout/setup") return handleJobScoutSetup(req, res, url);
  if (isRead && pathname === "/account-link/setup") return handleAccountLinkSetup(req, res, url);
  if (isRead && pathname === "/privacy-policy") return htmlResponse(res, 200, privacyPolicyPage());
  if (isRead && pathname === "/connect-gmail") return redirectToScopedPath(req, res, "/connect-gmail");
  if (isRead && pathname === "/vault") return redirectToScopedPath(req, res, "/vault");
  if (isRead && pathname === "/config/firebase") return jsonResponse(res, 200, firebaseWebConfig());
  if (req.method === "POST" && pathname === "/auth/session") return handleCreateSession(req, res);
  if (req.method === "GET" && pathname === "/auth/session") return handleSessionStatus(req, res);
  if (req.method === "POST" && pathname === "/auth/session/logout") return handleLogoutSession(req, res);
  if (isRead && (pathname === "/onboarding" || pathname === "/onboarding/")) {
    return servePublicOnboardingPage(res);
  }
  if (isRead && pathname === "/onboarding/styles.css") {
    return serveFile(res, path.join(rootDir, "styles.css"));
  }
  if (isRead && pathname.startsWith("/onboarding/assets/")) {
    const assetName = pathname.slice("/onboarding/assets/".length);
    return serveFile(res, onboardingAssetPath(assetName));
  }
  if (isRead && pathname === "/health") return jsonResponse(res, 200, { ok: true });
  if (req.method === "POST" && pathname === "/auth/google/start") return handleStart(req, res);
  if (req.method === "GET" && pathname === "/auth/google/start") {
    throw httpError(405, "Use the scoped Connect Gmail page to start Gmail OAuth.");
  }
  if (req.method === "GET" && pathname === "/auth/google/callback") return handleCallback(req, res, url);
  if (req.method === "GET" && pathname === "/auth/google/status") return handleStatus(req, res);
  if (req.method === "POST" && pathname === "/auth/google/revoke") return handleRevoke(req, res);
  if (req.method === "GET" && pathname === "/account/status") return handleAccountStatus(req, res);
  if (req.method === "GET" && pathname === "/webetu/credentials/status") return handleWebetuCredentialStatus(req, res);
  if (req.method === "POST" && pathname === "/webetu/credentials") return handleSaveWebetuCredentials(req, res);
  if (req.method === "POST" && pathname === "/webetu/credentials/revoke") return handleRevokeWebetuCredentials(req, res);
  if (req.method === "POST" && pathname === "/gmail/send") return handleSend(req, res);
  if (req.method === "POST" && pathname === "/internal/gmail/send") return handleInternalSend(req, res);
  if (req.method === "GET" && pathname === "/internal/gmail/senders") return handleInternalSenders(req, res);
  if (req.method === "GET" && pathname === "/internal/central-data/status") {
    return handleInternalCentralDataStatus(req, res);
  }
  if (req.method === "POST" && pathname === "/internal/central-data/backfill") {
    return handleInternalCentralDataBackfill(req, res);
  }
  if (req.method === "POST" && pathname === "/internal/account-link/invite") return handleInternalAccountLinkInvite(req, res);
  if (req.method === "GET" && pathname === "/internal/account-link/status") return handleInternalAccountLinkStatus(req, res, url);
  if (req.method === "GET" && pathname === "/internal/webetu/restaurants") return handleInternalWebetuRestaurants(req, res);
  if (req.method === "GET" && pathname === "/internal/webetu/preferences") return handleInternalWebetuPreferences(req, res, url);
  if (req.method === "POST" && pathname === "/internal/webetu/preferences/default") {
    return handleInternalWebetuDefaultRestaurant(req, res);
  }
  if (req.method === "POST" && pathname === "/internal/webetu/preferences/override") {
    return handleInternalWebetuRestaurantOverride(req, res);
  }
  if (req.method === "POST" && pathname === "/internal/job-scout/invite") return handleInternalJobScoutInvite(req, res);
  if (req.method === "POST" && pathname === "/internal/job-scout/profile") return handleInternalJobScoutProfile(req, res);
  if (req.method === "GET" && pathname === "/internal/job-scout/subscribers") {
    return handleInternalJobScoutSubscribers(req, res, url);
  }
  if ((req.method === "GET" || req.method === "POST") && pathname === "/internal/job-scout/applications") {
    return handleInternalJobScoutApplications(req, res, url);
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
