import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { resolvePublicUser } from "@/src/domains/users";
import { hasApprovedPaymentProof, markCvPdfDownloaded } from "@/src/domains/payment-proof";
import { cvHtmlObjectKey } from "@/src/domains/job-scout";
import { getObjectBytes } from "@/src/domains/r2-storage";
import { renderCvHtmlToPdf } from "@/src/domains/cv-pdf";

export const runtime = "nodejs";
// Serverless Chromium (@sparticuz/chromium) has a real cold-start cost — the
// binary must decompress and launch before rendering — so give the function
// generous headroom for the launch + render on a cold invocation.
export const maxDuration = 60;

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ publicUserId: string }> }) {
  const { publicUserId } = await params;
  if (!/^usr_[A-Za-z0-9_-]{16}$/.test(publicUserId)) return jsonError(404, "Not found");

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) return jsonError(401, "Sign in to download your CV.");

  const [verified, routeUser] = await Promise.all([
    verifyFirebaseSessionCookie(sessionCookie).catch(() => null),
    resolvePublicUser(publicUserId).catch(() => null),
  ]);
  // Only the owner of the route may download their own CV.
  if (!verified || !routeUser || verified.uid !== routeUser.id) return jsonError(404, "Not found");
  const uid = verified.uid;

  // Approval is what finalizes the canonical CV HTML, so it gates the download.
  if (!(await hasApprovedPaymentProof(uid))) {
    return jsonError(403, "Your payment has not been approved yet.");
  }

  try {
    const html = (await getObjectBytes(cvHtmlObjectKey(uid))).toString("utf8");
    const pdf = await renderCvHtmlToPdf(html);
    // Only mark downloaded after a successful render, so a worker outage does not
    // silently switch off the post-login nudge to this page.
    await markCvPdfDownloaded(uid).catch(() => undefined);
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": 'attachment; filename="cv.pdf"',
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    // Log the real cause (Chromium failure, missing R2 object, etc.) server-side;
    // return a generic message so raw storage/render errors never reach the client.
    console.error(`CV PDF download failed for ${publicUserId}`, err);
    const status = (err as { status?: number }).status ?? 500;
    return jsonError(status, "Could not generate your CV PDF.");
  }
}
