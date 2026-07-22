import { test } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeJobPreferences,
  normalizeStringList,
  normalizeCvFileRef,
  normalizeWebetuCredentials,
  normalizeRestaurantDate,
  normalizePhone,
  storedRestaurantFields,
  publicRestaurantFields,
  serviceStatusWith,
  userProfileFromRecord,
  normalizeAccountLinkNextPath,
} from "@/src/lib/utils";

// These normalizers define the field shapes that get written to Firestore. The
// tests pin the defaults, clamps, and validation so a refactor can't silently
// change what lands in the database.

test("normalizeJobPreferences applies documented defaults", () => {
  const prefs = normalizeJobPreferences(undefined);
  assert.equal(prefs.country, "dz");
  assert.equal(prefs.language, "fr");
  assert.equal(prefs.autoApply, true);
  assert.equal(prefs.maxApplicationsPerRun, 2);
  assert.deepEqual(prefs.targetRoles, []);
  // Exact key set of the stored preferences object.
  assert.deepEqual(Object.keys(prefs).sort(), [
    "autoApply",
    "country",
    "exclusions",
    "experience",
    "language",
    "locations",
    "maxApplicationsPerRun",
    "promptNotes",
    "qualifications",
    "skills",
    "targetRoles",
  ]);
});

test("normalizeJobPreferences clamps maxApplicationsPerRun to 0..5", () => {
  assert.equal(normalizeJobPreferences({ maxApplicationsPerRun: 99 }).maxApplicationsPerRun, 5);
  assert.equal(normalizeJobPreferences({ maxApplicationsPerRun: -1 }).maxApplicationsPerRun, 0);
  assert.equal(normalizeJobPreferences({ maxApplicationsPerRun: 3 }).maxApplicationsPerRun, 3);
  assert.equal(normalizeJobPreferences({ maxApplicationsPerRun: "oops" }).maxApplicationsPerRun, 2);
});

test("normalizeJobPreferences honors autoApply=false and role aliases", () => {
  assert.equal(normalizeJobPreferences({ autoApply: false }).autoApply, false);
  // `roles` is an accepted alias for `targetRoles`.
  assert.deepEqual(normalizeJobPreferences({ roles: ["Dev"] }).targetRoles, ["Dev"]);
});

test("normalizeJobPreferences caps promptNotes at 12 items", () => {
  const notes = Array.from({ length: 20 }, (_, i) => `note ${i}`);
  assert.equal(normalizeJobPreferences({ promptNotes: notes }).promptNotes.length, 12);
});

test("normalizeStringList trims, dedupes case-insensitively, caps count and length", () => {
  assert.deepEqual(normalizeStringList(["  a ", "A", "b"]), ["a", "b"]);
  assert.equal(normalizeStringList(Array.from({ length: 40 }, (_, i) => `v${i}`)).length, 24);
  assert.equal(normalizeStringList(["x".repeat(500)])[0].length, 240);
  assert.deepEqual(normalizeStringList("single"), ["single"]);
});

test("normalizeCvFileRef rejects empty, oversized, and null bytes", () => {
  assert.equal(normalizeCvFileRef("uid/cv/cv.pdf"), "uid/cv/cv.pdf");
  assert.throws(() => normalizeCvFileRef(""));
  assert.throws(() => normalizeCvFileRef("x".repeat(501)));
  assert.throws(() => normalizeCvFileRef("bad\0key"));
});

test("normalizeWebetuCredentials validates presence, length, and injection", () => {
  assert.deepEqual(normalizeWebetuCredentials({ username: "u", password: "p" }), {
    username: "u",
    password: "p",
  });
  assert.throws(() => normalizeWebetuCredentials({ username: "", password: "p" }));
  assert.throws(() => normalizeWebetuCredentials({ username: "u", password: "" }));
  assert.throws(() => normalizeWebetuCredentials({ username: "u\r\nx", password: "p" }));
  assert.throws(() => normalizeWebetuCredentials({ username: "u", password: "p\0" }));
});

test("normalizeRestaurantDate accepts valid YYYY-MM-DD and rejects bad dates", () => {
  assert.equal(normalizeRestaurantDate("2026-07-03"), "2026-07-03");
  assert.throws(() => normalizeRestaurantDate("2026-13-40"));
  assert.throws(() => normalizeRestaurantDate("2026-2-3"));
  assert.throws(() => normalizeRestaurantDate("not-a-date"));
});

test("normalizePhone normalizes to +digits and enforces 9..16 length", () => {
  assert.equal(normalizePhone("+213 600 000 000"), "+213600000000");
  assert.throws(() => normalizePhone(""));
  assert.throws(() => normalizePhone("1")); // too short
  assert.throws(() => normalizePhone("1".repeat(20))); // too long
});

test("storedRestaurantFields pins the stored shape and requires name+idDepot", () => {
  const stored = storedRestaurantFields({ name: "Resto", idDepot: 190 });
  assert.equal(stored.catalogId, "onou-depot-190");
  assert.equal(stored.idDepot, 190);
  assert.equal(stored.source, "catalog");
  const keys = Object.keys(stored).sort();
  assert.deepEqual(keys, [
    "breakfast",
    "catalogId",
    "dinner",
    "idDepot",
    "lastVerifiedAt",
    "lunch",
    "name",
    "nameAR",
    "nameFR",
    "residence",
    "selectedAt",
    "source",
    "updatedAt",
    "wilaya",
  ]);
  assert.throws(() => storedRestaurantFields({ idDepot: 1 })); // missing name
  assert.throws(() => storedRestaurantFields({ name: "x" })); // missing idDepot
});

test("publicRestaurantFields exposes only public fields", () => {
  const pub = publicRestaurantFields({ catalogId: "c", name: "N", idDepot: 1, lunch: 1 });
  assert.ok(pub);
  assert.deepEqual(Object.keys(pub).sort(), [
    "breakfast",
    "catalogId",
    "dinner",
    "lunch",
    "name",
    "nameAR",
    "nameFR",
  ]);
  assert.equal(pub.lunch, true);
  assert.equal(publicRestaurantFields(null), null);
});

test("serviceStatusWith applies defaults and override precedence", () => {
  const base = serviceStatusWith(undefined);
  assert.deepEqual(base, {
    gmail: "not_connected",
    jobs: "not_subscribed",
    webetu: "not_subscribed",
    news: "not_subscribed",
  });
  assert.equal(serviceStatusWith({ jobs: "subscribed" }).jobs, "subscribed");
  assert.equal(serviceStatusWith({ jobs: "subscribed" }, { jobs: "not_subscribed" }).jobs, "not_subscribed");
});

test("userProfileFromRecord builds the profile/identities shape", () => {
  const record = userProfileFromRecord({
    uid: "uid1",
    email: "User@Example.com",
    emailVerified: true,
    displayName: "Ada Lovelace",
    providerData: [{ providerId: "google.com", uid: "g1" }],
  });
  assert.equal(record.userId, "uid1");
  assert.equal(record.profile.emailLower, "user@example.com");
  assert.equal(record.profile.firstName, "Ada");
  assert.equal(record.profile.lastName, "Lovelace");
  assert.equal(record.identities.firebaseUid, "uid1");
  assert.equal(record.identities.googleProviderUid, "g1");
  assert.deepEqual(record.identities.providerIds, ["google.com"]);
});

test("normalizeAccountLinkNextPath enforces the redirect allow-list", () => {
  assert.equal(normalizeAccountLinkNextPath("/"), "/");
  assert.equal(normalizeAccountLinkNextPath("/vault"), "/vault");
  assert.equal(normalizeAccountLinkNextPath("/connect-gmail"), "/connect-gmail");
  assert.equal(normalizeAccountLinkNextPath("/onboarding"), "/onboarding");
  assert.equal(normalizeAccountLinkNextPath("//evil.com"), "/");
  assert.equal(normalizeAccountLinkNextPath("/somewhere-else"), "/");
});
