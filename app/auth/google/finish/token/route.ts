import { NextRequest, NextResponse } from "next/server";
import {
  claimPendingGmailTokens,
  createPendingNonce,
  savePendingGmailTokens,
} from "@/src/domains/pending-gmail-tokens";
import {
  googleSigninNonceCookieHeader,
  clearGoogleSigninNonceCookieHeader,
} from "@/src/security/session";
import { GOOGLE_SIGNIN_NONCE_COOKIE } from "@/src/config";
import { normalizeAccountLinkNextPath } from "@/src/lib/utils";

export const runtime = "nodejs";

// Hands the finish page Google's id_token so it can create a Firebase session.
// The Gmail tokens deliberately stay behind: they are re-parked under a fresh
// nonce that replaces the cookie, so the refresh token never reaches the browser
// while each hop stays one-shot. Unauthenticated by necessity (no session exists
// yet); the SameSite=Lax nonce cookie is what keeps other sites from driving it.
export async function POST(req: NextRequest) {
  try {
    const nonce = req.cookies.get(GOOGLE_SIGNIN_NONCE_COOKIE)?.value ?? "";
    const record = await claimPendingGmailTokens(nonce);
    const googleIdToken = record?.googleIdToken;

    if (!googleIdToken) {
      const expired = NextResponse.json(
        { ok: false, error: "This sign-in attempt expired or was already completed. Please sign in again." },
        { status: 400 }
      );
      expired.headers.set("Set-Cookie", clearGoogleSigninNonceCookieHeader());
      return expired;
    }

    const gmailTokens = record.gmailGranted ? record.gmailTokens : null;
    const gmailGranted = Boolean(gmailTokens);

    let cookieHeader = clearGoogleSigninNonceCookieHeader();
    if (gmailGranted) {
      const nextNonce = createPendingNonce();
      await savePendingGmailTokens(nextNonce, {
        gmailTokens,
        gmailGranted: true,
        googleSub: record.googleSub ?? "",
        googleEmail: record.googleEmail ?? "",
      });
      cookieHeader = googleSigninNonceCookieHeader(nextNonce);
    }

    const response = NextResponse.json({
      ok: true,
      googleIdToken,
      gmailGranted,
      next: normalizeAccountLinkNextPath(record.next),
    });
    response.headers.set("Set-Cookie", cookieHeader);
    return response;
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    const status = error.status ?? 500;
    return NextResponse.json(
      { ok: false, error: error.message ?? "Internal server error" },
      { status }
    );
  }
}
