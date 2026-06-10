import { loadDotEnv } from "../src/config/index";
loadDotEnv();

import { config } from "../src/config/index";
import { getFirestoreDb, getFirebaseAdminAuth } from "../src/firebase/admin";
import { Timestamp, GeoPoint, DocumentReference } from "firebase-admin/firestore";
import fsSync from "node:fs";
import path from "node:path";
import os from "node:os";

const OUTPUT_DIR = process.env.BACKUP_DIR ?? path.join(os.homedir(), "Downloads");

/**
 * Recursively encode a Firestore value into plain JSON, preserving rich types
 * (Timestamp, GeoPoint, DocumentReference, Bytes) via `__type` markers so the
 * restore script can faithfully reconstruct them.
 */
function encodeValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;

  if (value instanceof Timestamp) {
    return { __type: "timestamp", seconds: value.seconds, nanoseconds: value.nanoseconds };
  }
  if (value instanceof GeoPoint) {
    return { __type: "geopoint", latitude: value.latitude, longitude: value.longitude };
  }
  if (value instanceof DocumentReference) {
    return { __type: "ref", path: value.path };
  }
  if (Buffer.isBuffer(value)) {
    return { __type: "bytes", base64: value.toString("base64") };
  }
  // firestore Bytes (rare via admin reads, but handle it)
  if (value instanceof Uint8Array) {
    return { __type: "bytes", base64: Buffer.from(value).toString("base64") };
  }
  if (Array.isArray(value)) {
    return value.map(encodeValue);
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = encodeValue(v);
    }
    return out;
  }
  // string | number | boolean
  return value;
}

type DocEntry = { id: string; data: Record<string, unknown> };

async function dumpCollection(
  ref: FirebaseFirestore.CollectionReference,
  collectionPath: string,
  firestore: Record<string, DocEntry[]>,
): Promise<number> {
  const snap = await ref.get();
  const entries: DocEntry[] = [];
  let docCount = 0;
  for (const doc of snap.docs) {
    entries.push({ id: doc.id, data: encodeValue(doc.data()) as Record<string, unknown> });
    docCount++;
    // Recurse into any subcollections so the backup stays correct even if the
    // schema grows nested collections later.
    const subcollections = await doc.ref.listCollections();
    for (const sub of subcollections) {
      docCount += await dumpCollection(sub, `${collectionPath}/${doc.id}/${sub.id}`, firestore);
    }
  }
  firestore[collectionPath] = entries;
  return docCount;
}

async function dumpAuthUsers(): Promise<Record<string, unknown>[]> {
  const auth = getFirebaseAdminAuth();
  const users: Record<string, unknown>[] = [];
  let pageToken: string | undefined = undefined;
  do {
    const result = await auth.listUsers(1000, pageToken);
    for (const u of result.users) {
      // toJSON() includes uid, email, providerData, customClaims, metadata, etc.
      // passwordHash / passwordSalt are only present on the raw record.
      const json = u.toJSON() as Record<string, unknown>;
      if (u.passwordHash) json.passwordHash = u.passwordHash;
      if (u.passwordSalt) json.passwordSalt = u.passwordSalt;
      users.push(json);
    }
    pageToken = result.pageToken;
  } while (pageToken);
  return users;
}

async function main() {
  if (!config.firebaseProjectId) {
    throw new Error("FIREBASE_PROJECT_ID is not set; cannot determine which project to back up.");
  }

  const db = getFirestoreDb();
  const firestore: Record<string, DocEntry[]> = {};

  console.log(`Backing up Firestore for project "${config.firebaseProjectId}"...`);
  const topCollections = await db.listCollections();
  let totalDocs = 0;
  for (const coll of topCollections) {
    const count = await dumpCollection(coll, coll.id, firestore);
    console.log(`  ${coll.id}: ${firestore[coll.id]?.length ?? 0} docs`);
    totalDocs += count;
  }

  console.log("Backing up Firebase Auth users...");
  const authUsers = await dumpAuthUsers();
  console.log(`  authUsers: ${authUsers.length}`);

  const exportedAt = new Date().toISOString();
  const backup = {
    meta: { projectId: config.firebaseProjectId, exportedAt, version: 1 },
    firestore,
    authUsers,
  };

  if (!fsSync.existsSync(OUTPUT_DIR)) fsSync.mkdirSync(OUTPUT_DIR, { recursive: true });
  const stamp = exportedAt.replace(/:/g, "-").replace(/\..+$/, "");
  const outPath = path.join(OUTPUT_DIR, `firestore-backup-${config.firebaseProjectId}-${stamp}.json`);
  fsSync.writeFileSync(outPath, JSON.stringify(backup, null, 2), { mode: 0o600 });

  console.log(`\nBackup complete.`);
  console.log(`  Collections: ${topCollections.length}`);
  console.log(`  Total documents: ${totalDocs}`);
  console.log(`  Auth users: ${authUsers.length}`);
  console.log(`  Output: ${outPath}`);
  console.log(`\nNote: this file contains encrypted secrets and auth password hashes — keep it private and do not commit it.`);
}

main().catch((err) => {
  console.error("Backup failed:", err);
  process.exit(1);
});
