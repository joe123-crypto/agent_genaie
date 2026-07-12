import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { syncUserToCentralData, resolvePublicUser, getSignedInAccountStatus } from "@/src/domains/users";
import { OnboardingProgress } from "@/app/_components/onboarding-progress";

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

  const homePath = `/${publicUserId}`;
  const onboardingPath = `/${publicUserId}/onboarding`;

  // The user doc already fetched above records connection state.
  const gmailConnected = (routeUser as { services?: { gmail?: string } }).services?.gmail === "connected";
  const calendarConnected = (routeUser as { services?: { calendar?: string } }).services?.calendar === "connected";
  const email = (routeUser as { profile?: { email?: string } }).profile?.email ?? "signed-in user";

  const connectScript = `
const gmailStatusEl = document.querySelector("[data-gmail-status]");
const calendarStatusEl = document.querySelector("[data-calendar-status]");
const statusEl = document.querySelector("[data-status]");
const connectButton = document.querySelector("[data-connect]");
const disconnectButton = document.querySelector("[data-disconnect]");
const signOutButton = document.querySelector("[data-sign-out]");

function setStatus(message, tone) {
  statusEl.textContent = message;
  statusEl.dataset.tone = tone || "info";
  statusEl.hidden = false;
}
function clearStatus() {
  statusEl.textContent = "";
  statusEl.hidden = true;
}
function setBusy(value) {
  connectButton.disabled = value;
  disconnectButton.disabled = value;
  signOutButton.disabled = value;
}

async function readJson(response) {
  const body = await response.json().catch(function() { return {}; });
  if (!response.ok) throw new Error(body.error || "Request failed with " + response.status);
  return body;
}

async function loadGoogleStatus() {
  gmailStatusEl.textContent = "Checking...";
  calendarStatusEl.textContent = "Checking...";
  const status = await readJson(await fetch("/auth/google/status", { method: "GET", credentials: "same-origin" }));
  if (status.connected) {
    gmailStatusEl.textContent = "Connected";
    connectButton.textContent = "Reconnect Google";
    disconnectButton.hidden = false;
  } else {
    gmailStatusEl.textContent = "Not connected";
    connectButton.textContent = "Connect Google";
    disconnectButton.hidden = true;
  }
  calendarStatusEl.textContent = status.calendarConnected ? "Connected" : "Not connected";
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
    setStatus(err.message || "Could not start Google connection.", "error");
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
    setStatus("Google access disconnected.", "success");
    await loadGoogleStatus();
  } catch (err) {
    setStatus(err.message || "Could not disconnect Google access.", "error");
  } finally { setBusy(false); }
});

signOutButton.addEventListener("click", async function() {
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

  return (
    <>
      <main className="app-main app-main-center">
        <div className="shell shell-narrow">
          {onboardingMode ? <OnboardingProgress backHref={onboardingPath} current={3} total={4} /> : null}
          <section className="panel panel-narrow">
            {!onboardingMode ? <a className="toplink" href={homePath}>Back to app</a> : null}
            <h1>Connect Google</h1>
            <p>Connect Gmail and Calendar for job applications.</p>
            <div data-signed-in>
              <div className="meta">
                <span>Signed in as <strong data-user-email>{email}</strong></span>
                <span>Gmail status: <strong data-gmail-status>{gmailConnected ? "Connected" : "Not connected"}</strong></span>
                <span>Calendar status: <strong data-calendar-status>{calendarConnected ? "Connected" : "Not connected"}</strong></span>
              </div>
              <div className="actions actions-spaced">
                <button data-connect type="button">{gmailConnected ? "Reconnect Google" : "Connect Google"}</button>
                <button className="danger" data-disconnect type="button" hidden={!gmailConnected}>Disconnect Google</button>
                {onboardingMode ? <a className="button secondary" href={onboardingPath}>Continue onboarding</a> : null}
                <button className="secondary" data-sign-out type="button">Sign out</button>
              </div>
            </div>
            <div className="status" data-status hidden suppressHydrationWarning></div>
          </section>
        </div>
      </main>
      <script type="module" dangerouslySetInnerHTML={{ __html: connectScript }} />
    </>
  );
}
