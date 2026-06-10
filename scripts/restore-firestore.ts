import { loadDotEnv } from "../src/config/index";
loadDotEnv();

import { config } from "../src/config/index";
import { getFirestoreDb, getFirebaseAdminAuth } from "../src/firebase/admin";
import { Timestamp, GeoPoint } from "firebase-admin/firestore";
import type { UserImportRecord } from "firebase-admin/auth";
import fsSync from "node:fs";

const BATCH_LIMIT = 450; // Firestore hard limit is 500 writes/batch; stay under.

type DocEntry = { id: string; data: Record<string, unknown> };
type Backup = {
  meta: { projectId: string; exportedAt: string; version: number };
  firestore: Record<string, DocEntry[]>;
  authUsers: Record<string, unknown>[];
};

/** Reverse of the backup encoder: turn `__type` markers back into Firestore types. */
function decodeValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(decodeValue);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    switch (obj.__type) {
      case "timestamp":
        return new Timestamp(obj.seconds as number, obj.nanoseconds as number);
      case "geopoint":
        return new GeoPoint(obj.latitude as number, obj.longitude as number);
      case "ref":
        return getFirestoreDb().doc(obj.path as string);
      case "bytes":
        return Buffer.from(obj.base64 as string, "base64");
      default: {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(obj)) out[k] = decodeValue(v);
        return out;
      }
    }
  }
  return value;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const file = args.find((a) => !a.startsWith("--"));
  return { file, yes: flags.has("--yes"), force: flags.has("--force") };
}

async function restoreFirestore(backup: Backup): Promise<{ collections: number; docs: number }> {
  const db = getFirestoreDb();
  let docs = 0;
  const collectionPaths = Object.keys(backup.firestore);
  for (const collPath of collectionPaths) {
    const entries = backup.firestore[collPath];
    let batch = db.batch();
    let ops = 0;
    for (const entry of entries) {
      const ref = db.collection(collPath).doc(entry.id);
      batch.set(ref, decodeValue(entry.data) as FirebaseFirestore.DocumentData);
      ops++;
      docs++;
      if (ops >= BATCH_LIMIT) {
        await batch.commit();
        batch = db.batch();
        ops = 0;
      }
    }
    if (ops > 0) await batch.commit();
    console.log(`  ${collPath}: restored ${entries.length} docs`);
  }
  return { collections: collectionPaths.length, docs };
}

async function restoreAuthUsers(backup: Backup): Promise<void> {
  const auth = getFirebaseAdminAuth();
  const records: UserImportRecord[] = [];
  const skipped: string[] = [];

  for (const u of backup.authUsers) {
    const user = u as Record<string, any>;
    const record: UserImportRecord = {
      uid: user.uid,
      email: user.email,
      emailVerified: user.emailVerified,
      displayName: user.displayName,
      photoURL: user.photoURL,
      phoneNumber: user.phoneNumber,
      disabled: user.disabled,
      customClaims: user.customClaims,
      providerData: user.providerData,
    };
    if (user.passwordHash) record.passwordHash = Buffer.from(user.passwordHash, "base64");
    if (user.passwordSalt) record.passwordSalt = Buffer.from(user.passwordSalt, "base64");
    if (user.passwordHash) skipped.push(user.uid); // track: needs original hash config to verify
    records.push(record);
  }

  if (records.length === 0) {
    console.log("  No auth users to restore.");
    return;
  }

  // importUsers without a hash config recreates accounts and metadata. Existing
  // password hashes are only verifiable if the project's original hash algorithm
  // config is supplied; without it those users can still sign in via OAuth/email-link
  // but password sign-in may need a reset.
  const result = await auth.importUsers(records);
  console.log(`  Auth users: ${result.successCount} imported, ${result.failureCount} failed.`);
  if (result.failureCount > 0) {
    for (const e of result.errors) {
      console.warn(`    index ${e.index}: ${e.error.message}`);
    }
  }
  if (skipped.length > 0) {
    console.warn(
      `  Note: ${skipped.length} user(s) had password hashes. Password sign-in for them ` +
        `requires importing with the project's original hash config; otherwise have them reset their password.`,
    );
  }
}

async function main() {
  const { file, yes, force } = parseArgs();
  if (!file) {
    console.error("Usage: npx tsx scripts/restore-firestore.ts <backup-file.json> --yes [--force]");
    console.error("  --yes    confirm you want to write to the live project (required)");
    console.error("  --force  allow restore even if the backup's projectId differs from FIREBASE_PROJECT_ID");
    process.exit(1);
  }
  if (!fsSync.existsSync(file)) {
    throw new Error(`Backup file not found: ${file}`);
  }

  const backup = JSON.parse(fsSync.readFileSync(file, "utf8")) as Backup;
  const targetProject = config.firebaseProjectId;
  const backupProject = backup.meta?.projectId;

  console.log("Restore plan:");
  console.log(`  Backup file:        ${file}`);
  console.log(`  Backup projectId:   ${backupProject}`);
  console.log(`  Backup exportedAt:  ${backup.meta?.exportedAt}`);
  console.log(`  Target projectId:   ${targetProject} (from FIREBASE_PROJECT_ID)`);
  const collCount = Object.keys(backup.firestore ?? {}).length;
  const docCount = Object.values(backup.firestore ?? {}).reduce((n, arr) => n + arr.length, 0);
  console.log(`  Will write:         ${docCount} docs across ${collCount} collections + ${backup.authUsers?.length ?? 0} auth users`);
  console.log("  Mode:               non-destructive upsert (set). Docs created AFTER the backup are NOT deleted.");

  if (backupProject !== targetProject && !force) {
    console.error(
      `\nRefusing: backup projectId "${backupProject}" != target "${targetProject}". ` +
        `Re-run with --force if this is intentional.`,
    );
    process.exit(1);
  }
  if (!yes) {
    console.error("\nDry run only. Re-run with --yes to actually write to the live project.");
    process.exit(1);
  }

  console.log("\nRestoring Firestore...");
  const { collections, docs } = await restoreFirestore(backup);
  console.log("Restoring Firebase Auth users...");
  await restoreAuthUsers(backup);

  console.log(`\nRestore complete: ${docs} docs across ${collections} collections.`);
}

main().catch((err) => {
  console.error("Restore failed:", err);
  process.exit(1);
});
