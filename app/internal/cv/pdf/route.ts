import { NextRequest, NextResponse } from "next/server";
import { verifyInternalApiKey } from "@/src/security/session";
import { httpError } from "@/src/lib/utils";
import { renderCvHtmlToPdf } from "@/src/domains/cv-pdf";

export const runtime = "nodejs";
// Serverless Chromium (@sparticuz/chromium) has a real cold-start cost — the
// binary must decompress and launch before rendering — so give the function
// generous headroom for the launch + render on a cold invocation.
export const maxDuration = 60;

// The calling WhatsApp service (Railway: Poppler + Tesseract, no Chromium)
// enforces this same cap before it ever sends the HTML here — keep the number
// identical so a request it considers valid is never rejected on this end.
const MAX_HTML_BYTES = 512 * 1024;

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function pdfResponse(pdf: Buffer) {
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "cache-control": "no-store",
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    verifyInternalApiKey(req);

    const bytes = Buffer.from(await req.arrayBuffer());
    if (bytes.length > MAX_HTML_BYTES) {
      throw httpError(413, `CV HTML is too large (max ${MAX_HTML_BYTES} bytes).`);
    }
    if (bytes.length === 0) {
      throw httpError(400, "Request body must be non-empty HTML.");
    }
    const html = bytes.toString("utf8");

    const pdf = await renderCvHtmlToPdf(html);
    return pdfResponse(pdf);
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    const status = error.status;
    if (status === 502) {
      // renderCvHtmlToPdf already logs the underlying Chromium/launch cause
      // server-side; never let its message or a stack trace reach the caller.
      // Same flattened shape as the existing download-cv PDF route.
      return jsonError(502, "Could not generate the CV PDF.");
    }
    return NextResponse.json(
      { ok: false, error: error.message ?? "Internal server error" },
      { status: Number.isInteger(status) && status! >= 400 && status! <= 599 ? status! : 500 },
    );
  }
}
