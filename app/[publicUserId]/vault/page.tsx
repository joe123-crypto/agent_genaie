import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { syncUserToCentralData, resolvePublicUser, getSignedInAccountStatus } from "@/src/domains/users";
import { getWebetuCredentialStatus } from "@/src/domains/webetu";
import { OnboardingProgress } from "@/app/_components/onboarding-progress";

export const runtime = "nodejs";

export default async function VaultPage({
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
  const vaultPath = `/${publicUserId}/vault`;

  if (!sessionCookie) redirect(`/login?next=${encodeURIComponent(vaultPath)}`);

  const [verified, routeUser] = await Promise.all([
    verifyFirebaseSessionCookie(sessionCookie).catch(() => null),
    resolvePublicUser(publicUserId).catch(() => null),
  ]);

  if (!verified) redirect(`/login?next=${encodeURIComponent(vaultPath)}`);
  const uid = verified.uid;

  if (!routeUser) notFound();

  if (uid !== routeUser.id) {
    await syncUserToCentralData(uid);
    const myStatus = await getSignedInAccountStatus(uid).catch(() => null);
    if (myStatus?.publicUserId) redirect(`/${myStatus.publicUserId}/vault`);
    redirect("/login");
  }

  const homePath = `/${publicUserId}`;
  const onboardingPath = `/${publicUserId}/onboarding`;

  const webetuStatus = await getWebetuCredentialStatus(uid).catch(() => null);
  const webetuConfigured = !!webetuStatus?.configured;
  const webetuLabel = webetuConfigured
    ? "Saved"
    : webetuStatus?.status === "revoked"
    ? "Revoked"
    : webetuStatus
    ? "Not saved"
    : "Unavailable";
  const webetuTone = webetuConfigured ? "success" : webetuStatus?.status === "revoked" ? "error" : "info";
  const webetuSaveLabel = webetuConfigured ? "Update credentials" : "Save credentials";

  const whatsappLinked = !!webetuStatus?.whatsappLinked;
  const whatsappLabel = whatsappLinked ? "WhatsApp: Linked" : "WhatsApp: Not linked";
  const whatsappTone = whatsappLinked ? "success" : "error";
  const whatsappCopy = whatsappLinked
    ? `Reservations will report to ${webetuStatus?.maskedPhone || "the linked WhatsApp chat"}.`
    : "Open a service setup link from WhatsApp first, then return here.";

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
`;

  return (
    <>
      <main className="app-main">
        <div className="shell">
          {onboardingMode ? <OnboardingProgress backHref={onboardingPath} current={3} total={3} /> : <a className="toplink" href={homePath}>Back to dashboard</a>}
          <section className="panel" aria-labelledby="vault-title">
            <div className="panel-head">
              <div>
                <h1 id="vault-title">Credentials Vault</h1>
                <p>Save the Webetu account used for meal reservations.</p>
              </div>
              <span className="status-pill" data-webetu-status data-tone={webetuTone}>{webetuLabel}</span>
            </div>
            <div className="account-meta">
              <span className="status-pill" data-whatsapp-status data-tone={whatsappTone}>{whatsappLabel}</span>
              <span data-whatsapp-copy>{whatsappCopy}</span>
            </div>
            <form className="form-stack" data-webetu-form>
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
                <button data-webetu-save type="submit">{webetuSaveLabel}</button>
                <button className="danger" data-webetu-revoke type="button" hidden={!webetuConfigured}>Revoke</button>
                {onboardingMode ? <a className="button secondary" href={onboardingPath}>Continue onboarding</a> : null}
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
