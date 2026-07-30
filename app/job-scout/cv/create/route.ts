import { NextRequest, NextResponse } from "next/server";
import { verifyFirebaseRequest } from "@/src/security/session";
import { syncUserToCentralData } from "@/src/domains/users";
import { finalizeJobScoutCvHtml, getJobScoutStatusForUser } from "@/src/domains/job-scout";
import { buildCvHtml } from "@/src/domains/cv-html";
import { httpError } from "@/src/lib/utils";

export const runtime = "nodejs";

// validateCanonicalCvHtml (run inside finalizeJobScoutCvHtml) was written for
// machine-generated CV HTML: it rejects any *visible line* that looks like
// browser print chrome — a page counter ("1 / 2"), a print timestamp, or a
// file:///about:blank URL. buildCvHtml already guarantees the document is
// structurally safe, so if validation still fails here it is because the user's
// own free text happened to match one of those heuristics. Surface a message
// that points them at their text instead of leaking the internal wording.
const PRINT_CHROME_MESSAGES = new Set([
  "CV HTML contains browser print chrome.",
  "CV HTML contains a browser page counter.",
  "CV HTML contains a browser print timestamp.",
]);

function friendlyCvError(err: Error & { status?: number }) {
  if (err.status === 400 && PRINT_CHROME_MESSAGES.has(err.message)) {
    return httpError(
      400,
      "Some of your CV text looks like a page number or date on its own line (for example \"1 / 2\"). Please reword or remove that line and try again.",
    );
  }
  return err;
}

// User-facing analogue of the internal `format=html` branch in
// app/internal/job-scout/cv/route.ts: instead of the PDF worker producing the
// canonical HTML CV, the create-cv form data is turned into self-contained HTML
// here and committed through the same finalizeJobScoutCvHtml path.
export async function POST(req: NextRequest) {
  try {
    const user = await verifyFirebaseRequest(req);
    await syncUserToCentralData(user.uid);

    const payload = await req.json().catch(() => null);
    if (!payload || typeof payload !== "object") {
      throw httpError(400, "Expected a JSON body.");
    }

    // buildCvHtml validates required fields (full name) and escapes every value;
    // validateCanonicalCvHtml inside finalizeJobScoutCvHtml is the safety net.
    const html = buildCvHtml(payload);
    try {
      await finalizeJobScoutCvHtml({
        userId: user.uid,
        bytes: Buffer.from(html, "utf8"),
        contentType: "text/html",
      });
    } catch (err) {
      throw friendlyCvError(err as Error & { status?: number });
    }

    const status = await getJobScoutStatusForUser(user.uid);
    return NextResponse.json({ ok: true, ...status });
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    const status = error.status ?? 500;
    return NextResponse.json(
      { ok: false, error: error.message ?? "Internal server error" },
      { status },
    );
  }
}
