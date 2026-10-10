import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// The deprecated /internal/cv/pdf route forwards to the CV app. Config is read
// once at import, so the env must be set before the route is first loaded.
process.env.AGENT_GENAI_INTERNAL_API_KEY = "test-internal-key";
process.env.NEXT_PUBLIC_CV_APP_URL = "https://cv.example.com";

type Call = { url: string; init: RequestInit };
let calls: Call[];
let respond: () => Promise<Response>;
const realFetch = globalThis.fetch;

beforeEach(() => {
  calls = [];
  respond = async () =>
    new Response(new Uint8Array(Buffer.from("%PDF-1.7 rendered")), {
      status: 200,
      headers: { "content-type": "application/pdf" },
    });
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    return respond();
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

async function postCvPdf(body: string, authorization = "Bearer test-internal-key") {
  const { NextRequest } = await import("next/server");
  const { POST } = await import("@/app/internal/cv/pdf/route");
  return POST(
    new NextRequest("https://app.example.com/internal/cv/pdf", {
      method: "POST",
      body,
      headers: { authorization, "content-type": "text/html" },
    }),
  );
}

test("requests without a valid internal key are rejected and never forwarded", async () => {
  assert.equal((await postCvPdf("<html></html>", "")).status, 401);
  assert.equal((await postCvPdf("<html></html>", "Bearer wrong-key")).status, 403);
  assert.equal(calls.length, 0);
});

test("the HTML is forwarded to the CV app with the internal key and the PDF is returned", async () => {
  const res = await postCvPdf("<html><body>cv</body></html>");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://cv.example.com/internal/cv/pdf");
  const headers = new Headers(calls[0].init.headers);
  assert.equal(headers.get("authorization"), "Bearer test-internal-key");
  assert.equal(headers.get("content-type"), "text/html");
  assert.equal(Buffer.from(calls[0].init.body as Uint8Array).toString(), "<html><body>cv</body></html>");

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/pdf");
  assert.equal(Buffer.from(await res.arrayBuffer()).toString(), "%PDF-1.7 rendered");
});

test("the CV app's error status and body pass through", async () => {
  respond = async () => Response.json({ ok: false, error: "CV HTML is too large." }, { status: 413 });
  const res = await postCvPdf("<html></html>");
  assert.equal(res.status, 413);
  assert.deepEqual(await res.json(), { ok: false, error: "CV HTML is too large." });
});

test("an unreachable CV app is a 502 and a timeout is a 504", async () => {
  const realConsoleError = console.error;
  console.error = () => {};
  try {
    respond = async () => {
      throw new TypeError("fetch failed");
    };
    assert.equal((await postCvPdf("<html></html>")).status, 502);
    respond = async () => {
      throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
    };
    assert.equal((await postCvPdf("<html></html>")).status, 504);
  } finally {
    console.error = realConsoleError;
  }
});
