import { type NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { parseCookies, verifyFirebaseSessionCookie } from "@/src/security/session";
import { syncUserToCentralData, getSignedInAccountStatus } from "@/src/domains/users";
import { getAccountLinkInvite, bindAccountLinkInviteToUser } from "@/src/domains/account-link";
import { maskPhone, validatePublicUserId, httpError, escapeHtml } from "@/src/lib/utils";

export const runtime = "nodejs";

function normalizeAccountLinkPurpose(purpose: string) {
  const text = String(purpose ?? "").toLowerCase().trim();
  return text || "account";
}

function purposeLabel(purpose: string) {
  const normalized = normalizeAccountLinkPurpose(purpose);
  if (normalized === "webetu") return "Webetu meal reservations";
  if (normalized === "jobs") return "Job Scout";
  if (normalized === "news") return "Personalized news";
  if (normalized === "account") return "Account link";
  return normalized.replace(/[_-]+/g, " ");
}

function normalizeNextPath(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  if (!text || text === "/") return "/";
  if (text === "/connect-gmail" || text === "/vault" || text === "/whatsapp") return text;
  if (/^\/usr_[A-Za-z0-9_-]{16}(\/.*)?$/.test(text)) return text;
  return "/";
}

function scopedPathForLink(nextPath: string, publicUserId: string) {
  const id = validatePublicUserId(publicUserId);
  const normalized = normalizeNextPath(nextPath);
  if (normalized === "/connect-gmail") return `/${id}/connect-gmail`;
  if (normalized === "/vault") return `/${id}/vault`;
  if (normalized === "/whatsapp") return `/${id}/whatsapp`;
  if (normalized === "/" || !normalized) return `/${id}`;
  return normalized;
}

function conflictHtml(details: { email: string | null; maskedPhone: string; purposeLabel: string; setupPath: string; token: string }) {
  const loginNext = `/account-link/setup?token=${encodeURIComponent(details.token)}`;
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WhatsApp already linked</title>
<style>
:root{color-scheme:light}*{box-sizing:border-box}
body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f6f7f9;color:#15171a}
main{min-height:100vh;display:grid;place-items:center;padding:24px}
section{width:min(560px,100%);background:#fff;border:1px solid #d8dee7;border-radius:8px;padding:26px;box-shadow:0 18px 45px rgba(22,28,36,.11)}
h1{margin:0 0 8px;font-size:2rem;line-height:1.08;letter-spacing:0}p{margin:0 0 18px;color:#5f6875;font-size:1rem;line-height:1.55}
.actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:18px}
button,a.button{display:inline-flex;min-height:44px;align-items:center;justify-content:center;border:0;border-radius:7px;background:#2f74d0;color:#fff;font:inherit;font-weight:750;text-decoration:none;padding:0 16px;cursor:pointer}
button.secondary,a.secondary{background:#eef2f7;color:#263142;border:1px solid #cbd5e1}
button:disabled{opacity:.55;cursor:not-allowed}.meta{display:grid;gap:8px;margin:18px 0 0;padding:14px;border-radius:7px;background:#f8fafc;border:1px solid #d8dee7;color:#303846}.meta strong{color:#15171a}
.toplink{display:inline-flex;margin-bottom:18px;color:#2f74d0;text-decoration:none;font-weight:750}
</style></head>
<body><main><section>
<a class="toplink" href="/">Back to app</a>
<h1>WhatsApp already linked</h1>
<p>This WhatsApp phone is already linked to another app account. Nothing was changed.</p>
<div class="meta">
  <div><strong>Signed-in email:</strong> ${escapeHtml(details.email ?? "Unknown email")}</div>
  <div><strong>WhatsApp:</strong> ${escapeHtml(details.maskedPhone)}</div>
  <div><strong>Purpose:</strong> ${escapeHtml(details.purposeLabel)}</div>
</div>
<div class="actions">
  <button class="secondary" data-switch-account type="button">Use a different Google account</button>
  <a class="button secondary" href="/">Cancel</a>
</div>
</section></main>
<script type="module">
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
const switchButton = document.querySelector("[data-switch-account]");
async function signOutFirebase() {
  const r = await fetch("/config/firebase");
  const s = await r.json().catch(()=>({}));
  if (!s.configured) return;
  const app = initializeApp(s.firebase);
  await signOut(getAuth(app));
}
if (switchButton) {
  switchButton.addEventListener("click", async function() {
    switchButton.disabled = true;
    try { await fetch("/auth/session/logout",{method:"POST",headers:{"content-type":"application/json"},credentials:"same-origin",body:"{}"}); } catch {}
    try { await signOutFirebase(); } catch {}
    window.location.assign(${JSON.stringify(`/login?next=${encodeURIComponent(loginNext)}`)});
  });
}
</script>
</body></html>`;
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";

  const cookieHeader = req.headers.get("cookie");
  const cookies = parseCookies(cookieHeader);
  const sessionCookie = cookies[SESSION_COOKIE_NAME];

  if (!sessionCookie) {
    const loginUrl = `/login?next=${encodeURIComponent(`/account-link/setup?token=${encodeURIComponent(token)}`)}`;
    return NextResponse.redirect(new URL(loginUrl, req.url));
  }

  let firebaseUser: any;
  try {
    firebaseUser = await verifyFirebaseSessionCookie(sessionCookie);
  } catch {
    const loginUrl = `/login?next=${encodeURIComponent(`/account-link/setup?token=${encodeURIComponent(token)}`)}`;
    return NextResponse.redirect(new URL(loginUrl, req.url));
  }

  const invite = await getAccountLinkInvite(token);
  await syncUserToCentralData(firebaseUser.uid);
  const centralUser = await getSignedInAccountStatus(firebaseUser.uid).catch(() => null);
  const email = centralUser?.profile?.email ?? firebaseUser.email ?? null;

  let result: any;
  try {
    result = await bindAccountLinkInviteToUser(token, firebaseUser);
  } catch (err: any) {
    if (err.status === 409) {
      const html = conflictHtml({
        email,
        maskedPhone: maskPhone(invite.phone),
        purposeLabel: purposeLabel(invite.purpose ?? ""),
        setupPath: "/account-link/setup",
        token,
      });
      return new NextResponse(html, { status: 409, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    throw err;
  }

  if (result.publicUserId) {
    const dest = scopedPathForLink(result.nextPath ?? invite.nextPath, result.publicUserId);
    return NextResponse.redirect(new URL(dest, req.url));
  }

  const successHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Account linked</title>
<style>:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f6f7f9;color:#15171a}main{min-height:100vh;display:grid;place-items:center;padding:24px}section{width:min(560px,100%);background:#fff;border:1px solid #d8dee7;border-radius:8px;padding:26px;box-shadow:0 18px 45px rgba(22,28,36,.11)}h1{margin:0 0 8px;font-size:2rem;line-height:1.08}p{margin:0 0 18px;color:#5f6875}button,a.button{display:inline-flex;min-height:44px;align-items:center;justify-content:center;border:0;border-radius:7px;background:#2f74d0;color:#fff;font:inherit;font-weight:750;text-decoration:none;padding:0 16px;cursor:pointer}.meta{display:grid;gap:8px;margin:18px 0 0;padding:14px;border-radius:7px;background:#f8fafc;border:1px solid #d8dee7;color:#303846}.meta strong{color:#15171a}.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}.toplink{display:inline-flex;margin-bottom:18px;color:#2f74d0;text-decoration:none;font-weight:750}</style>
</head><body><main><section>
<a class="toplink" href="/">Back to app</a>
<h1>Account linked</h1>
<p>This WhatsApp chat is now linked to ${email ? escapeHtml(email) : "your signed-in account"}.</p>
<div class="meta">
  <div><strong>WhatsApp:</strong> ${escapeHtml(maskPhone(invite.phone))}</div>
  <div><strong>Purpose:</strong> ${escapeHtml(purposeLabel(invite.purpose ?? ""))}</div>
</div>
<div class="actions"><a class="button" href="/">Continue</a></div>
</section></main></body></html>`;

  return new NextResponse(successHtml, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
