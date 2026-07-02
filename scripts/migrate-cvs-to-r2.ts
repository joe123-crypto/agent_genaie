/**
 * One-off migration: upload existing on-disk CVs into the R2 bucket.
 *
 * Source layout (sibling genaebot runtime):
 *   /home/joseph/projects/genaebot/runtime/job-scout/users/<phone-hash>/cv.pdf
 *
 * <phone-hash> is the WhatsApp phone hash. We resolve it to a Firebase UID via
 * jobScoutDeliveryByPhone/{hash}.userId (fallback: phoneLinksByUser where
 * phoneHash == hash), then upload to `${uid}/cv/cv.pdf` and set the profile's
 * cvFileRef.
 *
 * Usage:
 *   npx tsx scripts/migrate-cvs-to-r2.ts [--dry-run] [--source <dir>]
 *     [--map <phone-hash>=<firebaseUid>]   (repeatable; overrides DB lookup)
 */
import fs from "node:fs";
import path from "node:path";
import { getFirestoreDb } from "@/src/firebase/admin";
import { putObject, objectExists } from "@/src/domains/r2-storage";
import { cvObjectKey } from "@/src/domains/job-scout";
import { FieldValue } from "firebase-admin/firestore";

const DEFAULT_SOURCE = "/home/joseph/projects/genaebot/runtime/job-scout/users";

function parseArgs() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const sourceIdx = args.indexOf("--source");
  const source = sourceIdx >= 0 && args[sourceIdx + 1] ? args[sourceIdx + 1] : DEFAULT_SOURCE;
  const overrides = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--map" && args[i + 1]) {
      const [hash, uid] = args[i + 1].split("=");
      if (hash && uid) overrides.set(hash.trim(), uid.trim());
    }
  }
  return { dryRun, source, overrides };
}

async function resolveUidFromHash(
  db: FirebaseFirestore.Firestore,
  hash: string,
  overrides: Map<string, string>,
): Promise<string | null> {
  if (overrides.has(hash)) return overrides.get(hash)!;
  const deliveryDoc = await db.collection("jobScoutDeliveryByPhone").doc(hash).get();
  if (deliveryDoc.exists && deliveryDoc.data()?.userId) {
    return deliveryDoc.data()!.userId as string;
  }
  const snap = await db.collection("phoneLinksByUser").where("phoneHash", "==", hash).limit(1).get();
  if (!snap.empty) {
    return (snap.docs[0].data().userId as string) ?? snap.docs[0].id;
  }
  return null;
}

async function main() {
  const { dryRun, source, overrides } = parseArgs();
  console.log(`Migrating CVs from ${source}${dryRun ? " (DRY RUN)" : ""}`);

  if (!fs.existsSync(source)) {
    console.error(`Source directory does not exist: ${source}`);
    process.exit(1);
  }

  const db = getFirestoreDb();
  const hashDirs = fs
    .readdirSync(source, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  let migrated = 0;
  let skippedExisting = 0;
  let noFile = 0;
  const unresolved: string[] = [];

  for (const hash of hashDirs) {
    const cvPath = path.join(source, hash, "cv.pdf");
    if (!fs.existsSync(cvPath)) {
      noFile++;
      continue;
    }
    const uid = await resolveUidFromHash(db, hash, overrides);
    if (!uid) {
      unresolved.push(hash);
      console.warn(`  ! unresolved phone-hash (no UID): ${hash}`);
      continue;
    }
    const key = cvObjectKey(uid);

    if (dryRun) {
      console.log(`  [dry-run] ${hash} -> ${key}`);
      migrated++;
      continue;
    }

    // Upload only if the object is missing, but ALWAYS reconcile Firestore so a
    // prior partial run (upload succeeded, cvFileRef write failed) self-heals.
    const alreadyUploaded = await objectExists(key);
    if (alreadyUploaded) {
      console.log(`  = object exists, reconciling cvFileRef ${key}`);
      skippedExisting++;
    } else {
      const bytes = fs.readFileSync(cvPath);
      await putObject(key, bytes, "application/pdf");
      console.log(`  + uploaded ${hash} -> ${key} (${bytes.length} bytes)`);
      migrated++;
    }

    await db
      .collection("jobScoutProfiles")
      .doc(uid)
      .set(
        { userId: uid, cvFileRef: key, updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
  }

  console.log("\nSummary:");
  console.log(`  uploaded:              ${migrated}`);
  console.log(`  existing (reconciled): ${skippedExisting}`);
  console.log(`  dirs w/o cv.pdf:       ${noFile}`);
  console.log(`  unresolved hashes:     ${unresolved.length}`);
  if (unresolved.length) console.log(`    ${unresolved.join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
