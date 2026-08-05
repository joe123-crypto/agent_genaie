import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";

export const metadata: Metadata = {
  title: "Genaie | Connect Gmail",
  description: "Link your Gmail account so Genaie can send job applications on your behalf.",
};
import { SESSION_COOKIE_NAME } from "@/src/config";
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { syncUserToCentralData, resolvePublicUser, getSignedInAccountStatus, pricingGatePath } from "@/src/domains/users";
import { DashboardShell } from "@/app/_components/dashboard-shell";
import { OnboardingProgress } from "@/app/_components/onboarding-progress";
import { StatusNotice, StatusPill } from "@/app/_components/status-ui";

export const runtime = "nodejs";

export default async function ConnectGmailPage({
  params,
  searchParams,
}: {
  params: Promise<{ publicUserId: string }>;
  searchParams: Promise<{ onboarding?: string }>;
}) {
  const { publicUserId } = await params;
  const query = await searchParams;
  const onboardingMode = query.onboarding === "1" || query.onboarding === "true";

  if (!/^usr_[A-Za-z0-9_-]{16}$/.test(publicUserId)) notFound();

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const connectPath = `/${publicUserId}/connect-gmail`;

  if (!sessionCookie) redirect(`/login?next=${encodeURIComponent(connectPath)}`);

  // Verify the session and resolve the route's user in parallel. They are independent.
  const [verified, routeUser] = await Promise.all([
    verifyFirebaseSessionCookie(sessionCookie).catch(() => null),
    resolvePublicUser(publicUserId).catch(() => null),
  ]);

  if (!verified) redirect(`/login?next=${encodeURIComponent(connectPath)}`);
  const uid = verified.uid;

  if (!routeUser) notFound();

  if (uid !== routeUser.id) {
    await syncUserToCentralData(uid);
    const myStatus = await getSignedInAccountStatus(uid).catch(() => null);
    if (myStatus?.publicUserId) redirect(`/${myStatus.publicUserId}/connect-gmail`);
    redirect("/login");
  }

  const onboardingPath = `/${publicUserId}/onboarding`;
  const accountStatus = await getSignedInAccountStatus(uid).catch(() => null);
  if (!accountStatus?.plan) redirect(pricingGatePath(connectPath));

  // The user doc already fetched above records connection state.
  const gmailConnected = (routeUser as { services?: { gmail?: string } }).services?.gmail === "connected";
  const email = (routeUser as { profile?: { email?: string } }).profile?.email ?? "signed-in user";

  const connectScript = `
const gmailStatusEl = document.querySelector("[data-gmail-status]");
const statusEl = document.querySelector("[data-status]");
const connectButton = document.querySelector("[data-connect]");
const disconnectButton = document.querySelector("[data-disconnect]");
const signOutButton = document.querySelector("[data-sign-out]");

function setStatus(message, tone) {
  statusEl.querySelector("[data-status-label]").textContent = message;
  statusEl.dataset.statusKind = tone || "info";
  statusEl.hidden = false;
}
function clearStatus() {
  statusEl.querySelector("[data-status-label]").textContent = "";
  statusEl.hidden = true;
}
function setPill(el, label, kind) {
  el.querySelector("[data-status-label]").textContent = label;
  el.dataset.statusKind = kind;
}
function setBusy(value) {
  connectButton.disabled = value;
  disconnectButton.disabled = value;
  if (signOutButton) signOutButton.disabled = value;
}

async function readJson(response) {
  const body = await response.json().catch(function() { return {}; });
  if (!response.ok) throw new Error(body.error || "Request failed with " + response.status);
  return body;
}

async function loadGoogleStatus() {
  setPill(gmailStatusEl, "Gmail: Checking...", "loading");
  const status = await readJson(await fetch("/auth/google/status", { method: "GET", credentials: "same-origin" }));
  if (status.connected) {
    setPill(gmailStatusEl, "Gmail: Connected", "complete");
    connectButton.textContent = "Reconnect Gmail";
    disconnectButton.hidden = false;
  } else {
    setPill(gmailStatusEl, "Gmail: Not connected", "unlinked");
    connectButton.textContent = "Connect Gmail";
    disconnectButton.hidden = true;
  }
}

connectButton.addEventListener("click", async function() {
  setBusy(true);
  clearStatus();
  try {
    const payload = await readJson(await fetch("/auth/google/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(${JSON.stringify(onboardingMode ? { next: "/onboarding" } : {})})
    }));
    window.location.href = payload.url;
  } catch (err) {
    setStatus(err.message || "Could not start Gmail connection.", "error");
    setBusy(false);
  }
});

disconnectButton.addEventListener("click", async function() {
  setBusy(true);
  clearStatus();
  try {
    await readJson(await fetch("/auth/google/revoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: "{}"
    }));
    setStatus("Gmail access disconnected.", "complete");
    await loadGoogleStatus();
  } catch (err) {
    setStatus(err.message || "Could not disconnect Gmail access.", "error");
  } finally { setBusy(false); }
});

if (signOutButton) signOutButton.addEventListener("click", async function() {
  setBusy(true);
  await fetch("/auth/session/logout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
    credentials: "same-origin"
  }).catch(function() { return undefined; });
  try {
    const settings = await fetch("/config/firebase").then(function(r) { return r.json(); }).catch(function() { return {}; });
    if (settings.configured) {
      const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js");
      const { getAuth, signOut } = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js");
      await signOut(getAuth(initializeApp(settings.firebase))).catch(function() { return undefined; });
    }
  } catch (err) {
    // Best-effort client sign-out; the server session is already cleared above.
  }
  window.location.assign("/login");
});
`;

  const userLabel = (routeUser as { profile?: { displayName?: string; email?: string } }).profile?.displayName
    || (routeUser as { profile?: { email?: string } }).profile?.email
    || verified.name
    || verified.email
    || "Account";
  const connectPanel = (
    <section className="panel panel-narrow dashboard-form-panel" aria-labelledby="connect-gmail-title">
      <h1 id="connect-gmail-title">Connect Gmail</h1>
      <p>Connect Gmail so Genaie can send job applications on your behalf.</p>
      <div data-signed-in>
        <div className="meta">
          <span>Signed in as <strong data-user-email>{email}</strong></span>
          <div className="status-row" aria-label="Gmail connection status">
            <StatusPill data-gmail-status kind={gmailConnected ? "complete" : "unlinked"}>{gmailConnected ? "Gmail: Connected" : "Gmail: Not connected"}</StatusPill>
          </div>
        </div>
        <div className="actions actions-spaced">
          <button data-connect type="button">{gmailConnected ? "Reconnect Gmail" : "Connect Gmail"}</button>
          <button className="danger" data-disconnect type="button" hidden={!gmailConnected}>Disconnect Gmail</button>
          {onboardingMode ? <button className="secondary" data-sign-out type="button">Sign out</button> : null}
        </div>
      </div>
      <StatusNotice data-status hidden suppressHydrationWarning variant="block" />
    </section>
  );

  return (
    <>
      {onboardingMode ? (
        <main className="app-main app-main-center">
          <div className="shell shell-narrow">
            <OnboardingProgress backHref={onboardingPath} current={1} total={2} />
            {connectPanel}
          </div>
        </main>
      ) : (
        <DashboardShell active="settings" publicUserId={publicUserId} userLabel={userLabel}>
          {connectPanel}
        </DashboardShell>
      )}
      <script type="module" dangerouslySetInnerHTML={{ __html: connectScript }} />
    </>
  );
}
