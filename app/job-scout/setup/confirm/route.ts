import { type NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { parseCookies, verifyFirebaseSessionCookie } from "@/src/security/session";
import { syncUserToCentralData, getSignedInAccountStatus } from "@/src/domains/users";
import { getJobScoutInvite, bindJobScoutInviteToUser } from "@/src/domains/job-scout";
import { maskPhone, validatePublicUserId, escapeHtml } from "@/src/lib/utils";

export const runtime = "nodejs";

const MINIMAL_HTML_CSS = `:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f7f8fa;color:#17191d;line-height:1.5}main{min-height:100vh;display:grid;place-items:center;padding:24px}section{width:min(560px,100%);background:#fff;border:1px solid #d8dde5;border-radius:8px;padding:24px;box-shadow:0 10px 26px rgba(22,28,36,.06);display:grid;gap:16px}h1{margin:0;font-size:1.85rem;line-height:1.15;letter-spacing:0}p{margin:0;color:#626b78;line-height:1.55}.actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}button,a.button{display:inline-flex;min-height:42px;align-items:center;justify-content:center;border:0;border-radius:7px;background:#256fca;color:#fff;font:inherit;font-weight:720;text-decoration:none;padding:0 14px;cursor:pointer}button.secondary,a.secondary{background:#eef2f7;color:#263142;border:1px solid #cbd5e1}button:disabled{opacity:.55;cursor:not-allowed}.meta{display:grid;gap:8px;padding:14px;border-radius:7px;background:#fbfcfd;border:1px solid #d8dde5;color:#303846}.meta strong{color:#17191d}.toplink{display:inline-flex;width:fit-content;color:#256fca;text-decoration:none;font-weight:720}.toplink:hover{text-decoration:underline}`;

function conflictHtml(details: { email: string | null; maskedPhone: string; token: string }) {
  const loginNext = `/job-scout/setup?token=${encodeURIComponent(details.token)}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WhatsApp already linked</title>
<style>${MINIMAL_HTML_CSS}</style>
</head><body><main><section>
<a class="toplink" href="/">Back to app</a>
<h1>WhatsApp already linked</h1>
<p>This WhatsApp phone is already linked to another app account. Nothing was changed.</p>
<div class="meta">
  <div><strong>Signed-in email:</strong> ${escapeHtml(details.email ?? "Unknown email")}</div>
  <div><strong>WhatsApp:</strong> ${escapeHtml(details.maskedPhone)}</div>
  <div><strong>Purpose:</strong> Job Scout</div>
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
    const loginUrl = `/login?next=${encodeURIComponent(`/job-scout/setup?token=${encodeURIComponent(token)}`)}`;
    return NextResponse.redirect(new URL(loginUrl, req.url));
  }

  let firebaseUser: any;
  try {
    firebaseUser = await verifyFirebaseSessionCookie(sessionCookie);
  } catch {
    const loginUrl = `/login?next=${encodeURIComponent(`/job-scout/setup?token=${encodeURIComponent(token)}`)}`;
    return NextResponse.redirect(new URL(loginUrl, req.url));
  }

  const invite = await getJobScoutInvite(token);
  await syncUserToCentralData(firebaseUser.uid);
  const centralUser = await getSignedInAccountStatus(firebaseUser.uid).catch(() => null);
  const email = centralUser?.profile?.email ?? firebaseUser.email ?? null;

  let result: any;
  try {
    result = await bindJobScoutInviteToUser(token, firebaseUser);
  } catch (err: any) {
    if (err.status === 409) {
      const html = conflictHtml({ email, maskedPhone: maskPhone(invite.phone), token });
      return new NextResponse(html, { status: 409, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    throw err;
  }

  if (result.publicUserId) {
    const id = validatePublicUserId(result.publicUserId);
    return NextResponse.redirect(new URL(`/${id}/connect-gmail`, req.url));
  }

  const connectPath = centralUser?.publicUserId ? `/${centralUser.publicUserId}/connect-gmail` : "/connect-gmail";
  const successEmail = email ? String(email) : "your signed-in account";
  const successHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Job Scout setup</title>
<style>${MINIMAL_HTML_CSS}</style>
</head><body><main><section>
<a class="toplink" href="/">Back to app</a>
<h1>Job Scout setup linked</h1>
<p>This WhatsApp chat is now linked to ${escapeHtml(successEmail)} for Job Scout.</p>
<div class="meta">
  <div><strong>Status:</strong> ${escapeHtml(result.status ?? "active")}</div>
</div>
<p>Next, connect Gmail so applications can be sent from your approved sender account. Then return to WhatsApp and choose guided questions or CV autofill.</p>
<div class="actions"><a class="button" href="${connectPath}">Connect Gmail</a></div>
</section></main></body></html>`;

  return new NextResponse(successHtml, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
