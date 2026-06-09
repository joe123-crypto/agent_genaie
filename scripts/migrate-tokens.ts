import { loadDotEnv } from "../src/config/index";
loadDotEnv();

import { config, SESSION_COOKIE_NAME } from "../src/config/index";
import { getFirestoreDb } from "../src/firebase/admin";
import { decryptJson, encryptCentralSecret } from "../src/security/crypto";
import { credentialRefId, tokenStoreKeyForUid } from "../src/lib/utils";
import { FieldValue } from "firebase-admin/firestore";
import fsSync from "node:fs";
import path from "node:path";

function readLocalStore() {
  const storePath = config.tokenStorePath;
  if (!fsSync.existsSync(storePath)) return { users: {} };
  try {
    return JSON.parse(fsSync.readFileSync(storePath, "utf8"));
  } catch (err) {
    console.error("Failed to read token store:", err);
    return { users: {} };
  }
}

async function main() {
  const store = readLocalStore();
  const users = store.users ?? {};
  const keys = Object.keys(users);

  if (keys.length === 0) {
    console.log("No local tokens to migrate.");
    return;
  }

  console.log(`Found ${keys.length} local token entries to migrate...`);
  const db = getFirestoreDb();

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const tokenStoreKey of keys) {
    const encrypted = users[tokenStoreKey]?.token;
    if (!encrypted) { skipped++; continue; }

    const tokens = decryptJson(encrypted);
    if (!tokens?.access_token) {
      console.warn(`  Skipping ${tokenStoreKey}: failed to decrypt or no access_token`);
      skipped++;
      continue;
    }

    const firebaseUid = tokenStoreKey.replace(/^gmail:/, "");
    try {
      const refId = credentialRefId(firebaseUid, "gmail", "oauth2");
      const centralTokens = {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? null,
        expiry_date: tokens.expiry_date ?? null,
        updatedAtMs: Date.now(),
        migrationSource: "migrate-tokens-script",
      };
      const secret = encryptCentralSecret(centralTokens, refId);
      const credsRef = db.collection("credentialRefs").doc(refId);
      const existing = await credsRef.get();
      if (existing.exists) {
        console.log(`  Updating existing credentialRef for ${firebaseUid}`);
        await credsRef.update({ secret, updatedAt: FieldValue.serverTimestamp() });
      } else {
        console.log(`  Creating credentialRef for ${firebaseUid}`);
        await credsRef.set({
          userId: firebaseUid,
          service: "gmail",
          purpose: "oauth2",
          secret,
          status: "active",
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          lastVerifiedAt: FieldValue.serverTimestamp(),
        });
        const userRef = db.collection("users").doc(firebaseUid);
        const userDoc = await userRef.get();
        if (userDoc.exists) {
          await userRef.update({
            "services.gmail": "connected",
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      }
      migrated++;
    } catch (err) {
      console.error(`  Failed to migrate ${tokenStoreKey}:`, err);
      failed++;
    }
  }

  console.log(`\nMigration complete: ${migrated} migrated, ${skipped} skipped, ${failed} failed.`);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
