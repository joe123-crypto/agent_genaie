import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { syncUserToCentralData, resolvePublicUser, getSignedInAccountStatus } from "@/src/domains/users";

export const runtime = "nodejs";

export default async function VaultPage({ params }: { params: Promise<{ publicUserId: string }> }) {
  const { publicUserId } = await params;

  if (!/^usr_[A-Za-z0-9_-]{16}$/.test(publicUserId)) notFound();

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const vaultPath = `/${publicUserId}/vault`;

  if (!sessionCookie) redirect(`/login?next=${encodeURIComponent(vaultPath)}`);

  let uid: string;
  try {
    const user = await verifyFirebaseSessionCookie(sessionCookie);
    uid = user.uid;
  } catch {
    redirect(`/login?next=${encodeURIComponent(vaultPath)}`);
  }

  const routeUser = await resolvePublicUser(publicUserId);
  if (!routeUser) notFound();

  if (uid !== routeUser.id) {
    await syncUserToCentralData(uid);
    const myStatus = await getSignedInAccountStatus(uid).catch(() => null);
    if (myStatus?.publicUserId) redirect(`/${myStatus.publicUserId}/vault`);
    redirect("/login");
  }

  const homePath = `/${publicUserId}`;

  const vaultScript = `
const webetuForm = document.querySelector("[data-webetu-form]");
const webetuUsername = document.querySelector("[data-webetu-username]");
const webetuPassword = document.querySelector("[data-webetu-password]");
const webetuPasswordToggle = document.querySelector("[data-webetu-password-toggle]");
const webetuSaveButton = document.querySelector("[data-webetu-save]");
const webetuRevokeButton = document.querySelector("[data-webetu-revoke]");
const webetuStatus = document.querySelector("[data-webetu-status]");
const webetuMessage = document.querySelector("[data-webetu-message]");
const whatsappStatus = document.querySelector("[data-whatsapp-status]");
const whatsappCopy = document.querySelector("[data-whatsapp-copy]");

function setMessage(el, message, tone) {
  el.textContent = message || "";
  el.dataset.tone = tone || "info";
}
function setPill(el, label, tone) {
  el.textContent = label;
  el.dataset.tone = tone || "info";
}
function setBusy(value) {
  webetuSaveButton.disabled = value;
  webetuRevokeButton.disabled = value;
}
function setPasswordVisible(value) {
  webetuPassword.type = value ? "text" : "password";
  webetuPasswordToggle.textContent = value ? "Hide" : "Show";
  webetuPasswordToggle.setAttribute("aria-label", value ? "Hide Webetu password" : "Show Webetu password");
  webetuPasswordToggle.setAttribute("aria-pressed", value ? "true" : "false");
}
async function readJson(response) {
  const body = await response.json().catch(function() { return {}; });
  if (!response.ok) throw new Error(body.error || "Request failed with " + response.status);
  return body;
}
function webetuLabel(status) {
  if (status && status.configured) return "Saved";
  if (status && status.status === "revoked") return "Revoked";
  if (status && status.status === "not_saved") return "Not saved";
  return "Unavailable";
}
function updateWhatsAppStatus(status) {
  if (status && status.whatsappLinked) {
    setPill(whatsappStatus, "WhatsApp: Linked", "success");
    whatsappCopy.textContent = "Reservations will report to " + (status.maskedPhone || "the linked WhatsApp chat") + ".";
    return;
  }
  setPill(whatsappStatus, "WhatsApp: Not linked", "error");
  whatsappCopy.textContent = "Open a service setup link from WhatsApp first, then return here.";
}
async function loadWebetuStatus() {
  setPill(webetuStatus, "Checking...");
  const status = await readJson(await fetch("/webetu/credentials/status", { method: "GET", credentials: "same-origin" }));
  const label = webetuLabel(status);
  setPill(webetuStatus, label, status.configured ? "success" : status.status === "revoked" ? "error" : "info");
  updateWhatsAppStatus(status);
  webetuSaveButton.textContent = status.configured ? "Update credentials" : "Save credentials";
  webetuRevokeButton.hidden = !status.configured;
}

webetuForm.addEventListener("submit", async function(event) {
  event.preventDefault();
  setBusy(true);
  setMessage(webetuMessage, "");
  try {
    await readJson(await fetch("/webetu/credentials", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ username: webetuUsername.value, password: webetuPassword.value })
    }));
    webetuPassword.value = "";
    setPasswordVisible(false);
    setMessage(webetuMessage, "Webetu credentials saved.", "success");
    await loadWebetuStatus();
  } catch (err) {
    setMessage(webetuMessage, err.message || "Could not save Webetu credentials.", "error");
  } finally { setBusy(false); }
});

webetuRevokeButton.addEventListener("click", async function() {
  setBusy(true);
  setMessage(webetuMessage, "");
  try {
    await readJson(await fetch("/webetu/credentials/revoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: "{}"
    }));
    webetuPassword.value = "";
    setPasswordVisible(false);
    setMessage(webetuMessage, "Webetu credentials revoked.", "success");
    await loadWebetuStatus();
  } catch (err) {
    setMessage(webetuMessage, err.message || "Could not revoke Webetu credentials.", "error");
  } finally { setBusy(false); }
});

webetuPasswordToggle.addEventListener("click", function() {
  setPasswordVisible(webetuPassword.type === "password");
  webetuPassword.focus();
});

loadWebetuStatus().catch(function(err) {
  setPill(webetuStatus, "Unavailable", "error");
  setPill(whatsappStatus, "WhatsApp: Unavailable", "error");
  setMessage(webetuMessage, err.message || "Could not load credential status.", "error");
});
`;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        :root{color-scheme:light;--bg:#f6f7f9;--panel:#fff;--border:#d8dee7;--text:#15171a;--muted:#5f6875;--blue:#2f74d0;--green:#11603a;--red:#b42318}
        *{box-sizing:border-box}
        body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--text)}
        main{min-height:100vh;padding:28px}
        .shell{width:min(760px,100%);margin:0 auto;display:grid;gap:18px}
        .panel{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:22px;box-shadow:0 14px 36px rgba(22,28,36,.08);display:grid;gap:16px}
        .panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
        h1{margin:0;font-size:1.85rem;line-height:1.15;letter-spacing:0}
        p{margin:0;color:var(--muted);line-height:1.5}
        label{display:grid;gap:7px;font-weight:750;color:#303846}
        form{display:grid;gap:12px}
        input{width:100%;min-height:44px;border:1px solid #b9c3d1;border-radius:7px;padding:0 12px;font:inherit;background:#fff;color:var(--text)}
        input:focus{outline:3px solid rgba(47,116,208,.18);border-color:var(--blue)}
        .password-field{position:relative;display:block}
        .password-field input{padding-right:82px}
        button.password-toggle{position:absolute;right:6px;top:50%;transform:translateY(-50%);min-height:32px;border-radius:6px;background:#eef2f7;color:#263142;border:1px solid #cbd5e1;padding:0 10px;font-size:.88rem;font-weight:800}
        .actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
        button,a.button{display:inline-flex;min-height:42px;align-items:center;justify-content:center;border:0;border-radius:7px;background:var(--blue);color:#fff;font:inherit;font-weight:750;text-decoration:none;padding:0 14px;cursor:pointer}
        button.secondary,a.secondary{background:#eef2f7;color:#263142;border:1px solid #cbd5e1}
        button.danger{background:var(--red)}
        button:disabled{opacity:.55;cursor:not-allowed}
        button:hover:not(:disabled),a.button:hover{filter:brightness(.94)}
        button:focus-visible,a.button:focus-visible,input:focus-visible{outline:3px solid rgba(47,116,208,.28);outline-offset:2px}
        .message{min-height:22px;color:var(--muted);font-size:.95rem;line-height:1.45}
        .message[data-tone="success"]{color:var(--green)}
        .message[data-tone="error"]{color:#9f2419}
        .status-pill{display:inline-flex;align-items:center;min-height:30px;border-radius:999px;border:1px solid #cbd5e1;background:#f8fafc;color:#303846;padding:0 10px;font-size:.88rem;font-weight:800;white-space:nowrap}
        .status-pill[data-tone="success"]{border-color:#7fc9a2;background:#eefaf3;color:var(--green)}
        .status-pill[data-tone="error"]{border-color:#f1a7a1;background:#fff1f0;color:#9f2419}
        .account-meta{display:flex;flex-wrap:wrap;gap:10px;align-items:center;color:var(--muted)}
        .button.secondary{background:#eef2f7;color:#263142;border:1px solid #cbd5e1}
        @media (max-width:680px){main{padding:18px}.panel{padding:18px}.panel-head{flex-direction:column}}
      `}} />
      <main>
        <div className="shell">
          <a className="button secondary" href={homePath}>Back to dashboard</a>
          <section className="panel" aria-labelledby="vault-title">
            <div className="panel-head">
              <div>
                <h1 id="vault-title">Credentials Vault</h1>
                <p>Save the Webetu account used for meal reservations.</p>
              </div>
              <span className="status-pill" data-webetu-status>Checking...</span>
            </div>
            <div className="account-meta">
              <span className="status-pill" data-whatsapp-status>WhatsApp: Checking...</span>
              <span data-whatsapp-copy>Checking account link.</span>
            </div>
            <form data-webetu-form>
              <label>
                Webetu username
                <input data-webetu-username name="username" autoComplete="username" maxLength={120} required />
              </label>
              <label>
                Webetu password
                <span className="password-field">
                  <input data-webetu-password name="password" type="password" autoComplete="current-password" maxLength={256} required />
                  <button className="password-toggle" data-webetu-password-toggle type="button" aria-label="Show Webetu password" aria-pressed="false">Show</button>
                </span>
              </label>
              <div className="actions">
                <button data-webetu-save type="submit">Save credentials</button>
                <button className="danger" data-webetu-revoke type="button" hidden>Revoke</button>
                <a className="button secondary" href="/onboarding">Webetu onboarding</a>
                <a className="button secondary" href="/privacy-policy">Privacy &amp; Policy</a>
              </div>
            </form>
            <div className="message" data-webetu-message></div>
          </section>
        </div>
      </main>
      <script dangerouslySetInnerHTML={{ __html: vaultScript }} />
    </>
  );
}
