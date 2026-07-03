import { test } from "node:test";
import assert from "node:assert/strict";

// Separate process (node:test isolates each file) so we can assert the OTHER
// r2Endpoint branch: an explicit R2_ENDPOINT wins over the derived one and has
// trailing slashes stripped. Import happens inside the test (CJS transpile
// target disallows top-level await).
process.env.R2_ACCOUNT_ID = "acct123";
process.env.R2_ENDPOINT = "https://custom.example.com/";

test("explicit R2_ENDPOINT overrides the derived endpoint and strips trailing slashes", async () => {
  const { config } = await import("@/src/config");
  assert.equal(config.r2Endpoint, "https://custom.example.com");
});
