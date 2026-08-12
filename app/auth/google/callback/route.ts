import { NextRequest, NextResponse } from "next/server";
import { verifyState } from "@/src/security/crypto";
import { exchangeCodeForTokens, mirrorGmailConnectionToCentralData } from "@/src/domains/gmail";
import { saveUserTokens } from "@/src/domains/local-store";
import { savePendingGmailTokens, deletePendingGmailTokens } from "@/src/domains/pending-gmail-tokens";
import { googleSigninNonceCookieHeader } from "@/src/security/session";
import { GMAIL_SEND_SCOPE } from "@/src/config";
import { tokenStoreKeyForUid, scopedPathForAccountLink, escapeHtml, escapeHtmlAttribute } from "@/src/lib/utils";
import { getSignedInAccountStatus } from "@/src/domains/users";

export const runtime = "nodejs";

function grantedGmailSend(scope: unknown) {
  return typeof scope === "string" && scope.split(" ").includes(GMAIL_SEND_SCOPE);
}

// The id_token comes straight from Google's token endpoint over TLS, so reading its
// payload without re-verifying the signature is safe here. We only want the stable
// `sub`, which binds the parked Gmail tokens to one Google account so they cannot be
// claimed by a different signed-in user.
function googleIdentityFromIdToken(idToken: string) {
  const payload = idToken.split(".")[1];
  if (!payload) return { sub: "", email: "" };
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return {
      sub: typeof claims?.sub === "string" ? claims.sub : "",
      email: typeof claims?.email === "string" ? claims.email : "",
    };
  } catch {
    return { sub: "", email: "" };
  }
}

const CALLBACK_HTML_CSS = `:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;font-family:Ubuntu,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#fff;color:#090909;font-weight:400;line-height:1.5;min-height:100vh;display:grid;place-items:center;padding:24px}.card{width:min(520px,100%);background:#fff;border:1px solid #e5e5e2;border-radius:8px;padding:24px;box-shadow:0 10px 26px rgba(22,28,36,.06);text-align:center;display:grid;gap:12px}h2{margin:0;color:#050505;font-size:1.5rem;font-weight:700;line-height:1.2}p{margin:0;color:#676767;font-weight:400}a{color:#090909;text-decoration:none;font-weight:500}a:hover{text-decoration:underline}`;

// Combined sign-up/sign-in + Gmail consent. At this point we hold Gmail tokens and
// Google's id_token but no Firebase UID yet, so everything is parked server-side
// under the state nonce and the browser is sent to /auth/google/finish. Neither the
// nonce nor the id_token may travel in the URL, so the nonce rides an HttpOnly
// cookie and the id_token stays in the parked record.
async function parkSignInGrant(req: NextRequest, code: string, payload: any) {
  const nonce = payload.nonce;
  if (typeof nonce !== "string" || !nonce) throw new Error("Invalid state payload.");
  try {
    const tokens = await exchangeCodeForTokens(code);
    const { id_token: googleIdToken, ...gmailTokens } = tokens;
    if (!googleIdToken) {
      throw new Error("Google did not return an identity token. Please try signing in again.");
    }

    // Declining the Gmail step is not a sign-in failure: we simply park no Gmail
    // tokens and let the user connect Gmail later.
    const gmailGranted = grantedGmailSend(tokens.scope);
    const googleIdentity = googleIdentityFromIdToken(googleIdToken);
    await savePendingGmailTokens(nonce, {
      googleIdToken,
      googleSub: googleIdentity.sub,
      googleEmail: googleIdentity.email,
      gmailGranted,
      gmailTokens: gmailGranted ? gmailTokens : null,
      next: payload.next,
    });

    const response = NextResponse.redirect(new URL("/auth/google/finish", req.nextUrl.origin), 302);
    response.headers.set("Set-Cookie", googleSigninNonceCookieHeader(nonce));
    return response;
  } catch (err) {
    await deletePendingGmailTokens(nonce);
    throw err;
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const errorParam = searchParams.get("error");

    if (errorParam) {
      throw new Error(`OAuth Error: ${errorParam}`);
    }
    if (!code || !state) {
      throw new Error("Missing code or state parameter.");
    }

    const payload = verifyState(state);
    const isSignInFlow = payload?.flow === "signin";
    if (!payload || (!isSignInFlow && !payload.uid)) throw new Error("Invalid state payload.");

    if (Date.now() - payload.ts > 10 * 60 * 1000) {
      throw new Error("State parameter expired. Please try again.");
    }

    if (isSignInFlow) return await parkSignInGrant(req, code, payload);

    const tokens = await exchangeCodeForTokens(code);
    // An identity token must never reach the Gmail token store; it is not a
    // credential this app persists.
    const { id_token: _googleIdToken, ...gmailTokens } = tokens;
    const storeKey = tokenStoreKeyForUid(payload.uid);
    saveUserTokens(storeKey, gmailTokens);

    await mirrorGmailConnectionToCentralData(payload.uid, gmailTokens);

    const userStatus = await getSignedInAccountStatus(payload.uid);
    const publicUserId = userStatus.publicUserId;
    if (!publicUserId) throw new Error("Could not resolve public user ID.");

    const redirectUrl = scopedPathForAccountLink(payload.next, publicUserId);

    return new NextResponse(
      `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Gmail Connected</title>
  <meta http-equiv="refresh" content="2;url=${escapeHtmlAttribute(redirectUrl)}">
  <style>${CALLBACK_HTML_CSS}</style>
</head>
<body>
  <div class="card">
    <h2>Gmail Connected Successfully!</h2>
    <p>Redirecting you back to the dashboard...</p>
    <p><a href="${escapeHtmlAttribute(redirectUrl)}">Click here if you are not redirected</a></p>
  </div>
</body>
</html>`,
      {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }
    );
  } catch (err: unknown) {
    const error = err as Error & { status?: number };
    const status = error.status ?? 400;
    return new NextResponse(
      `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Connection Error</title>
  <style>${CALLBACK_HTML_CSS}.card{border-color:#f1a7a1}h2{color:#9f2419}</style>
</head>
<body>
  <div class="card">
    <h2>Connection Failed</h2>
    <p>${escapeHtml(error.message || "An unknown error occurred.")}</p>
    <p><a href="/">Return to Home</a></p>
  </div>
</body>
</html>`,
      {
        status,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }
    );
  }
}
