import { NextRequest, NextResponse } from "next/server";
import { verifyFirebaseRequest } from "@/src/security/session";
import { syncUserToCentralData } from "@/src/domains/users";
import { finalizeJobScoutCvHtml, getJobScoutStatusForUser } from "@/src/domains/job-scout";
import { buildCvHtml } from "@/src/domains/cv-html";
import { httpError } from "@/src/lib/utils";

export const runtime = "nodejs";

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
    await finalizeJobScoutCvHtml({
      userId: user.uid,
      bytes: Buffer.from(html, "utf8"),
      contentType: "text/html",
    });

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
