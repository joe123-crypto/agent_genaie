import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { resolvePublicUser } from "@/src/domains/users";
import { cvDownloadState, markCvPdfDownloaded } from "@/src/domains/payment-proof";
import { cvHtmlObjectKey, cvPdfObjectKey, cvHtmlDigest } from "@/src/domains/job-scout";
import { getObjectBytes, getObjectBytesOrNull, putObject, isObjectNotFoundError } from "@/src/domains/r2-storage";
import { renderCvHtmlToPdf } from "@/src/domains/cv-pdf";

export const runtime = "nodejs";
// Serverless Chromium (@sparticuz/chromium) has a real cold-start cost — the
// binary must decompress and launch before rendering — so give the function
// generous headroom for the launch + render on a cold invocation.
export const maxDuration = 60;

function jsonError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function pdfResponse(pdf: Buffer) {
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'attachment; filename="cv.pdf"',
      "cache-control": "no-store",
    },
  });
}

export async function GET(_req: Request, { params }: { params: Promise<{ publicUserId: string }> }) {
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

  // Same gate the page uses, so the page can never offer a download the route
  // will refuse. Approval grants access; a `ready` CV is what there is to send.
  const state = await cvDownloadState(uid).catch(() => null);
  if (state === null) return jsonError(503, "We could not check your CV right now.");
  if (state === "not_approved") return jsonError(403, "Your payment has not been approved yet.");
  if (state !== "ready") {
    return jsonError(409, "Your CV is still being prepared. It will be ready here shortly.");
  }

  try {
    const html = (await getObjectBytes(cvHtmlObjectKey(uid))).toString("utf8");
    // The rendered PDF is cached under a key derived from the HTML it came from,
    // so re-downloads skip a Chromium cold start entirely and a re-finalized CV
    // simply renders to a new key rather than needing the cache invalidated.
    const cacheKey = cvPdfObjectKey(uid, cvHtmlDigest(html));
    // Best-effort: any cache trouble at all falls through to a fresh render.
    const cached = await getObjectBytesOrNull(cacheKey).catch(() => null);
    if (cached) {
      await markCvPdfDownloaded(uid).catch(() => undefined);
      return pdfResponse(cached);
    }

    const pdf = await renderCvHtmlToPdf(html);
    await putObject(cacheKey, pdf, "application/pdf").catch(() => undefined);
    // Only mark downloaded after a successful render, so a worker outage does not
    // record a download that never reached the user.
    await markCvPdfDownloaded(uid).catch(() => undefined);
    return pdfResponse(pdf);
  } catch (err) {
    // Log the real cause (Chromium failure, missing R2 object, etc.) server-side;
    // return a generic message so raw storage/render errors never reach the client.
    console.error(`CV PDF download failed for ${publicUserId}`, err);
    // A missing canonical CV is not a transient fault — the profile said `ready`
    // but the object is gone, so tell the user to wait rather than to retry.
    if (isObjectNotFoundError(err)) {
      return jsonError(409, "Your CV is still being prepared. It will be ready here shortly.");
    }
    const status = (err as { status?: number }).status;
    return jsonError(
      Number.isInteger(status) && status! >= 400 && status! <= 599 ? status! : 500,
      "Could not generate your CV PDF.",
    );
  }
}
