import { loadDotEnv } from "../src/config/index";
loadDotEnv();

import { getFirestoreDb } from "../src/firebase/admin";
import {
  queuePhoneLinkCoreWrites,
  queueWebetuPhoneDeliveryUpdate,
  queueJobScoutPhoneDeliveryUpdate,
} from "../src/domains/account-link";
import { ensurePublicUserId } from "../src/domains/users";
import { normalizePhone, whatsappPhoneHash, isActivePhoneLink, normalizeJobPreferences } from "../src/lib/utils";
import { FieldValue } from "firebase-admin/firestore";

/**
 * One-time backfill: populate the new schema from legacy data so pre-migration users
 * resolve through the new app's phone-keyed lookups, and normalize the canonical
 * users.services map so uid-keyed reads agree.
 *
 * Legacy -> new mapping (UNION: active if EITHER source says so):
 *   linked  : users.identities.whatsappPhone  OR  legacy phoneLinks (status "linked"/active)
 *             -> phoneLinksByPhone/{hash} + phoneLinksByUser/{uid}
 *   webetu  : users.webetu === "active"        OR  webetuUsers/{uid} active
 *             -> webetuDeliveryByPhone/{hash} + users.services.webetu = "subscribed"
 *   jobs    : (users.gmail === "connected" AND users.jobs === "active")
 *             OR serviceSubscriptions/{uid}.jobs active
 *             -> jobScoutDeliveryByPhone/{hash} + users.services.jobs = "subscribed"
 *   gmail   : users.gmail === "connected" -> users.services.gmail = "connected"
 *
 * Idempotent (set/merge, active-only). Usage:
 *   npx tsx scripts/backfill-phone-links.ts [--dry-run] [--user <uid>]
 */

const BATCH_USERS = 100;

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

/** Legacy phone-link records use status "linked"/"active"; treat anything not revoked as active. */
function legacyLinkActive(d: any): boolean {
  if (!d) return false;
  if (d.revokedAt || d.status === "revoked" || d.status === "unlinked") return false;
  return d.status === "linked" || d.status === "active" || isActivePhoneLink(d);
}

/** Resolve a normalized phone for the user's active link (UNION of legacy + new sources), or null. */
async function resolveActivePhone(db: any, uid: string, userData: any): Promise<string | null> {
  // a. New native record.
  const byUser = await db.collection("phoneLinksByUser").doc(uid).get();
  if (byUser.exists) {
    const d = byUser.data() || {};
    if (isActivePhoneLink(d) && d.phone) return normalizePhone(d.phone);
  }
  // b. Legacy users/{uid}.identities (the reported source).
  const identities = userData?.identities ?? {};
  if (identities.whatsappPhone) return normalizePhone(identities.whatsappPhone);
  // c. Legacy phoneLinks collection (keyed by hash, has userId + status).
  try {
    const snap = await db.collection("phoneLinks").where("userId", "==", uid).get();
    for (const doc of snap.docs) {
      const d = doc.data() || {};
      if (legacyLinkActive(d) && d.phone) return normalizePhone(d.phone);
    }
  } catch (err) {
    console.error(`  [${uid}] legacy phoneLinks query failed:`, (err as Error).message);
  }
  return null;
}

/** True if a per-user legacy doc keyed by bare uid is active (e.g. webetuUsers/{uid}). */
async function legacyDocActive(db: any, collection: string, uid: string): Promise<boolean> {
  try {
    const doc = await db.collection(collection).doc(uid).get();
    if (!doc.exists) return false;
    const d = doc.data() || {};
    const status = d.status ?? d.state;
    if (status) return status === "active" || status === "subscribed" || status === "linked";
    return d.active === true || d.subscribed === true;
  } catch {
    return false;
  }
}

/**
 * Active service subscriptions for a user per the serviceSubscriptions collection —
 * the canonical normalized source. Keyed by a composite id, so it MUST be queried by
 * the userId field (not doc id). Returns service -> doc data (e.g. the jobs doc carries
 * the legacy job-scout `preferences`).
 */
async function activeServiceSubscriptions(db: any, uid: string): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  try {
    const snap = await db.collection("serviceSubscriptions").where("userId", "==", uid).get();
    for (const doc of snap.docs) {
      const d = doc.data() || {};
      const active = d.status === "active" || d.status === "subscribed" || d.active === true;
      if (active && d.service) map.set(String(d.service), d);
    }
  } catch (err) {
    console.error(`  [${uid}] serviceSubscriptions query failed:`, (err as Error).message);
  }
  return map;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = args["dry-run"] === true;
  const onlyUser = typeof args.user === "string" ? (args.user as string) : null;

  const db = getFirestoreDb();
  const summary = { scanned: 0, linkedWritten: 0, webetuWritten: 0, jobsWritten: 0, profilesWritten: 0, skipped: 0, errors: [] as any[] };

  const userDocs = onlyUser
    ? [await db.collection("users").doc(onlyUser).get()]
    : (await db.collection("users").get()).docs;

  console.log(`${dryRun ? "[DRY RUN] " : ""}Processing ${userDocs.length} user(s)...`);

  let batch = db.batch();
  let pendingWrites = 0;

  const flush = async () => {
    if (dryRun || pendingWrites === 0) { pendingWrites = 0; batch = db.batch(); return; }
    await batch.commit();
    batch = db.batch();
    pendingWrites = 0;
  };

  for (const userDoc of userDocs) {
    if (!userDoc.exists) { summary.skipped++; continue; }
    const uid = userDoc.id;
    const data = userDoc.data() || {};
    summary.scanned++;

    try {
      const phone = await resolveActivePhone(db, uid, data);
      if (!phone) { summary.skipped++; continue; }
      const phoneHash = whatsappPhoneHash(phone); // recompute to match read-time hashing

      // UNION signals across legacy flat fields + parallel collections +
      // the serviceSubscriptions source of truth (queried by userId).
      const subs = await activeServiceSubscriptions(db, uid);
      const wantWebetu =
        data.webetu === "active" || subs.has("webetu") || (await legacyDocActive(db, "webetuUsers", uid));
      const gmailConnected = data.gmail === "connected" || subs.has("gmail");
      const wantJobs =
        (gmailConnected && data.jobs === "active") || subs.has("jobs");

      // Canonical users.services normalization (merged onto the user doc).
      const servicesUpdate: Record<string, string> = {};
      if (gmailConnected) servicesUpdate["services.gmail"] = "connected";
      if (wantWebetu) servicesUpdate["services.webetu"] = "subscribed";
      if (wantJobs) servicesUpdate["services.jobs"] = "subscribed";

      // Migrate the legacy job-scout profile (serviceSubscriptions.preferences) into the
      // new jobScoutProfiles/{uid} — this is what list-ready reads. Only create when the
      // user subscribes to jobs and no profile already exists (never clobber newer data).
      const jobsPrefs = subs.get("jobs")?.preferences;
      const profileExists = wantJobs
        ? (await db.collection("jobScoutProfiles").doc(uid).get()).exists
        : true;
      const wantProfile = wantJobs && !profileExists;

      if (dryRun) {
        // Never call ensurePublicUserId here — it writes when a public id is missing.
        const tags = [
          wantWebetu ? "+webetu" : "",
          wantJobs ? "+jobs" : "",
          wantProfile ? "+profile" : "",
          gmailConnected ? "+gmail" : "",
          data.publicUserId ? "" : "(gen publicUserId)",
        ].filter(Boolean).join(" ");
        console.log(`  [${uid}] core hash=${phoneHash} ${tags}`.trimEnd());
      } else {
        const publicUserId = await ensurePublicUserId(db, uid, data.publicUserId);
        const now = FieldValue.serverTimestamp();
        const phoneLink = { userId: uid, publicUserId, phone, phoneHash, status: "active", verifiedAt: now };

        queuePhoneLinkCoreWrites(batch, db, uid, phoneLink, now);
        pendingWrites += 2;
        if (wantWebetu) { queueWebetuPhoneDeliveryUpdate(batch, db, phoneLink); pendingWrites += 1; }
        if (wantJobs) { queueJobScoutPhoneDeliveryUpdate(batch, db, phoneLink); pendingWrites += 1; }
        if (wantProfile) {
          batch.set(db.collection("jobScoutProfiles").doc(uid), {
            userId: uid,
            preferences: normalizeJobPreferences(jobsPrefs),
            cvFileRef: null,
            cvParsedText: null,
            createdAt: now,
            updatedAt: now,
          });
          pendingWrites += 1;
        }
        if (Object.keys(servicesUpdate).length > 0) {
          // update() (not set/merge) so dotted keys are treated as nested field paths,
          // matching how the app writes services.* (account-link.ts / webetu.ts). The
          // user doc always exists here, so update is safe.
          batch.update(db.collection("users").doc(uid), { ...servicesUpdate, updatedAt: now });
          pendingWrites += 1;
        }
      }

      summary.linkedWritten++;
      if (wantWebetu) summary.webetuWritten++;
      if (wantJobs) summary.jobsWritten++;
      if (wantProfile) summary.profilesWritten++;

      if (pendingWrites >= BATCH_USERS * 4) await flush();
    } catch (err) {
      summary.errors.push({ uid, error: (err as Error).message });
      console.error(`  [${uid}] failed:`, (err as Error).message);
    }
  }

  await flush();

  console.log(`\n${dryRun ? "[DRY RUN] " : ""}Backfill complete:`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
