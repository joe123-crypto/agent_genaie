import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// Same injection strategy as payment-proof-route.test.ts: node's mock.module needs
// a flag the repo's test command does not pass, so fakes go into the CJS
// require.cache before the route under test is first required.
const require = createRequire(import.meta.url);

process.env.R2_BUCKET = "test-bucket";

const OWNER_UID = "owner-uid-1";
const OWNER_PUBLIC_ID = "usr_abcdefghijklmnop";
const OTHER_PUBLIC_ID = "usr_zyxwvutsrqponmlk";
const CV_HTML = "<html><body>cv</body></html>";

// --- mutable fixtures, reset per test ----------------------------------------
let sessionCookie: string | undefined;
let verifiedUid: string | null;
let routeUser: { id: string } | null;
let approved: boolean;
let conversionStatus: string;
let storedHtml: Buffer | null;
let cachedPdf: Buffer | null;
let renderShouldThrow: Error | null;
const calls = {
  rendered: 0,
  put: [] as string[],
  profileWrites: [] as Record<string, unknown>[],
};

function notFoundError() {
  const err = new Error("NoSuchKey") as Error & { name: string };
  err.name = "NoSuchKey";
  return err;
}

function injectMock(specifier: string, exports: Record<string, unknown>) {
  const resolved = require.resolve(specifier);
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports,
  } as NodeJS.Module;
}

// Minimal Firestore fake: paymentProofs answers the two-equality approval query,
// jobScoutProfiles answers the profile doc read and records merge writes.
function makeFakeDb() {
  return {
    collection(name: string) {
      if (name === "paymentProofs") {
        const query = {
          where: () => query,
          limit: () => query,
          async get() {
            return { empty: !approved };
          },
        };
        return query;
      }
      return {
        doc: () => ({
          async get() {
            return {
              exists: true,
              data: () => ({ cvConversionStatus: conversionStatus }),
            };
          },
          async set(data: Record<string, unknown>) {
            calls.profileWrites.push(data);
          },
        }),
      };
    },
  };
}

function installMocks() {
  injectMock("next/headers", {
    cookies: async () => ({ get: (name: string) => (sessionCookie ? { name, value: sessionCookie } : undefined) }),
  });
  injectMock("@/src/security/session", {
    verifyFirebaseSessionCookie: async () => (verifiedUid ? { uid: verifiedUid } : Promise.reject(new Error("bad cookie"))),
  });
  injectMock("@/src/domains/users", {
    resolvePublicUser: async () => routeUser,
  });
  injectMock("@/src/firebase/admin", { getFirestoreDb: () => makeFakeDb() });
  injectMock("@/src/domains/job-scout", {
    cvHtmlObjectKey: (uid: string) => `${uid}/cv/base/cv.html`,
    cvPdfObjectKey: (uid: string, digest: string) => `${uid}/cv/base/cv-${digest}.pdf`,
    cvHtmlDigest: () => "0123456789abcdef",
  });
  injectMock("@/src/domains/r2-storage", {
    getObjectBytes: async () => {
      if (!storedHtml) throw notFoundError();
      return storedHtml;
    },
    getObjectBytesOrNull: async () => cachedPdf,
    putObject: async (key: string) => {
      calls.put.push(key);
    },
    isObjectNotFoundError: (err: unknown) => (err as { name?: string })?.name === "NoSuchKey",
  });
  injectMock("@/src/domains/cv-pdf", {
    renderCvHtmlToPdf: async () => {
      if (renderShouldThrow) throw renderShouldThrow;
      calls.rendered += 1;
      return Buffer.from("%PDF-1.7 rendered");
    },
  });
}

beforeEach(() => {
  sessionCookie = "valid-cookie";
  verifiedUid = OWNER_UID;
  routeUser = { id: OWNER_UID };
  approved = true;
  conversionStatus = "ready";
  storedHtml = Buffer.from(CV_HTML, "utf8");
  cachedPdf = null;
  renderShouldThrow = null;
  calls.rendered = 0;
  calls.put = [];
  calls.profileWrites = [];
  installMocks();
});

afterEach(() => {
  for (const specifier of ["@/app/[publicUserId]/download-cv/pdf/route", "@/src/domains/payment-proof"]) {
    try {
      delete require.cache[require.resolve(specifier)];
    } catch {
      /* not yet loaded */
    }
  }
});

async function getPdf(publicUserId = OWNER_PUBLIC_ID) {
  const { GET } = await import("@/app/[publicUserId]/download-cv/pdf/route");
  return GET(new Request(`https://app.example.com/${publicUserId}/download-cv/pdf`), {
    params: Promise.resolve({ publicUserId }),
  });
}

// --- authorization -----------------------------------------------------------

test("a malformed publicUserId is a 404, not a lookup", async () => {
  const res = await getPdf("not-a-public-id");
  assert.equal(res.status, 404);
  assert.equal(calls.rendered, 0);
});

test("a request with no session cookie is a 401", async () => {
  sessionCookie = undefined;
  const res = await getPdf();
  assert.equal(res.status, 401);
  assert.equal(calls.rendered, 0);
});

test("an unverifiable session cookie is a 404", async () => {
  verifiedUid = null;
  const res = await getPdf();
  assert.equal(res.status, 404);
  assert.equal(calls.rendered, 0);
});

test("someone else's CV is a 404, and reveals nothing about whether it exists", async () => {
  // The signed-in user is real, but the route belongs to a different account.
  routeUser = { id: "a-different-uid" };
  const res = await getPdf(OTHER_PUBLIC_ID);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, "Not found");
  assert.equal(calls.rendered, 0);
});

test("an unknown publicUserId is the same 404 as an unauthorized one", async () => {
  routeUser = null;
  const res = await getPdf(OTHER_PUBLIC_ID);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, "Not found");
});

// --- payment / readiness gates -----------------------------------------------

test("an unapproved owner is refused with 403", async () => {
  approved = false;
  const res = await getPdf();
  assert.equal(res.status, 403);
  assert.equal(calls.rendered, 0);
});

test("an approved owner whose CV went back to pending gets 409, not a failed render", async () => {
  // This is the replaced-CV case: uploading a new PDF deletes the canonical HTML
  // and resets the status, while the payment stays approved.
  conversionStatus = "pending";
  const res = await getPdf();
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /still being prepared/);
  assert.equal(calls.rendered, 0);
});

test("a missing canonical CV object is a 409, not a retryable 5xx", async () => {
  storedHtml = null;
  const res = await getPdf();
  assert.equal(res.status, 409);
  assert.equal(calls.rendered, 0);
});

// --- happy path and caching ---------------------------------------------------

test("an approved owner gets the PDF, and the render is cached", async () => {
  const res = await getPdf();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/pdf");
  assert.equal(res.headers.get("content-disposition"), 'attachment; filename="cv.pdf"');
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.ok(Buffer.from(await res.arrayBuffer()).subarray(0, 5).equals(Buffer.from("%PDF-")));
  assert.equal(calls.rendered, 1);
  assert.deepEqual(calls.put, [`${OWNER_UID}/cv/base/cv-0123456789abcdef.pdf`]);
  assert.equal(calls.profileWrites.length, 1);
  assert.ok("cvPdfDownloadedAt" in calls.profileWrites[0]);
});

test("a cached PDF is served without launching Chromium at all", async () => {
  cachedPdf = Buffer.from("%PDF-1.7 cached");
  const res = await getPdf();
  assert.equal(res.status, 200);
  assert.equal(Buffer.from(await res.arrayBuffer()).toString(), "%PDF-1.7 cached");
  assert.equal(calls.rendered, 0, "a cache hit must not render");
  assert.equal(calls.put.length, 0, "a cache hit must not rewrite the cache");
});

test("a renderer outage is a 502 and does not record a download", async () => {
  const err = new Error("CV PDF renderer is unavailable.") as Error & { status?: number };
  err.status = 502;
  renderShouldThrow = err;
  const res = await getPdf();
  assert.equal(res.status, 502);
  // The client is never shown the raw Chromium failure.
  assert.equal((await res.json()).error, "Could not generate your CV PDF.");
  assert.equal(calls.profileWrites.length, 0, "a failed render must not mark the CV downloaded");
});

test("a nonsense error status falls back to 500 rather than crashing the response", async () => {
  const err = new Error("weird") as Error & { status?: number };
  err.status = 9999;
  renderShouldThrow = err;
  const res = await getPdf();
  assert.equal(res.status, 500);
});
