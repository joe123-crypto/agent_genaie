import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// Same injection strategy as download-cv-route.test.ts: node's mock.module needs
// a flag the repo's test command does not pass, so the fake `renderCvHtmlToPdf`
// goes into the CJS require.cache before the route under test is first required.
// Auth is exercised through the real `verifyInternalApiKey` helper (like
// google-signin-route.test.ts exercises real security code), so the env var it
// reads must be set before the route (and the config it pulls in) is imported.
const require = createRequire(import.meta.url);

process.env.AGENT_GENAI_INTERNAL_API_KEY = "test-internal-key";

const VALID_HTML = "<html><body>cv</body></html>";

let renderShouldThrow: Error | null;
let renderCalls: string[];

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
  injectMock("@/src/domains/cv-pdf", {
    renderCvHtmlToPdf: async (html: string) => {
      renderCalls.push(html);
      if (renderShouldThrow) throw renderShouldThrow;
      return Buffer.from("%PDF-1.7 rendered");
    },
  });
}

beforeEach(() => {
  renderShouldThrow = null;
  renderCalls = [];
  installMocks();
});

afterEach(() => {
  for (const specifier of ["@/app/internal/cv/pdf/route", "@/src/domains/cv-pdf"]) {
    try {
      delete require.cache[require.resolve(specifier)];
    } catch {
      /* not yet loaded */
    }
  }
});

async function postCvPdf(body: string | undefined, headers: Record<string, string> = {}) {
  const { NextRequest } = await import("next/server");
  const { POST } = await import("@/app/internal/cv/pdf/route");
  const req = new NextRequest("https://app.example.com/internal/cv/pdf", {
    method: "POST",
    body,
    headers: { authorization: "Bearer test-internal-key", "content-type": "text/html", ...headers },
  });
  return POST(req);
}

// --- authentication -----------------------------------------------------------

test("a request with no bearer token is rejected with 401 and never renders", async () => {
  const res = await postCvPdf(VALID_HTML, { authorization: "" });
  assert.equal(res.status, 401);
  assert.equal(renderCalls.length, 0);
});

test("a request with the wrong internal API key is rejected with 403 and never renders", async () => {
  const res = await postCvPdf(VALID_HTML, { authorization: "Bearer wrong-key" });
  assert.equal(res.status, 403);
  assert.equal(renderCalls.length, 0);
});

// --- body validation ------------------------------------------------------------

test("an empty body is rejected with 400 and never renders", async () => {
  const res = await postCvPdf("");
  assert.equal(res.status, 400);
  assert.equal(renderCalls.length, 0);
});

test("a body over 512 KiB is rejected with 413 and never renders", async () => {
  const oversized = "a".repeat(512 * 1024 + 1);
  const res = await postCvPdf(oversized);
  assert.equal(res.status, 413);
  assert.equal(renderCalls.length, 0);
});

test("a body at exactly the 512 KiB cap is accepted", async () => {
  const exact = "<html><body>" + "a".repeat(512 * 1024 - 26) + "</body></html>";
  assert.equal(Buffer.byteLength(exact, "utf8"), 512 * 1024);
  const res = await postCvPdf(exact);
  assert.equal(res.status, 200);
  assert.equal(renderCalls.length, 1);
});

// --- happy path -------------------------------------------------------------

test("valid HTML is rendered and returned as application/pdf", async () => {
  const res = await postCvPdf(VALID_HTML);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/pdf");
  assert.deepEqual(renderCalls, [VALID_HTML]);
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.ok(bytes.subarray(0, 5).equals(Buffer.from("%PDF-")), "buffer must start with %PDF-");
  assert.equal(bytes.toString(), "%PDF-1.7 rendered");
});

// --- render failure -----------------------------------------------------------

test("a renderer failure is a 502 without leaking the underlying error", async () => {
  const err = new Error("Chromium launch failed: /tmp/chromium: cannot execute binary file") as Error & {
    status?: number;
  };
  err.status = 502;
  renderShouldThrow = err;

  const res = await postCvPdf(VALID_HTML);
  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.doesNotMatch(body.error, /Chromium|cannot execute|\/tmp/);
  assert.equal(body.error, "Could not generate the CV PDF.");
});
