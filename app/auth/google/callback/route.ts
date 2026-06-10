import { NextRequest, NextResponse } from "next/server";
import { verifyState } from "@/src/security/crypto";
import { exchangeCodeForTokens, mirrorGmailConnectionToCentralData } from "@/src/domains/gmail";
import { saveUserTokens } from "@/src/domains/local-store";
import { tokenStoreKeyForUid, scopedPathForAccountLink, escapeHtml, escapeHtmlAttribute } from "@/src/lib/utils";
import { getSignedInAccountStatus } from "@/src/domains/users";

export const runtime = "nodejs";

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
    if (!payload || !payload.uid) throw new Error("Invalid state payload.");

    if (Date.now() - payload.ts > 10 * 60 * 1000) {
      throw new Error("State parameter expired. Please try again.");
    }

    const tokens = await exchangeCodeForTokens(code);
    const storeKey = tokenStoreKeyForUid(payload.uid);
    saveUserTokens(storeKey, tokens);

    await mirrorGmailConnectionToCentralData(payload.uid, tokens);

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
  <style>
    body { font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f6f7f9; }
    .card { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); text-align: center; }
  </style>
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
  <style>
    body { font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #fdf5f5; color: #b42318; }
    .card { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); text-align: center; max-width: 400px; }
    a { color: #2f74d0; text-decoration: none; }
  </style>
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
