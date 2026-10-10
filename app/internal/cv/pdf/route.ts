import { NextRequest, NextResponse } from "next/server";
import { verifyInternalApiKey } from "@/src/security/session";
import { config } from "@/src/config";
import { CV_APP_URL } from "@/src/lib/cv-app";

export const runtime = "nodejs";
// The CV app may cold-start Chromium before rendering.
export const maxDuration = 60;

const UPSTREAM_TIMEOUT_MS = 55_000;

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

// DEPRECATED compatibility proxy. CV PDF rendering moved to the CV app
// (genaie-cv: POST /internal/cv/pdf). Agent workers that still call this app
// are forwarded there with the same internal API key, so they keep working
// until they are repointed. A redirect would not do: fetch drops the
// Authorization header when following a cross-origin redirect.
export async function POST(req: NextRequest) {
  try {
    verifyInternalApiKey(req);
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    return jsonError(error.status ?? 403, error.message ?? "Forbidden");
  }

  if (!process.env.NEXT_PUBLIC_CV_APP_URL?.trim() && process.env.NODE_ENV === "production") {
    console.error("CV PDF proxy: NEXT_PUBLIC_CV_APP_URL is not set");
    return jsonError(503, "CV PDF rendering has moved to the CV app, which is not configured.");
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${CV_APP_URL}/internal/cv/pdf`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.internalApiKey}`,
        "content-type": req.headers.get("content-type") ?? "text/html",
      },
      body: Buffer.from(await req.arrayBuffer()),
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    const name = (err as Error)?.name;
    console.error("CV PDF proxy: upstream request failed", { name });
    return name === "TimeoutError" || name === "AbortError"
      ? jsonError(504, "The CV app did not respond.")
      : jsonError(502, "Could not reach the CV app.");
  }

  // Pass the CV app's response (PDF or JSON error) through unchanged.
  return new NextResponse(new Uint8Array(await upstream.arrayBuffer()), {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": "no-store",
    },
  });
}
