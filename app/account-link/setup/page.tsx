import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { syncUserToCentralData, getSignedInAccountStatus } from "@/src/domains/users";
import { getAccountLinkInvite } from "@/src/domains/account-link";
import { maskPhone, escapeHtml, escapeHtmlAttribute } from "@/src/lib/utils";

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

export default async function AccountLinkSetupPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;

  const setupPath = `/account-link/setup?token=${encodeURIComponent(token ?? "")}`;
  const confirmPath = `/account-link/setup/confirm?token=${encodeURIComponent(token ?? "")}`;

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionCookie) redirect(`/login?next=${encodeURIComponent(setupPath)}`);

  let uid: string;
  let email: string | null = null;
  try {
    const user = await verifyFirebaseSessionCookie(sessionCookie);
    uid = user.uid;
    email = user.email ?? null;
  } catch {
    redirect(`/login?next=${encodeURIComponent(setupPath)}`);
  }

  await syncUserToCentralData(uid!);
  const centralUser = await getSignedInAccountStatus(uid!).catch(() => null);
  email = centralUser?.profile?.email ?? email;

  const invite = await getAccountLinkInvite(token ?? "");
  const maskedPhone = maskPhone(invite.phone);
  const purpose = normalizeAccountLinkPurpose(invite.purpose ?? "");

  const switchScript = `
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const switchButton = document.querySelector("[data-switch-account]");

async function signOutFirebase() {
  const response = await fetch("/config/firebase");
  const settings = await response.json().catch(function() { return {}; });
  if (!settings.configured) return;
  const app = initializeApp(settings.firebase);
  await signOut(getAuth(app));
}

if (switchButton) {
  switchButton.addEventListener("click", async function() {
    switchButton.disabled = true;
    try {
      await fetch("/auth/session/logout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: "{}"
      });
    } catch {}
    try { await signOutFirebase(); } catch {}
    window.location.assign(${JSON.stringify(`/login?next=${encodeURIComponent(setupPath)}`)});
  });
}
`;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        :root{color-scheme:light}
        *{box-sizing:border-box}
        body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f6f7f9;color:#15171a}
        main{min-height:100vh;display:grid;place-items:center;padding:24px}
        section{width:min(560px,100%);background:#fff;border:1px solid #d8dee7;border-radius:8px;padding:26px;box-shadow:0 18px 45px rgba(22,28,36,.11)}
        h1{margin:0 0 8px;font-size:2rem;line-height:1.08;letter-spacing:0}
        p{margin:0 0 18px;color:#5f6875;font-size:1rem;line-height:1.55}
        .actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:18px}
        button,a.button{display:inline-flex;min-height:44px;align-items:center;justify-content:center;border:0;border-radius:7px;background:#2f74d0;color:#fff;font:inherit;font-weight:750;text-decoration:none;padding:0 16px;cursor:pointer}
        button.secondary,a.secondary{background:#eef2f7;color:#263142;border:1px solid #cbd5e1}
        button:disabled{opacity:.55;cursor:not-allowed}
        button:focus-visible,a.button:focus-visible{outline:3px solid rgba(47,116,208,.28);outline-offset:2px}
        button:hover:not(:disabled),a.button:hover{filter:brightness(.94)}
        .meta{display:grid;gap:8px;margin:18px 0 0;padding:14px;border-radius:7px;background:#f8fafc;border:1px solid #d8dee7;color:#303846}
        .meta strong{color:#15171a}
        .toplink{display:inline-flex;margin-bottom:18px;color:#2f74d0;text-decoration:none;font-weight:750}
      `}} />
      <main>
        <section>
          <a className="toplink" href="/">Back to app</a>
          <h1>Confirm account link</h1>
          <p>Confirm before linking this WhatsApp chat to the signed-in app account.</p>
          <div className="meta">
            <div><strong>Signed-in email:</strong> {email ?? "Unknown email"}</div>
            <div><strong>WhatsApp:</strong> {maskedPhone}</div>
            <div><strong>Purpose:</strong> {purposeLabel(purpose)}</div>
          </div>
          <div className="actions">
            <form method="post" action={confirmPath}>
              <button type="submit">Confirm and link</button>
            </form>
            <button className="secondary" data-switch-account type="button">Use a different Google account</button>
            <a className="button secondary" href="/">Cancel</a>
          </div>
        </section>
      </main>
      <script type="module" dangerouslySetInnerHTML={{ __html: switchScript }} />
    </>
  );
}
