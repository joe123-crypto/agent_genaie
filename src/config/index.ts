import fsSync from "node:fs";
import path from "node:path";

const rootDir = process.cwd();

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
export const DEFAULT_PUBLIC_BASE_URL = "http://localhost:3010";
export const DEFAULT_PASSBOLT_PUBLIC_URL = "https://your-passbolt-domain.example";
export const DEFAULT_PENDING_LINKS_CACHE_PATH = "/home/joseph/.openclaw/workspace/account-link/pending-links.json";
export const SESSION_COOKIE_NAME = "agent_genaie_session";
export const SESSION_COOKIE_MAX_AGE_SECONDS = 14 * 24 * 60 * 60;
export const JOB_SCOUT_SETUP_TTL_SECONDS = 24 * 60 * 60;
export const ACCOUNT_LINK_SETUP_TTL_SECONDS = 24 * 60 * 60;

export function loadDotEnv() {
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

// Ensure .env is loaded before exporting config
loadDotEnv();

const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? DEFAULT_PUBLIC_BASE_URL;

export const config = {
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
  pendingLinksCachePath: path.resolve(process.env.PENDING_LINKS_CACHE_PATH ?? DEFAULT_PENDING_LINKS_CACHE_PATH),
};

export function requireConfig(keys: (keyof typeof config)[]) {
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
  
  const err = new Error(`Missing required environment: ${names}`) as Error & { status?: number };
  err.status = 500;
  throw err;
}

export function firebaseWebConfig() {
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
