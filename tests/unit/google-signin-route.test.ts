import { test } from "node:test";
import assert from "node:assert/strict";

// The route reads `config` and calls `signState` at request time, so env must be
// set BEFORE importing it (see tests/unit/config.test.ts for why). Import happens
// inside the tests because this project transpiles to CJS, which disallows
// top-level await. node:test isolates each file in its own process, so setting
// these here cannot leak into other unit test files.
process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
process.env.OAUTH_STATE_SECRET = "signin-route-test-secret";
process.env.PUBLIC_BASE_URL = "https://app.example.com";
process.env.FIREBASE_PROJECT_ID = "demo-genaie";

async function postSignin(body: unknown) {
  const { NextRequest } = await import("next/server");
  const { POST } = await import("@/app/auth/google/signin/route");
  const req = new NextRequest("https://app.example.com/auth/google/signin", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
  return POST(req);
}

test("POST /auth/google/signin returns a Google consent URL with the combined scopes and offline/consent params", async () => {
  const { GOOGLE_SIGNIN_SCOPES, AUTH_URL } = await import("@/src/config");
  const res = await postSignin({ next: "/vault" });
  assert.equal(res.status, 200);

  const { url } = await res.json();
  assert.ok(url, "expected a url in the response body");

  const parsed = new URL(url);
  assert.equal(`${parsed.origin}${parsed.pathname}`, AUTH_URL);
  assert.equal(parsed.searchParams.get("response_type"), "code");
  assert.equal(parsed.searchParams.get("access_type"), "offline");
  assert.equal(parsed.searchParams.get("prompt"), "consent");
  assert.equal(parsed.searchParams.get("client_id"), "test-client-id.apps.googleusercontent.com");
  assert.equal(parsed.searchParams.get("scope"), GOOGLE_SIGNIN_SCOPES);
});

test("the signed state round-trips to a signin flow with a non-empty nonce and the requested next path", async () => {
  const { verifyState } = await import("@/src/security/crypto");
  const res = await postSignin({ next: "/vault" });
  const { url } = await res.json();

  const state = new URL(url).searchParams.get("state");
  assert.ok(state, "expected a state parameter");

  const payload = verifyState(state!) as { flow?: string; nonce?: string; next?: string; ts?: number };
  assert.equal(payload.flow, "signin");
  assert.equal(typeof payload.nonce, "string");
  assert.ok(payload.nonce && payload.nonce.length > 0);
  assert.equal(payload.next, "/vault");
  assert.equal(typeof payload.ts, "number");
});

test("each call mints a fresh, distinct nonce so pending Gmail tokens cannot collide across sign-in attempts", async () => {
  const { verifyState } = await import("@/src/security/crypto");
  const [first, second] = await Promise.all([postSignin({}), postSignin({})]);
  const firstState = new URL((await first.json()).url).searchParams.get("state")!;
  const secondState = new URL((await second.json()).url).searchParams.get("state")!;

  const firstPayload = verifyState(firstState) as { nonce: string };
  const secondPayload = verifyState(secondState) as { nonce: string };
  assert.notEqual(firstPayload.nonce, secondPayload.nonce);
});

test("an unsafe or missing next path falls back to the normalized default", async () => {
  const { verifyState } = await import("@/src/security/crypto");
  const res = await postSignin({ next: "https://evil.example/steal" });
  const { url } = await res.json();
  const state = new URL(url).searchParams.get("state")!;
  const payload = verifyState(state) as { next: string };
  assert.equal(payload.next, "/");
});
