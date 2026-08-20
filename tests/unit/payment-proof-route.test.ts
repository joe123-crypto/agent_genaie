import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// The payment-proof routes and helper reach out to Firebase, Cloudflare R2, and
// Gmail. node's built-in `mock.module` needs the --experimental-test-module-mocks
// flag (which the repo's test command does not pass), so instead we inject fakes
// into the CJS require.cache BEFORE the modules under test are loaded. tsx runs
// this project as CommonJS, so a cache entry keyed by a module's resolved path is
// what every `require` of that module returns.
const require = createRequire(import.meta.url);

// signState / verifyState (used for the review token) read OAUTH_STATE_SECRET.
process.env.OAUTH_STATE_SECRET = "payment-proof-test-secret";
process.env.PUBLIC_BASE_URL = "https://app.example.com";
process.env.OWNER_FIREBASE_UID = "owner-uid";
process.env.R2_BUCKET = "test-bucket";

// --- in-memory Firestore fake -------------------------------------------------
function makeFakeDb() {
  const store = new Map<string, Record<string, unknown>>();
  function docRef(col: string, id: string) {
    const key = `${col}/${id}`;
    return {
      async set(data: Record<string, unknown>, opts?: { merge?: boolean }) {
        const prev = opts?.merge ? store.get(key) ?? {} : {};
        store.set(key, { ...prev, ...data });
      },
      async update(data: Record<string, unknown>) {
        const prev = store.get(key);
        if (!prev) throw new Error("no document to update");
        store.set(key, { ...prev, ...data });
      },
      async get() {
        const data = store.get(key);
        return { exists: data !== undefined, id, data: () => data };
      },
    };
  }
  return {
    _store: store,
    collection(col: string) {
      return { doc: (id: string) => docRef(col, id) };
    },
    async runTransaction<T>(fn: (t: unknown) => Promise<T>): Promise<T> {
      const t = {
        get: (ref: { get: () => unknown }) => ref.get(),
        set: (ref: { set: (d: unknown, o?: unknown) => unknown }, d: unknown, o?: unknown) => ref.set(d, o),
        update: (ref: { update: (d: unknown) => unknown }, d: unknown) => ref.update(d),
      };
      return fn(t);
    },
  };
}

// Mutable call recorders reset between tests.
let fakeDb = makeFakeDb();
const calls = {
  putObject: [] as Array<{ key: string; contentType: string }>,
  gmail: [] as Array<{ tokenStoreKey: string; body: any }>,
  finalize: [] as Array<{ userId?: string; contentType?: string; bytes: Buffer }>,
  presigned: [] as string[],
};
let verifyUser: { uid: string; email?: string; name?: string } = { uid: "user-1", email: "u@example.com", name: "Jane User" };
let gmailShouldThrow = false;
// Bytes returned by the R2 GetObject used during approval (the stored CV HTML).
let storedCvBytes = Buffer.from("<html><body>cv</body></html>", "utf8");

function injectMock(specifier: string, exports: Record<string, unknown>) {
  const resolved = require.resolve(specifier);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports,
  } as NodeJS.Module;
}

function installMocks() {
  injectMock("@/src/firebase/admin", { getFirestoreDb: () => fakeDb });
  injectMock("@/src/domains/r2-storage", {
    putObject: async (key: string, _body: unknown, contentType: string) => {
      calls.putObject.push({ key, contentType });
    },
    getPresignedGetUrl: async (key: string) => {
      const url = `https://r2.example/${key}?sig=test`;
      calls.presigned.push(url);
      return url;
    },
    getR2Client: () => ({
      send: async () => ({ Body: { transformToByteArray: async () => new Uint8Array(storedCvBytes) } }),
    }),
  });
  injectMock("@/src/domains/gmail", {
    resolveOwnerTokenStoreKey: () => "owner-token-store-key",
    sendGmailForTokenStoreKey: async (tokenStoreKey: string, body: any) => {
      if (gmailShouldThrow) throw new Error("gmail boom");
      calls.gmail.push({ tokenStoreKey, body });
      return { id: "sent" };
    },
  });
  injectMock("@/src/security/session", {
    verifyFirebaseRequest: async () => verifyUser,
  });
  injectMock("@/src/domains/job-scout", {
    finalizeJobScoutCvHtml: async (input: { userId?: string; contentType?: string; bytes: Buffer }) => {
      calls.finalize.push(input);
      return { ok: true };
    },
  });
}

beforeEach(() => {
  fakeDb = makeFakeDb();
  calls.putObject = [];
  calls.gmail = [];
  calls.finalize = [];
  calls.presigned = [];
  verifyUser = { uid: "user-1", email: "u@example.com", name: "Jane User" };
  gmailShouldThrow = false;
  storedCvBytes = Buffer.from("<html><body>cv</body></html>", "utf8");
  installMocks();
});

afterEach(() => {
  // Drop the routes/helper so the next test re-requires them against fresh mocks.
  for (const specifier of [
    "@/app/payment/proof/route",
    "@/app/payment/proof/decision/route",
    "@/src/domains/payment-proof",
  ]) {
    try {
      delete require.cache[require.resolve(specifier)];
    } catch {
      /* not yet loaded */
    }
  }
});

// PNG magic header + padding so it passes the size>0 check.
const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);
const NOT_IMAGE = Buffer.from("this is definitely not an image file", "utf8");

const VALID_CV = { fullName: "Jane User", email: "jane@example.com", phone: "+263771234567" };

function buildForm(opts: {
  method?: unknown;
  cv?: unknown;
  screenshot?: { bytes: Buffer; type?: string } | null;
}) {
  const form = new FormData();
  if (opts.method !== undefined) form.set("method", String(opts.method));
  if (opts.cv !== undefined) form.set("cv", typeof opts.cv === "string" ? opts.cv : JSON.stringify(opts.cv));
  if (opts.screenshot) {
    const file = new File([new Uint8Array(opts.screenshot.bytes)], "shot.png", {
      type: opts.screenshot.type ?? "image/png",
    });
    form.set("screenshot", file);
  }
  return form;
}

async function postProof(form: FormData) {
  const { NextRequest } = await import("next/server");
  const { POST } = await import("@/app/payment/proof/route");
  const req = new NextRequest("https://app.example.com/payment/proof", { method: "POST", body: form });
  return POST(req);
}

// --- POST /payment/proof -----------------------------------------------------

test("proof route rejects a non-image screenshot", async () => {
  const res = await postProof(buildForm({ method: "EcoCash", cv: VALID_CV, screenshot: { bytes: NOT_IMAGE } }));
  assert.equal(res.status, 415);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(calls.putObject.length, 0);
  assert.equal(calls.gmail.length, 0);
});

test("proof route rejects an oversize screenshot", async () => {
  const big = Buffer.concat([PNG_BYTES, Buffer.alloc(5 * 1024 * 1024 + 1, 2)]);
  const res = await postProof(buildForm({ method: "Poste", cv: VALID_CV, screenshot: { bytes: big } }));
  assert.equal(res.status, 413);
  assert.equal((await res.json()).ok, false);
});

test("proof route rejects a bad payment method", async () => {
  const res = await postProof(buildForm({ method: "PayPal", cv: VALID_CV, screenshot: { bytes: PNG_BYTES } }));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).ok, false);
});

test("proof route rejects a missing cv", async () => {
  const res = await postProof(buildForm({ method: "EcoCash", screenshot: { bytes: PNG_BYTES } }));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).ok, false);
});

test("proof route rejects invalid cv json", async () => {
  const res = await postProof(buildForm({ method: "EcoCash", cv: "{not json", screenshot: { bytes: PNG_BYTES } }));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).ok, false);
});

test("proof route rejects a cv with no full name (buildCvHtml throws)", async () => {
  const res = await postProof(
    buildForm({ method: "EcoCash", cv: { email: "x@example.com" }, screenshot: { bytes: PNG_BYTES } }),
  );
  assert.equal(res.status, 400);
  assert.equal((await res.json()).ok, false);
  assert.equal(calls.putObject.length, 0);
});

test("proof route happy path stores proof, CV, and emails the admin with attachment", async () => {
  const res = await postProof(buildForm({ method: "EcoCash", cv: VALID_CV, screenshot: { bytes: PNG_BYTES } }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });

  // Screenshot + built CV both persisted.
  assert.equal(calls.putObject.length, 2);
  assert.ok(calls.putObject.some((c) => c.key.includes("/payment-proof/") && c.contentType === "image/png"));
  assert.ok(calls.putObject.some((c) => c.key.endsWith("-cv.html")));

  // Firestore doc written as pending.
  const [docKey, docData] = [...fakeDb._store.entries()].find(([k]) => k.startsWith("paymentProofs/"))!;
  assert.ok(docKey);
  assert.equal(docData.status, "pending");
  assert.equal(docData.method, "EcoCash");
  assert.equal(docData.uid, "user-1");

  // Admin email sent with the screenshot attached and a review link.
  assert.equal(calls.gmail.length, 1);
  const sent = calls.gmail[0];
  assert.equal(sent.tokenStoreKey, "owner-token-store-key");
  assert.equal(sent.body.to, "munemojoseph332@gmail.com");
  assert.equal(sent.body.attachments.length, 1);
  assert.equal(sent.body.attachments[0].contentType, "image/png");
  assert.match(sent.body.text, /\/payment\/proof\/decision\?token=/);
});

test("proof route returns 502 when the admin email fails but keeps the proof", async () => {
  gmailShouldThrow = true;
  const res = await postProof(buildForm({ method: "Poste", cv: VALID_CV, screenshot: { bytes: PNG_BYTES } }));
  assert.equal(res.status, 502);
  assert.equal((await res.json()).ok, false);
  // Proof was persisted before the email attempt.
  assert.equal([...fakeDb._store.keys()].some((k) => k.startsWith("paymentProofs/")), true);
});

// --- GET/POST /payment/proof/decision ----------------------------------------

async function getDecision(url: string) {
  const { NextRequest } = await import("next/server");
  const { GET } = await import("@/app/payment/proof/decision/route");
  return GET(new NextRequest(url, { method: "GET" }));
}

async function postDecision(token: string, action: string) {
  const { NextRequest } = await import("next/server");
  const { POST } = await import("@/app/payment/proof/decision/route");
  const form = new FormData();
  form.set("token", token);
  form.set("action", action);
  return POST(new NextRequest("https://app.example.com/payment/proof/decision", { method: "POST", body: form }));
}

// Seed a pending proof directly through the helper (uses the fakes) and return its token.
async function seedPendingProof() {
  const helper = await import("@/src/domains/payment-proof");
  const { proofId } = await helper.createPaymentProof({
    uid: "user-1",
    method: "EcoCash",
    cvInput: VALID_CV,
    screenshotBytes: PNG_BYTES,
    screenshotContentType: "image/png",
    payer: { name: "Jane User", email: "jane@example.com", phone: "+263771234567" },
  });
  return { proofId, token: helper.paymentProofReviewToken(proofId) };
}

test("decision GET rejects a forged token", async () => {
  const res = await getDecision("https://app.example.com/payment/proof/decision?token=forged.deadbeef");
  assert.equal(res.status, 400);
  const html = await res.text();
  assert.match(html, /Invalid review link/);
});

test("decision GET renders a review page with an image and approve/deny forms for a pending proof", async () => {
  const { token } = await seedPendingProof();
  const res = await getDecision(`https://app.example.com/payment/proof/decision?token=${encodeURIComponent(token)}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/html/);
  const html = await res.text();
  assert.match(html, /<img /);
  assert.match(html, /name="action" value="approve"/);
  assert.match(html, /name="action" value="deny"/);
  assert.equal(calls.presigned.length, 1);
});

test("decision POST approve triggers finalizeJobScoutCvHtml and marks approved", async () => {
  const { proofId, token } = await seedPendingProof();
  const res = await postDecision(token, "approve");
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Approved/);
  assert.equal(calls.finalize.length, 1);
  assert.equal(calls.finalize[0].userId, "user-1");
  assert.equal(calls.finalize[0].contentType, "text/html");
  assert.equal(fakeDb._store.get(`paymentProofs/${proofId}`)!.status, "approved");
});

test("decision POST deny marks denied and never creates a CV", async () => {
  const { proofId, token } = await seedPendingProof();
  const res = await postDecision(token, "deny");
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Denied/);
  assert.equal(calls.finalize.length, 0);
  assert.equal(fakeDb._store.get(`paymentProofs/${proofId}`)!.status, "denied");
});

test("a second decision is idempotent (approve then deny keeps approved, no second finalize)", async () => {
  const { proofId, token } = await seedPendingProof();
  await postDecision(token, "approve");
  assert.equal(calls.finalize.length, 1);

  const res = await postDecision(token, "deny");
  assert.equal(res.status, 200);
  // Status stays approved; the deny is a no-op.
  assert.equal(fakeDb._store.get(`paymentProofs/${proofId}`)!.status, "approved");
  assert.equal(calls.finalize.length, 1);
});

test("decision POST rejects an unknown action", async () => {
  const { token } = await seedPendingProof();
  const res = await postDecision(token, "nuke");
  assert.equal(res.status, 400);
  assert.match(await res.text(), /approve.*deny|deny.*approve/);
});
