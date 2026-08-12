import { NextRequest, NextResponse } from "next/server";
import { verifyFirebaseRequest, clearGoogleSigninNonceCookieHeader } from "@/src/security/session";
import { claimPendingGmailTokens } from "@/src/domains/pending-gmail-tokens";
import { mirrorGmailConnectionToCentralData } from "@/src/domains/gmail";
import { saveUserTokens } from "@/src/domains/local-store";
import { GOOGLE_SIGNIN_NONCE_COOKIE } from "@/src/config";
import { tokenStoreKeyForUid } from "@/src/lib/utils";

export const runtime = "nodejs";

type SessionClaims = {
  email?: string;
  firebase?: { identities?: Record<string, unknown> };
};

function claimBelongsToCaller(decoded: SessionClaims, record: any) {
  const googleSub = typeof record?.googleSub === "string" ? record.googleSub : "";
  const googleEmail = typeof record?.googleEmail === "string" ? record.googleEmail : "";
  const sessionSubs = decoded.firebase?.identities?.["google.com"];
  if (googleSub && Array.isArray(sessionSubs) && sessionSubs.includes(googleSub)) return true;
  if (googleEmail && decoded.email) {
    return googleEmail.trim().toLowerCase() === decoded.email.trim().toLowerCase();
  }
  return false;
}

// Final hop of the combined sign-in + Gmail consent: the caller now has a Firebase
// session, so the Gmail tokens parked during the OAuth callback can be persisted
// under a real UID. Idempotent by design — a missing or already-claimed record just
// means "no Gmail connection to record", not an error.
export async function POST(req: NextRequest) {
  try {
    const decoded = await verifyFirebaseRequest(req);
    const nonce = req.cookies.get(GOOGLE_SIGNIN_NONCE_COOKIE)?.value ?? "";
    const record = await claimPendingGmailTokens(nonce);
    const gmailTokens = record?.gmailTokens;

    if (!gmailTokens?.access_token) {
      const nothing = NextResponse.json({ ok: true, connected: false });
      nothing.headers.set("Set-Cookie", clearGoogleSigninNonceCookieHeader());
      return nothing;
    }

    // The parked tokens belong to one Google account. Refuse to attach them to a
    // session signed in as anybody else, so a stray nonce cookie can never move a
    // refresh token onto a different user's account. Matching either the Google
    // `sub` or the verified email is deliberate: a session cookie minted from a
    // Google credential carries both, and requiring one specific claim would turn a
    // missing claim into a silent failure to connect Gmail.
    if (!claimBelongsToCaller(decoded, record)) {
      const mismatch = NextResponse.json({ ok: true, connected: false });
      mismatch.headers.set("Set-Cookie", clearGoogleSigninNonceCookieHeader());
      return mismatch;
    }

    saveUserTokens(tokenStoreKeyForUid(decoded.uid), gmailTokens);
    await mirrorGmailConnectionToCentralData(decoded.uid, gmailTokens);

    const response = NextResponse.json({ ok: true, connected: true });
    response.headers.set("Set-Cookie", clearGoogleSigninNonceCookieHeader());
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
