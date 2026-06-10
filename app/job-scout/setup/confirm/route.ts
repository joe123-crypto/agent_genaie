import { type NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { parseCookies, verifyFirebaseSessionCookie } from "@/src/security/session";
import { syncUserToCentralData, getSignedInAccountStatus } from "@/src/domains/users";
import { getJobScoutInvite, bindJobScoutInviteToUser } from "@/src/domains/job-scout";
import { maskPhone, validatePublicUserId, escapeHtml } from "@/src/lib/utils";

export const runtime = "nodejs";

function conflictHtml(details: { email: string | null; maskedPhone: string; token: string }) {
  const loginNext = `/job-scout/setup?token=${encodeURIComponent(details.token)}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WhatsApp already linked</title>
<style>:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f6f7f9;color:#15171a}main{min-height:100vh;display:grid;place-items:center;padding:24px}section{width:min(560px,100%);background:#fff;border:1px solid #d8dee7;border-radius:8px;padding:26px;box-shadow:0 18px 45px rgba(22,28,36,.11)}h1{margin:0 0 8px;font-size:2rem;line-height:1.08}p{margin:0 0 18px;color:#5f6875}button,a.button{display:inline-flex;min-height:44px;align-items:center;justify-content:center;border:0;border-radius:7px;background:#2f74d0;color:#fff;font:inherit;font-weight:750;text-decoration:none;padding:0 16px;cursor:pointer}button.secondary,a.secondary{background:#eef2f7;color:#263142;border:1px solid #cbd5e1}button:disabled{opacity:.55;cursor:not-allowed}.meta{display:grid;gap:8px;margin:18px 0 0;padding:14px;border-radius:7px;background:#f8fafc;border:1px solid #d8dee7;color:#303846}.meta strong{color:#15171a}.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}.toplink{display:inline-flex;margin-bottom:18px;color:#2f74d0;text-decoration:none;font-weight:750}</style>
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
<style>:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f6f7f9;color:#15171a}main{min-height:100vh;display:grid;place-items:center;padding:24px}section{width:min(560px,100%);background:#fff;border:1px solid #d8dee7;border-radius:8px;padding:26px;box-shadow:0 18px 45px rgba(22,28,36,.11)}h1{margin:0 0 8px;font-size:2rem;line-height:1.08}p{margin:0 0 18px;color:#5f6875}button,a.button{display:inline-flex;min-height:44px;align-items:center;justify-content:center;border:0;border-radius:7px;background:#2f74d0;color:#fff;font:inherit;font-weight:750;text-decoration:none;padding:0 16px;cursor:pointer}.meta{display:grid;gap:8px;margin:18px 0 0;padding:14px;border-radius:7px;background:#f8fafc;border:1px solid #d8dee7;color:#303846}.meta strong{color:#15171a}.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}.toplink{display:inline-flex;margin-bottom:18px;color:#2f74d0;text-decoration:none;font-weight:750}</style>
</head><body><main><section>
<a class="toplink" href="/">Back to app</a>
<h1>Job Scout setup linked</h1>
<p>This WhatsApp chat is now linked to ${escapeHtml(successEmail)} for Job Scout.</p>
<div class="meta">
  <div><strong>Status:</strong> ${escapeHtml(result.status ?? "active")}</div>
</div>
<p style="margin-top:18px">Next, connect Gmail so applications can be sent from your approved sender account. Then return to WhatsApp and choose guided questions or CV autofill.</p>
<div class="actions"><a class="button" href="${connectPath}">Connect Gmail</a></div>
</section></main></body></html>`;

  return new NextResponse(successHtml, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
