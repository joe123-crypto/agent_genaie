import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  credentialRefId,
  webetuCredentialRefId,
  serviceSubscriptionId,
  webetuRestaurantOverrideId,
  jobApplicationId,
  whatsappPhoneHash,
  tokenStoreKeyForUid,
  validateFirebaseUid,
  isPublicUserId,
} from "@/src/lib/utils";
import { cvObjectKey } from "@/src/domains/job-scout";

// These functions define Firestore document IDs and the R2 object layout. If any
// of them change shape, data written to prod stops lining up with data already
// stored there, so the exact string contracts are pinned here.

test("cvObjectKey pins the R2 CV layout <uid>/cv/cv.pdf", () => {
  assert.equal(cvObjectKey("uid123"), "uid123/cv/cv.pdf");
});

test("credentialRefId builds {service}_{purpose}_{uid} and sanitizes chars", () => {
  assert.equal(credentialRefId("uid1", "gmail", "oauth2"), "gmail_oauth2_uid1");
  // Disallowed characters in service/purpose collapse to underscores.
  assert.equal(credentialRefId("uid1", "gm ail", "oauth/2"), "gm_ail_oauth_2_uid1");
});

test("webetuCredentialRefId is the webetu username_password ref", () => {
  assert.equal(webetuCredentialRefId("uid1"), "webetu_username_password_uid1");
});

test("serviceSubscriptionId builds {uid}_{service}", () => {
  assert.equal(serviceSubscriptionId("uid1", "jobs"), "uid1_jobs");
  assert.equal(serviceSubscriptionId("uid1", "we betu"), "uid1_we_betu");
});

test("webetuRestaurantOverrideId builds {uid}_{YYYY-MM-DD} and validates the date", () => {
  assert.equal(webetuRestaurantOverrideId("uid1", "2026-07-03"), "uid1_2026-07-03");
  assert.throws(() => webetuRestaurantOverrideId("uid1", "2026-13-40"));
});

test("jobApplicationId is a stable sha256 of uid\\ncompany\\nrole, case-insensitive", () => {
  const expected = crypto
    .createHash("sha256")
    .update(["uid1", "acme", "backend engineer"].join("\n"))
    .digest("hex");
  assert.equal(jobApplicationId("uid1", "Acme", "Backend Engineer"), expected);
  // Same doc ID regardless of company/role casing and surrounding whitespace.
  assert.equal(
    jobApplicationId("uid1", "  ACME ", " backend ENGINEER "),
    jobApplicationId("uid1", "acme", "backend engineer"),
  );
});

test("whatsappPhoneHash is deterministic and 12 hex chars", () => {
  const a = whatsappPhoneHash("+213600000000");
  const b = whatsappPhoneHash("213600000000"); // normalizes to the same phone
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{12}$/);
});

test("tokenStoreKeyForUid is deterministic and firebase-prefixed", () => {
  const key = tokenStoreKeyForUid("uid1");
  assert.equal(key, tokenStoreKeyForUid("uid1"));
  assert.match(key, /^firebase:[A-Za-z0-9_-]+$/);
});

test("validateFirebaseUid rejects empty and >128 chars, accepts valid", () => {
  assert.equal(validateFirebaseUid("uid1"), "uid1");
  assert.throws(() => validateFirebaseUid(""));
  assert.throws(() => validateFirebaseUid("x".repeat(129)));
});

test("isPublicUserId matches usr_ + 16 url-safe chars", () => {
  assert.equal(isPublicUserId("usr_ABCDefgh12345678"), true);
  assert.equal(isPublicUserId("usr_short"), false);
  assert.equal(isPublicUserId("nope"), false);
});
