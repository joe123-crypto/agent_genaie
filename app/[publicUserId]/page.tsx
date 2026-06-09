import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { syncUserToCentralData, resolvePublicUser, getSignedInAccountStatus } from "@/src/domains/users";

export const runtime = "nodejs";

export default async function DashboardPage({ params }: { params: Promise<{ publicUserId: string }> }) {
  const { publicUserId } = await params;

  if (!/^usr_[A-Za-z0-9_-]{16}$/.test(publicUserId)) notFound();

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionCookie) redirect(`/login?next=/${publicUserId}`);

  let uid: string;
  try {
    const user = await verifyFirebaseSessionCookie(sessionCookie);
    uid = user.uid;
  } catch {
    redirect(`/login?next=/${publicUserId}`);
  }

  const routeUser = await resolvePublicUser(publicUserId);
  if (!routeUser) notFound();

  if (uid !== routeUser.id) {
    await syncUserToCentralData(uid);
    const myStatus = await getSignedInAccountStatus(uid).catch(() => null);
    if (myStatus?.publicUserId) redirect(`/${myStatus.publicUserId}`);
    redirect("/login");
  }

  const homePath = `/${publicUserId}`;

  const dashboardScript = `
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const whatsappStatus = document.querySelector("[data-whatsapp-status]");
const accountCopy = document.querySelector("[data-account-copy]");
const accountError = document.querySelector("[data-account-error]");
const signOutButton = document.querySelector("[data-sign-out]");

function setWhatsAppStatus(label, tone) {
  whatsappStatus.textContent = label;
  whatsappStatus.dataset.tone = tone || "info";
}

async function signOutFirebase() {
  const response = await fetch("/config/firebase");
  const settings = await response.json().catch(function() { return {}; });
  if (!settings.configured) return;
  const app = initializeApp(settings.firebase);
  await signOut(getAuth(app));
}

async function signOutDashboard() {
  signOutButton.disabled = true;
  accountError.hidden = true;
  try {
    const response = await fetch("/auth/session/logout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: "{}"
    });
    if (!response.ok) throw new Error("Could not sign out.");
    await signOutFirebase();
    window.location.assign("/login");
  } catch (err) {
    accountError.textContent = err.message || "Could not sign out.";
    accountError.hidden = false;
    signOutButton.disabled = false;
  }
}

signOutButton.addEventListener("click", signOutDashboard);

fetch("/account/status", { credentials: "same-origin" })
  .then(function(response) { return response.json(); })
  .then(function(status) {
    if (status.whatsappLinked) {
      setWhatsAppStatus("WhatsApp: Linked", "success");
      accountCopy.textContent = "This chat is linked to " + (status.maskedPhone || "your WhatsApp number") + ".";
    } else {
      setWhatsAppStatus("WhatsApp: Not linked", "error");
      accountCopy.textContent = "Open a service link from WhatsApp to connect this login to your chat.";
    }
  })
  .catch(function() {
    setWhatsAppStatus("WhatsApp: Unavailable", "error");
    accountCopy.textContent = "Could not load account link status.";
  });
`;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        :root{color-scheme:light;--bg:#f6f7f9;--panel:#fff;--border:#d8dee7;--text:#15171a;--muted:#5f6875;--blue:#2f74d0}
        *{box-sizing:border-box}
        body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--text)}
        main{min-height:100vh;padding:28px}
        .shell{width:min(1120px,100%);margin:0 auto;display:grid;gap:18px}
        header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:6px 0 8px}
        h1{margin:0;font-size:1.85rem;line-height:1.15;letter-spacing:0}
        h2{margin:0;font-size:1.12rem;line-height:1.25;letter-spacing:0}
        p{margin:0;color:var(--muted);line-height:1.5}
        .tabs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
        .tab{display:grid;gap:8px;min-height:132px;background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:20px;text-decoration:none;color:var(--text);box-shadow:0 14px 36px rgba(22,28,36,.08)}
        .tab:hover{border-color:#9eb6d6;box-shadow:0 18px 42px rgba(22,28,36,.12)}
        .tab:focus-visible{outline:3px solid rgba(47,116,208,.28);outline-offset:2px}
        .tab strong{font-size:1.08rem}
        .tab span{color:var(--muted);line-height:1.45}
        .status-strip{display:flex;flex-wrap:wrap;gap:10px;align-items:center;background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:14px 16px}
        .status-pill{display:inline-flex;align-items:center;min-height:30px;border-radius:999px;border:1px solid #cbd5e1;background:#f8fafc;color:#303846;padding:0 10px;font-size:.88rem;font-weight:800;white-space:nowrap}
        .status-pill[data-tone="success"]{border-color:#7fc9a2;background:#eefaf3;color:#11603a}
        .status-pill[data-tone="error"]{border-color:#f1a7a1;background:#fff1f0;color:#9f2419}
        .header-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end}
        .toplink{display:inline-flex;color:var(--blue);font-weight:750;text-decoration:none}
        .toplink:hover{text-decoration:underline}
        button.secondary{display:inline-flex;min-height:38px;align-items:center;justify-content:center;border:1px solid #cbd5e1;border-radius:7px;background:#eef2f7;color:#263142;font:inherit;font-weight:750;padding:0 12px;cursor:pointer}
        button.secondary:hover:not(:disabled){filter:brightness(.96)}
        button.secondary:disabled{opacity:.55;cursor:not-allowed}
        button.secondary:focus-visible{outline:3px solid rgba(47,116,208,.28);outline-offset:2px}
        .account-error{color:#9f2419;font-size:.95rem}
        @media (max-width:760px){main{padding:18px}.tabs{grid-template-columns:1fr}header{align-items:flex-start;flex-direction:column}}
      `}} />
      <main>
        <div className="shell">
          <header>
            <div>
              <h1>Genaie Dashboard</h1>
              <p>Choose the service area you want to manage.</p>
            </div>
            <div className="header-actions">
              <a className="toplink" href="/privacy-policy">Privacy &amp; Policy</a>
              <button className="secondary" data-sign-out type="button">Sign out</button>
            </div>
          </header>
          <div className="status-strip" aria-label="Account status">
            <span className="status-pill" data-whatsapp-status suppressHydrationWarning>WhatsApp: Checking...</span>
            <p data-account-copy suppressHydrationWarning>Loading account link status.</p>
            <p className="account-error" data-account-error hidden suppressHydrationWarning></p>
          </div>
          <div className="tabs" aria-label="Dashboard tabs">
            <a className="tab" href={`${homePath}/connect-gmail`}>
              <strong>Connect Gmail</strong>
              <span>Approve or revoke Gmail send access for job application emails.</span>
            </a>
            <a className="tab" href={`${homePath}/vault`}>
              <strong>Credentials Vault</strong>
              <span>Save, update, or remove encrypted Webetu credentials.</span>
            </a>
            <a className="tab" href="/onboarding">
              <strong>Webetu Onboarding</strong>
              <span>Open the public setup guide for Webetu meal reservations.</span>
            </a>
            <a className="tab" href="/privacy-policy">
              <strong>Privacy &amp; Policy</strong>
              <span>Read how credentials and Gmail permissions are used.</span>
            </a>
          </div>
        </div>
      </main>
      <script type="module" dangerouslySetInnerHTML={{ __html: dashboardScript }} />
    </>
  );
}
