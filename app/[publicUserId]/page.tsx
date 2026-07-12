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

  const [verified, routeUser] = await Promise.all([
    verifyFirebaseSessionCookie(sessionCookie).catch(() => null),
    resolvePublicUser(publicUserId).catch(() => null),
  ]);

  if (!verified) redirect(`/login?next=/${publicUserId}`);
  const uid = verified.uid;

  if (!routeUser) notFound();

  if (uid !== routeUser.id) {
    await syncUserToCentralData(uid);
    const myStatus = await getSignedInAccountStatus(uid).catch(() => null);
    if (myStatus?.publicUserId) redirect(`/${myStatus.publicUserId}`);
    redirect("/login");
  }

  const homePath = `/${publicUserId}`;

  const accountStatus = await getSignedInAccountStatus(uid).catch(() => null);
  const whatsappLinked = !!accountStatus?.whatsappLinked;
  const whatsappLabel = whatsappLinked ? "WhatsApp: Linked" : "WhatsApp: Not linked";
  const whatsappTone = whatsappLinked ? "success" : "error";
  const accountCopy = whatsappLinked
    ? `This chat is linked to ${accountStatus?.maskedPhone || "your WhatsApp number"}.`
    : "Open a service link from WhatsApp to connect this login to your chat.";

  const dashboardScript = `
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const accountError = document.querySelector("[data-account-error]");
const signOutButton = document.querySelector("[data-sign-out]");

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
`;

  return (
    <>
      <main className="app-main">
        <div className="shell shell-wide">
          <header className="app-header">
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
            <span className="status-pill" data-whatsapp-status data-tone={whatsappTone}>{whatsappLabel}</span>
            <p data-account-copy>{accountCopy}</p>
            <p className="account-error" data-account-error hidden></p>
          </div>
          <div className="tabs" aria-label="Dashboard tabs">
            <a className="tab" href={`${homePath}/connect-gmail`}>
              <strong>Connect Google</strong>
              <span>Approve or revoke Google access — send job application emails (Gmail) and add calendar events.</span>
            </a>
            <a className="tab" href={`${homePath}/vault`}>
              <strong>Credentials Vault</strong>
              <span>Save, update, or remove encrypted Webetu credentials.</span>
            </a>
            <a className="tab" href={`${homePath}/job-scout`}>
              <strong>Job Scout Setup</strong>
              <span>Set your CV, target role, target location, and readiness for Job Scout.</span>
            </a>
            <a className="tab" href={`${homePath}/whatsapp`}>
              <strong>WhatsApp Linking</strong>
              <span>Connect, verify, or revoke the WhatsApp number linked to this email account.</span>
            </a>
          </div>
        </div>
      </main>
      <script type="module" dangerouslySetInnerHTML={{ __html: dashboardScript }} />
    </>
  );
}
