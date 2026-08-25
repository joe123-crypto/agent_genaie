import { NextRequest, NextResponse } from "next/server";
import { httpError } from "@/src/lib/utils";
import { buildCvHtml } from "@/src/domains/cv-html";
import { renderCvHtmlToPdf } from "@/src/domains/cv-pdf";
import { checkRateLimit, clientIpFromRequest, rateLimitKey } from "@/src/lib/rate-limit";
import type { CvInput } from "@/src/domains/cv-html";

export const runtime = "nodejs";
// Serverless Chromium (@sparticuz/chromium) has a real cold-start cost — the
// binary must decompress and launch before rendering — so give the function
// generous headroom for the launch + render on a cold invocation.
export const maxDuration = 60;

// This endpoint is deliberately open (no sign-in, no payment approval), and every
// request launches a headless Chromium to render the PDF. Without a cap that is an
// open door to an expensive renderer, so anonymous callers are rate limited per
// client IP — the same guard the signed-out CV interview uses for the paid model.
const DOWNLOADS_PER_HOUR = 20;
const ONE_HOUR_MS = 60 * 60 * 1000;

// Owner decision: the CV is handed over directly from the draft, with no payment
// proof, admin approval, or download gate. The payer builds their CV, then the
// "Send payment proof" button posts the draft here and immediately downloads the
// rendered PDF. This intentionally bypasses the approval flow in
// app/payment/proof/route.ts and the gate in cvDownloadState().
export async function POST(req: NextRequest) {
  try {
    const limit = await checkRateLimit(
      rateLimitKey("cv-download-anon", clientIpFromRequest(req)),
      DOWNLOADS_PER_HOUR,
      ONE_HOUR_MS,
    );
    if (!limit.allowed) {
      return NextResponse.json(
        { ok: false, error: "Too many downloads. Please try again shortly." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
      );
    }

    const body = (await req.json().catch(() => null)) as { cv?: unknown; template?: unknown } | null;
    if (!body || typeof body !== "object") {
      throw httpError(400, "A CV is required to build your download.");
    }

    const cvInput = body.cv;
    if (!cvInput || typeof cvInput !== "object") {
      throw httpError(400, "A CV is required to build your download.");
    }

    const templateId = typeof body.template === "string" ? body.template : undefined;

    // buildCvHtml validates the draft (non-empty fullName) and escapes every value,
    // throwing httpError(400,...) on bad input, so an invalid CV never reaches the renderer.
    const html = buildCvHtml(cvInput as CvInput, templateId);
    const pdf = await renderCvHtmlToPdf(html);

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": 'attachment; filename="cv.pdf"',
        "cache-control": "no-store",
      },
    });
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    const status = error.status ?? 500;
    console.error("Direct CV download failed", { status, message: error?.message });
    return NextResponse.json(
      { ok: false, error: status === 500 ? "Could not generate your CV PDF." : error.message },
      { status },
    );
  }
}
