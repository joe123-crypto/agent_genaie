import test from "node:test";
import assert from "node:assert/strict";
import {
  authErrorDetails,
  canUseRedirectSignIn,
  createAndVerifyServerSession,
  destinationForSession,
  isMobileBrowser,
  safeNext,
} from "@/src/auth/login";

test("safeNext only permits same-origin paths", () => {
  assert.equal(safeNext("/vault?from=test"), "/vault?from=test");
  assert.equal(safeNext("//attacker.example"), "/");
  assert.equal(safeNext("https://attacker.example"), "/");
  assert.equal(safeNext("javascript:alert(1)"), "/");
  assert.equal(safeNext(null), "/");
});

test("destinationForSession routes onboarding and user-scoped pages", () => {
  const session = { ok: true as const, publicUserId: "usr_123", onboardingRequired: false, plan: "free" as const, planRequired: false };
  assert.equal(destinationForSession(session, "/"), "/usr_123");
  assert.equal(destinationForSession(session, "/vault?tab=cv"), "/usr_123/vault?tab=cv");
  assert.equal(destinationForSession(session, "/connect-gmail"), "/usr_123/connect-gmail");
  assert.equal(destinationForSession(session, "/whatsapp?token=abc"), "/usr_123/whatsapp?token=abc");
  assert.equal(
    destinationForSession({ ...session, onboardingRequired: true }, "/whatsapp?token=abc"),
    "/usr_123/whatsapp?token=abc",
  );
  assert.equal(
    destinationForSession({ ...session, onboardingRequired: true }, "/vault"),
    "/usr_123/onboarding",
  );
  assert.equal(
    destinationForSession(session, "/create-cv/interview"),
    "/usr_123/create-cv/interview",
  );
  assert.equal(destinationForSession(session, "/create-cv"), "/usr_123/create-cv");
});

test("a WhatsApp-initiated sign-in returns to the user-scoped invite page", () => {
  // After sign-in, a /whatsapp?token=... next-path must resolve to the
  // publicUserId-scoped invite page (not stay generic), so the page can auto-link
  // the number and redirect the user back into the WhatsApp chat. This holds even
  // when onboarding is still required, so a first-time signup is not diverted to
  // the onboarding hub before the invite is bound.
  const session = { ok: true as const, publicUserId: "usr_abc", onboardingRequired: true, plan: "free" as const, planRequired: false };
  assert.equal(
    destinationForSession(session, "/whatsapp?token=invite-123"),
    "/usr_abc/whatsapp?token=invite-123",
  );
});

test("destinationForSession sends users without a plan to pricing first", () => {
  const session = {
    ok: true as const,
    publicUserId: "usr_123",
    onboardingRequired: true,
    plan: null,
    planRequired: true,
  };

  assert.equal(
    destinationForSession(session, "/"),
    "/pricing?next=%2Fusr_123%2Fonboarding",
  );
  assert.equal(
    destinationForSession({ ...session, onboardingRequired: false }, "/vault?tab=cv"),
    "/pricing?next=%2Fusr_123%2Fvault%3Ftab%3Dcv",
  );
  assert.equal(
    destinationForSession(session, "/whatsapp?token=abc"),
    "/usr_123/whatsapp?token=abc",
  );
  assert.equal(
    destinationForSession({ ...session, onboardingRequired: false }, "/create-cv/interview"),
    "/pricing?next=%2Fusr_123%2Fcreate-cv%2Finterview",
  );
});

test("mobile detection supports userAgentData, common mobile agents, and iPad desktop mode", () => {
  assert.equal(isMobileBrowser({ userAgentData: { mobile: true } }), true);
  assert.equal(isMobileBrowser({ userAgent: "Mozilla/5.0 (Linux; Android 15)" }), true);
  assert.equal(isMobileBrowser({ platform: "MacIntel", maxTouchPoints: 5 }), true);
  assert.equal(isMobileBrowser({ userAgent: "Mozilla/5.0 (X11; Linux x86_64)" }), false);
});

test("redirect sign-in requires the Firebase auth domain to match the current host", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };

  assert.equal(canUseRedirectSignIn("app.example", "app.example", storage), true);
  assert.equal(canUseRedirectSignIn("APP.EXAMPLE.", "app.example", storage), true);
  assert.equal(canUseRedirectSignIn("project.firebaseapp.com", "app.example", storage), false);
  assert.equal(canUseRedirectSignIn("https://app.example", "app.example", storage), false);
  assert.equal(canUseRedirectSignIn("app.example/path", "app.example", storage), false);
});

test("redirect sign-in is disabled when browser session storage is unavailable", () => {
  const unavailableStorage = {
    getItem() {
      return null;
    },
    setItem() {
      throw new Error("storage disabled");
    },
    removeItem() {},
  };

  assert.equal(canUseRedirectSignIn("app.example", "app.example", null), false);
  assert.equal(canUseRedirectSignIn("app.example", "app.example", unavailableStorage), false);
});

test("server session creation is verified before navigation", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ input: String(input), init });
    if (calls.length === 1) {
      return Response.json({ ok: true, publicUserId: "usr_123" });
    }
    return Response.json({ authenticated: true, uid: "firebase-uid" });
  }) as typeof fetch;

  const result = await createAndVerifyServerSession("id-token", "firebase-uid", fetcher);
  assert.equal(result.publicUserId, "usr_123");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].input, "/auth/session");
  assert.equal(calls[0].init?.method, "POST");
  assert.equal(calls[0].init?.credentials, "same-origin");
  assert.equal(calls[1].init?.method, "GET");
  assert.equal(calls[1].init?.cache, "no-store");
});

test("session creation errors retain the server reference", async () => {
  const fetcher = (async () => Response.json(
    { ok: false, error: "Could not sync account.", requestId: "request-123" },
    { status: 500 },
  )) as typeof fetch;

  await assert.rejects(
    createAndVerifyServerSession("id-token", "firebase-uid", fetcher),
    (error: Error & { requestId?: string }) => {
      assert.equal(error.message, "Could not sync account.");
      assert.equal(error.requestId, "request-123");
      return true;
    },
  );
});

test("a missing or mismatched session cookie stops navigation", async () => {
  let call = 0;
  const fetcher = (async () => {
    call += 1;
    if (call === 1) return Response.json({ ok: true, publicUserId: "usr_123" });
    return Response.json({ ok: false, error: "Invalid or expired session.", requestId: "verify-123" }, { status: 401 });
  }) as typeof fetch;

  await assert.rejects(
    createAndVerifyServerSession("id-token", "firebase-uid", fetcher),
    (error: Error & { requestId?: string }) => {
      assert.equal(error.message, "Invalid or expired session.");
      assert.equal(error.requestId, "verify-123");
      return true;
    },
  );
});

test("popup cancellation remains visible and may offer a safe redirect retry", () => {
  const details = authErrorDetails({ code: "auth/popup-closed-by-user" });
  assert.match(details.message, /closed before it finished/i);
  assert.equal(details.retryWithRedirect, true);
});
