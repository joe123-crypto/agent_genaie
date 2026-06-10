import { loadDotEnv } from "../src/config/index";
loadDotEnv();

import { getFirestoreDb } from "../src/firebase/admin";
import { storedRestaurantFields } from "../src/lib/utils";
import { FieldValue } from "firebase-admin/firestore";

/**
 * Phased cleanup of legacy Firestore collections and stale user-doc fields.
 *
 * Usage:
 *   npx tsx scripts/cleanup-legacy-data.ts --phase <1|2|3|4> [--dry-run]
 *
 * Phase 1 – Drop zero-risk legacy collections (no code refs, no unmigrated data):
 *   gmailConnections, jobSetupLinks, publicUsers, serviceSubscriptions, webetuRestaurantCatalog
 *
 * Phase 2 – Migrate webetuUsers.preferences.defaultRestaurant → webetuPreferences/{uid},
 *           then drop webetuUsers.
 *
 * Phase 3 – Drop phoneLinks (run AFTER removing phoneLinks fallback code from account-link.ts
 *           and users.ts and confirming typecheck + smoke-test pass).
 *
 * Phase 4 – Remove stale fields from users docs:
 *           top-level `serviceStatus`, `identities.whatsappPhone`, `identities.whatsappPhoneHash`.
 */

const BATCH_SIZE = 400;

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith("--")) continue;
    const key = tok.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) args[key] = true;
    else { args[key] = next; i++; }
  }
  return args;
}

async function deleteCollection(db: any, collectionName: string, dryRun: boolean): Promise<number> {
  const snap = await db.collection(collectionName).get();
  if (snap.empty) return 0;
  if (dryRun) {
    console.log(`  [dry-run] Would delete ${snap.size} docs from ${collectionName}`);
    return snap.size;
  }
  let deleted = 0;
  for (let i = 0; i < snap.docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = snap.docs.slice(i, i + BATCH_SIZE);
    for (const doc of chunk) batch.delete(doc.ref);
    await batch.commit();
    deleted += chunk.length;
  }
  console.log(`  Deleted ${deleted} docs from ${collectionName}`);
  return deleted;
}

async function phase1(db: any, dryRun: boolean) {
  console.log(`\n${dryRun ? "[DRY RUN] " : ""}Phase 1: dropping zero-risk legacy collections`);
  const targets = [
    "gmailConnections",
    "jobSetupLinks",
    "publicUsers",
    "serviceSubscriptions",
    "webetuRestaurantCatalog",
  ];
  const summary: Record<string, number> = {};
  for (const name of targets) {
    summary[name] = await deleteCollection(db, name, dryRun);
  }
  console.log("\nPhase 1 summary:", JSON.stringify(summary, null, 2));
}

async function phase2(db: any, dryRun: boolean) {
  console.log(`\n${dryRun ? "[DRY RUN] " : ""}Phase 2: migrate webetuUsers restaurant prefs → webetuPreferences, then drop webetuUsers`);

  const snap = await db.collection("webetuUsers").get();
  if (snap.empty) {
    console.log("  webetuUsers is already empty — nothing to do.");
    return;
  }

  let prefsAlreadyMigrated = 0;
  let prefsMigratedNow = 0;
  let webetuUsersDeleted = 0;
  const errors: any[] = [];

  for (const doc of snap.docs) {
    const uid = doc.id;
    const data = doc.data() || {};
    const legacyPref = data.preferences?.defaultRestaurant;

    if (legacyPref && legacyPref.name && legacyPref.idDepot) {
      const prefRef = db.collection("webetuPreferences").doc(uid);
      const existing = await prefRef.get();
      if (existing.exists && existing.data()?.defaultRestaurant) {
        prefsAlreadyMigrated++;
        console.log(`  [${uid}] webetuPreferences already has defaultRestaurant — skipping migration`);
      } else {
        try {
          const stored = storedRestaurantFields(legacyPref, "legacy_webetu_users");
          if (!dryRun) {
            if (existing.exists) {
              await prefRef.update({ defaultRestaurant: stored, updatedAt: FieldValue.serverTimestamp() });
            } else {
              await prefRef.set({
                userId: uid,
                defaultRestaurant: stored,
                overrides: {},
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
              });
            }
          }
          prefsMigratedNow++;
          console.log(`  [${uid}] ${dryRun ? "[dry-run] would migrate" : "migrated"} restaurant pref: "${legacyPref.name}" (idDepot=${legacyPref.idDepot})`);
        } catch (err) {
          errors.push({ uid, error: (err as Error).message });
          console.error(`  [${uid}] failed to migrate restaurant pref:`, (err as Error).message);
        }
      }
    }
  }

  if (errors.length > 0) {
    console.error(`\n  Errors during pref migration: ${errors.length}. Not deleting webetuUsers until resolved.`);
    console.error(JSON.stringify(errors, null, 2));
    return;
  }

  webetuUsersDeleted = await deleteCollection(db, "webetuUsers", dryRun);
  console.log("\nPhase 2 summary:", JSON.stringify({ webetuUsersDeleted, prefsAlreadyMigrated, prefsMigratedNow, errors: [] }, null, 2));
}

async function phase3(db: any, dryRun: boolean) {
  console.log(`\n${dryRun ? "[DRY RUN] " : ""}Phase 3: dropping phoneLinks collection`);
  const deleted = await deleteCollection(db, "phoneLinks", dryRun);
  console.log("\nPhase 3 summary:", JSON.stringify({ phoneLinksDeleted: deleted }, null, 2));
}

async function phase4(db: any, dryRun: boolean) {
  console.log(`\n${dryRun ? "[DRY RUN] " : ""}Phase 4: removing stale fields from users docs`);

  const snap = await db.collection("users").get();
  let usersUpdated = 0;
  let serviceStatusCleaned = 0;
  let identityFieldsCleaned = 0;

  for (let i = 0; i < snap.docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = snap.docs.slice(i, i + BATCH_SIZE);
    let batchHasWrites = false;

    for (const doc of chunk) {
      const data = doc.data() || {};
      const update: Record<string, any> = {};
      let hasChanges = false;

      if ("serviceStatus" in data) {
        update["serviceStatus"] = FieldValue.delete();
        serviceStatusCleaned++;
        hasChanges = true;
      }

      const identities = data.identities ?? {};
      if ("whatsappPhone" in identities || "whatsappPhoneHash" in identities) {
        update["identities.whatsappPhone"] = FieldValue.delete();
        update["identities.whatsappPhoneHash"] = FieldValue.delete();
        identityFieldsCleaned++;
        hasChanges = true;
      }

      if (hasChanges) {
        if (dryRun) {
          const fields = Object.keys(update).join(", ");
          console.log(`  [${doc.id}] would remove: ${fields}`);
        } else {
          batch.update(doc.ref, update);
          batchHasWrites = true;
        }
        usersUpdated++;
      }
    }

    if (!dryRun && batchHasWrites) await batch.commit();
  }

  console.log(`\n${dryRun ? "[DRY RUN] " : ""}Phase 4 summary:`, JSON.stringify({ usersUpdated, serviceStatusCleaned, identityFieldsCleaned }, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = args["dry-run"] === true;
  const phase = args.phase ? Number(args.phase) : null;

  if (!phase || ![1, 2, 3, 4].includes(phase)) {
    console.error("Usage: npx tsx scripts/cleanup-legacy-data.ts --phase <1|2|3|4> [--dry-run]");
    process.exit(1);
  }

  const db = getFirestoreDb();

  if (phase === 1) await phase1(db, dryRun);
  else if (phase === 2) await phase2(db, dryRun);
  else if (phase === 3) await phase3(db, dryRun);
  else if (phase === 4) await phase4(db, dryRun);

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
