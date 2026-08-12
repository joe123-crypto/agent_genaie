import { test } from "node:test";
import assert from "node:assert/strict";

// The `config` object is a snapshot computed once at import time, so env must be
// set BEFORE importing it. node:test runs each test file in its own process, and
// an empty-string value still counts as "defined" so loadDotEnv() won't override
// it from a local .env — keeping this deterministic on dev machines and in CI.
// (Import happens inside the tests because this project transpiles to CJS, which
// disallows top-level await.)
process.env.R2_ACCOUNT_ID = "acct123";
process.env.R2_ENDPOINT = ""; // force the derived-endpoint branch
process.env.R2_BUCKET = ""; // exercise a missing required var
process.env.FIREBASE_PROJECT_ID = "demo-genaie";

test("r2Endpoint is derived from R2_ACCOUNT_ID when R2_ENDPOINT is unset", async () => {
  const { config } = await import("@/src/config");
  assert.equal(config.r2Endpoint, "https://acct123.r2.cloudflarestorage.com");
});

test("requireConfig throws listing human env names for missing values", async () => {
  const { requireConfig } = await import("@/src/config");
  assert.throws(
    () => requireConfig(["r2Bucket"]),
    (err: any) => {
      assert.match(err.message, /R2_BUCKET/);
      assert.equal(err.status, 500);
      return true;
    },
  );
});

test("requireConfig passes when the required values are present", async () => {
  const { requireConfig } = await import("@/src/config");
  assert.doesNotThrow(() => requireConfig(["r2AccountId", "firebaseProjectId"]));
});

test("Google OAuth requests only Gmail send access", async () => {
  const { CALENDAR_SCOPE, GMAIL_SEND_SCOPE, GOOGLE_OAUTH_SCOPES } = await import("@/src/config");
  assert.equal(GOOGLE_OAUTH_SCOPES, GMAIL_SEND_SCOPE);
  assert.equal(GOOGLE_OAUTH_SCOPES.includes(CALENDAR_SCOPE), false);
});

test("the combined sign-in scope adds only non-sensitive identity scopes to Gmail send, never calendar", async () => {
  const { CALENDAR_SCOPE, GMAIL_SEND_SCOPE, GOOGLE_SIGNIN_SCOPES } = await import("@/src/config");
  const scopes = GOOGLE_SIGNIN_SCOPES.split(" ");
  assert.deepEqual(new Set(scopes), new Set(["openid", "email", "profile", GMAIL_SEND_SCOPE]));
  assert.equal(scopes.includes(CALENDAR_SCOPE), false);
});
