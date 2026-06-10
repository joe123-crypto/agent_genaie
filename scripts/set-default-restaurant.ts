import { loadDotEnv } from "../src/config/index";
loadDotEnv();

import { getFirestoreDb } from "../src/firebase/admin";
import { storedRestaurantFields } from "../src/lib/utils";
import { FieldValue } from "firebase-admin/firestore";

/**
 * Set a user's Webetu restaurant preference directly by Firebase UID.
 *
 * Bypasses the phone -> webetuDeliveryByPhone subscription lookup AND the
 * CLI's live-list existence check. Writes the same doc shape the app's
 * setWebetuDefaultRestaurantForPhone produces. Use for ops/manual fixes only.
 *
 * Usage:
 *   npx tsx scripts/set-default-restaurant.ts \
 *     --user <firebaseUid> --idDepot <N> --name "<name>" \
 *     [--nameAR ".."] [--nameFR ".."] [--residence N] [--wilaya ".."] \
 *     [--breakfast] [--lunch] [--dinner] \
 *     [--date YYYY-MM-DD]      # write a one-day override instead of the default
 */

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith("--")) continue;
    const key = tok.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true; // flag
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));

  const userId = a.user as string;
  const idDepot = Number(a.idDepot);
  const name = a.name as string;

  if (!userId || !name || !Number.isInteger(idDepot) || idDepot <= 0) {
    console.error("Required: --user <firebaseUid> --idDepot <positive int> --name \"<name>\"");
    process.exit(1);
  }

  const entry = {
    idDepot,
    name,
    nameAR: (a.nameAR as string) ?? null,
    nameFR: (a.nameFR as string) ?? null,
    residence: a.residence != null ? Number(a.residence) : null,
    wilaya: a.wilaya != null ? String(a.wilaya) : null,
    breakfast: a.breakfast === true ? true : null,
    lunch: a.lunch === true ? true : null,
    dinner: a.dinner === true ? true : null,
  };

  const date = a.date as string | undefined; // override mode if present
  const db = getFirestoreDb();
  const prefRef = db.collection("webetuPreferences").doc(userId);

  await db.runTransaction(async (t) => {
    const doc = await t.get(prefRef);
    const exists = doc.exists;

    if (date) {
      const stored = storedRestaurantFields(entry, "user_override");
      if (exists) {
        t.update(prefRef, {
          [`overrides.${date}`]: { action: "override", restaurant: stored },
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        t.set(prefRef, {
          userId,
          overrides: { [date]: { action: "override", restaurant: stored } },
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    } else {
      const stored = storedRestaurantFields(entry, "user_default");
      if (exists) {
        t.update(prefRef, {
          defaultRestaurant: stored,
          updatedAt: FieldValue.serverTimestamp(),
        });
      } else {
        t.set(prefRef, {
          userId,
          defaultRestaurant: stored,
          overrides: {},
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }
  });

  const after = (await prefRef.get()).data();
  console.log(
    `Wrote ${date ? `override for ${date}` : "default"} restaurant (idDepot=${idDepot}, "${name}") for user ${userId}.`
  );
  console.log(JSON.stringify(after, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
