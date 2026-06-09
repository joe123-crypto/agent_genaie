import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { syncUserToCentralData, resolvePublicUser, getSignedInAccountStatus } from "@/src/domains/users";

export const runtime = "nodejs";

export default async function ConnectGmailPage({ params }: { params: Promise<{ publicUserId: string }> }) {
  const { publicUserId } = await params;

  if (!/^usr_[A-Za-z0-9_-]{16}$/.test(publicUserId)) notFound();

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const connectPath = `/${publicUserId}/connect-gmail`;

  if (!sessionCookie) redirect(`/login?next=${encodeURIComponent(connectPath)}`);

  let uid: string;
  try {
    const user = await verifyFirebaseSessionCookie(sessionCookie);
    uid = user.uid;
  } catch {
    redirect(`/login?next=${encodeURIComponent(connectPath)}`);
  }

  const routeUser = await resolvePublicUser(publicUserId);
  if (!routeUser) notFound();

  if (uid !== routeUser.id) {
    await syncUserToCentralData(uid);
    const myStatus = await getSignedInAccountStatus(uid).catch(() => null);
    if (myStatus?.publicUserId) redirect(`/${myStatus.publicUserId}/connect-gmail`);
    redirect("/login");
  }

  const homePath = `/${publicUserId}`;

  const connectScript = `
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const signedOut = document.querySelector("[data-signed-out]");
const signedIn = document.querySelector("[data-signed-in]");
const emailEl = document.querySelector("[data-user-email]");
const gmailStatusEl = document.querySelector("[data-gmail-status]");
const statusEl = document.querySelector("[data-status]");
const connectButton = document.querySelector("[data-connect]");
const disconnectButton = document.querySelector("[data-disconnect]");
const signOutButton = document.querySelector("[data-sign-out]");
let auth;
let currentUser;
let sessionUser;

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

async function authedFetch(url, options) {
  const headers = Object.assign({}, options && options.headers ? options.headers : {});
  if (currentUser) {
    headers.authorization = "Bearer " + await currentUser.getIdToken();
  }
  return fetch(url, Object.assign({}, options || {}, { credentials: "same-origin", headers: headers }));
}

async function readJson(response) {
  const body = await response.json().catch(function() { return {}; });
  if (!response.ok) throw new Error(body.error || "Request failed with " + response.status);
  return body;
}

async function loadSession() {
  return readJson(await fetch("/auth/session", { credentials: "same-origin" }));
}

async function loadGmailStatus() {
  gmailStatusEl.textContent = "Checking...";
  const status = await readJson(await authedFetch("/auth/google/status", { method: "GET" }));
  if (status.connected) {
    gmailStatusEl.textContent = "Connected";
    connectButton.textContent = "Reconnect Gmail";
    disconnectButton.hidden = false;
  } else {
    gmailStatusEl.textContent = "Not connected";
    connectButton.textContent = "Connect Gmail";
    disconnectButton.hidden = true;
  }
}

async function start() {
  const response = await fetch("/config/firebase");
  const settings = await response.json();
  if (!settings.configured) {
    signedOut.hidden = true;
    signedIn.hidden = true;
    setStatus("Firebase email login is not configured yet. Missing: " + settings.missing.join(", "), "error");
    return;
  }
  const app = initializeApp(settings.firebase);
  auth = getAuth(app);

  onAuthStateChanged(auth, async function(user) {
    currentUser = user;
    sessionUser = null;
    clearStatus();
    let session = { authenticated: false };
    try { session = await loadSession(); } catch (err) {
      setStatus(err.message || "Could not check server session.", "error");
    }
    if (!user && !session.authenticated) {
      signedIn.hidden = true;
      signedOut.hidden = false;
      return;
    }
    sessionUser = session.authenticated ? session : null;
    emailEl.textContent = user?.email || sessionUser?.email || "signed-in user";
    signedOut.hidden = true;
    signedIn.hidden = false;
    try { await loadGmailStatus(); } catch (err) {
      gmailStatusEl.textContent = "Unavailable";
      setStatus(err.message || "Could not check Gmail connection.", "error");
    }
  });

  connectButton.addEventListener("click", async function() {
    if (!currentUser && !sessionUser) return;
    setBusy(true);
    clearStatus();
    try {
      const payload = await readJson(await authedFetch("/auth/google/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      }));
      window.location.href = payload.url;
    } catch (err) {
      setStatus(err.message || "Could not start Gmail connection.", "error");
      setBusy(false);
    }
  });

  disconnectButton.addEventListener("click", async function() {
    if (!currentUser && !sessionUser) return;
    setBusy(true);
    clearStatus();
    try {
      await readJson(await authedFetch("/auth/google/revoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      }));
      setStatus("Gmail disconnected.", "success");
      await loadGmailStatus();
    } catch (err) {
      setStatus(err.message || "Could not disconnect Gmail.", "error");
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
    await signOut(auth);
    window.location.assign("/login");
  });
}

start().catch(function(err) {
  setStatus(err.message || "Could not load Firebase settings.", "error");
});
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
        button.danger{background:#b42318}
        button:disabled{opacity:.55;cursor:not-allowed}
        button:focus-visible,a.button:focus-visible{outline:3px solid rgba(47,116,208,.28);outline-offset:2px}
        button:hover:not(:disabled),a.button:hover{filter:brightness(.94)}
        [hidden]{display:none!important}
        .status{margin-top:18px;padding:12px 14px;border-radius:7px;border:1px solid #cbd5e1;background:#f8fafc;color:#303846;line-height:1.45}
        .status[data-tone="success"]{border-color:#7fc9a2;background:#eefaf3;color:#11603a}
        .status[data-tone="error"]{border-color:#f1a7a1;background:#fff1f0;color:#9f2419}
        .meta{display:grid;gap:8px;margin:18px 0 0;padding:14px;border-radius:7px;background:#f8fafc;border:1px solid #d8dee7;color:#303846}
        .toplink{display:inline-flex;margin-bottom:18px;color:#2f74d0;text-decoration:none;font-weight:750}
      `}} />
      <main>
        <section>
          <a className="toplink" href={homePath}>Back to app</a>
          <h1>Connect Gmail</h1>
          <p>Sign in with email first, then grant Gmail send access for this account.</p>
          <div data-signed-out hidden suppressHydrationWarning>
            <div className="actions">
              <a className="button" href={`/login?next=${encodeURIComponent(connectPath)}`}>Sign in with email</a>
            </div>
          </div>
          <div data-signed-in hidden suppressHydrationWarning>
            <div className="meta">
              <span>Signed in as <strong data-user-email suppressHydrationWarning>…</strong></span>
              <span>Gmail status: <strong data-gmail-status suppressHydrationWarning>Checking...</strong></span>
            </div>
            <div className="actions">
              <button data-connect type="button" suppressHydrationWarning>Connect Gmail</button>
              <button className="danger" data-disconnect type="button" hidden suppressHydrationWarning>Disconnect Gmail</button>
              <button className="secondary" data-sign-out type="button" suppressHydrationWarning>Sign out</button>
            </div>
          </div>
          <div className="status" data-status hidden suppressHydrationWarning></div>
        </section>
      </main>
      <script type="module" dangerouslySetInnerHTML={{ __html: connectScript }} />
    </>
  );
}
