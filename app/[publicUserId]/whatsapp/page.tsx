import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { syncUserToCentralData, resolvePublicUser, getSignedInAccountStatus } from "@/src/domains/users";

export const runtime = "nodejs";

export default async function WhatsAppLinkingPage({
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
  const pagePath = `/${publicUserId}/whatsapp`;

  if (!sessionCookie) redirect(`/login?next=${encodeURIComponent(pagePath)}`);

  const [verified, routeUser] = await Promise.all([
    verifyFirebaseSessionCookie(sessionCookie).catch(() => null),
    resolvePublicUser(publicUserId).catch(() => null),
  ]);

  if (!verified) redirect(`/login?next=${encodeURIComponent(pagePath)}`);
  const uid = verified.uid;

  if (!routeUser) notFound();

  if (uid !== routeUser.id) {
    await syncUserToCentralData(uid);
    const myStatus = await getSignedInAccountStatus(uid).catch(() => null);
    if (myStatus?.publicUserId) redirect(`/${myStatus.publicUserId}/whatsapp`);
    redirect("/login");
  }

  const homePath = `/${publicUserId}`;
  const onboardingPath = `/${publicUserId}/onboarding`;
  const accountStatus = await getSignedInAccountStatus(uid).catch(() => null);
  const whatsappLinked = !!accountStatus?.whatsappLinked;
  const email = accountStatus?.profile?.email ?? (routeUser as { profile?: { email?: string } }).profile?.email ?? "signed-in user";
  const statusLabel = whatsappLinked ? "Linked" : "Not linked";
  const statusTone = whatsappLinked ? "success" : "error";
  const statusCopy = whatsappLinked
    ? `This account is linked to ${accountStatus?.maskedPhone || "your WhatsApp number"}. Revoke it before linking a different number.`
    : "Enter a WhatsApp number, then open the bot link to complete verification.";

  const whatsappScript = `
const form = document.querySelector("[data-whatsapp-form]");
const phoneInput = document.querySelector("[data-whatsapp-phone]");
const submitButton = document.querySelector("[data-whatsapp-submit]");
const revokeButton = document.querySelector("[data-whatsapp-revoke]");
const statusPill = document.querySelector("[data-whatsapp-status]");
const copyEl = document.querySelector("[data-whatsapp-copy]");
const messageEl = document.querySelector("[data-whatsapp-message]");
const botLink = document.querySelector("[data-whatsapp-bot-link]");

function setMessage(message, tone) {
  messageEl.textContent = message || "";
  messageEl.dataset.tone = tone || "info";
}
function setPill(label, tone) {
  statusPill.textContent = label;
  statusPill.dataset.tone = tone || "info";
}
function setBusy(value) {
  submitButton.disabled = value;
  revokeButton.disabled = value;
}
function setLinked(maskedPhone) {
  setPill("Linked", "success");
  copyEl.textContent = "This account is linked to " + (maskedPhone || "your WhatsApp number") + ". Revoke it before linking a different number.";
  form.hidden = true;
  revokeButton.hidden = false;
  botLink.hidden = true;
  botLink.removeAttribute("href");
}
function setUnlinked() {
  setPill("Not linked", "error");
  copyEl.textContent = "Enter a WhatsApp number, then open the bot link to complete verification.";
  form.hidden = false;
  revokeButton.hidden = true;
  botLink.hidden = true;
  botLink.removeAttribute("href");
}
async function readJson(response) {
  const body = await response.json().catch(function() { return {}; });
  if (!response.ok) throw new Error(body.error || "Request failed with " + response.status);
  return body;
}

form.addEventListener("submit", async function(event) {
  event.preventDefault();
  setBusy(true);
  setMessage("");
  botLink.hidden = true;
  botLink.removeAttribute("href");
  try {
    const result = await readJson(await fetch("/account/whatsapp/link-request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ phone: phoneInput.value, onboarding: ${JSON.stringify(onboardingMode)} })
    }));
    if (result.alreadyLinked) {
      setLinked(result.maskedPhone);
      setMessage("This number is already linked to your account.", "success");
      return;
    }
    if (result.whatsappBotUrl) {
      botLink.href = result.whatsappBotUrl;
      botLink.hidden = false;
      setMessage("Pending request created for " + (result.maskedPhone || "that number") + ". Open the bot link to complete verification.", "success");
      return;
    }
    setMessage("Pending request created, but the WhatsApp bot link is unavailable.", "error");
  } catch (err) {
    setMessage(err.message || "Could not create WhatsApp link request.", "error");
  } finally {
    setBusy(false);
  }
});

revokeButton.addEventListener("click", async function() {
  setBusy(true);
  setMessage("");
  try {
    await readJson(await fetch("/account/whatsapp/revoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: "{}"
    }));
    phoneInput.value = "";
    setUnlinked();
    setMessage("WhatsApp link revoked.", "success");
  } catch (err) {
    setMessage(err.message || "Could not revoke WhatsApp link.", "error");
  } finally {
    setBusy(false);
  }
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
        form{display:grid;gap:12px}
        label{display:grid;gap:7px;font-weight:750;color:#303846}
        input{width:100%;min-height:44px;border:1px solid #b9c3d1;border-radius:7px;padding:0 12px;font:inherit;background:#fff;color:var(--text)}
        input:focus{outline:3px solid rgba(47,116,208,.18);border-color:var(--blue)}
        .actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
        button,a.button{display:inline-flex;min-height:42px;align-items:center;justify-content:center;border:0;border-radius:7px;background:var(--blue);color:#fff;font:inherit;font-weight:750;text-decoration:none;padding:0 14px;cursor:pointer}
        button.secondary,a.secondary{background:#eef2f7;color:#263142;border:1px solid #cbd5e1}
        button.danger{background:var(--red)}
        button:disabled{opacity:.55;cursor:not-allowed}
        button:hover:not(:disabled),a.button:hover{filter:brightness(.94)}
        button:focus-visible,a.button:focus-visible,input:focus-visible{outline:3px solid rgba(47,116,208,.28);outline-offset:2px}
        [hidden]{display:none!important}
        .message{min-height:22px;color:var(--muted);font-size:.95rem;line-height:1.45}
        .message[data-tone="success"]{color:var(--green)}
        .message[data-tone="error"]{color:#9f2419}
        .status-pill{display:inline-flex;align-items:center;min-height:30px;border-radius:999px;border:1px solid #cbd5e1;background:#f8fafc;color:#303846;padding:0 10px;font-size:.88rem;font-weight:800;white-space:nowrap}
        .status-pill[data-tone="success"]{border-color:#7fc9a2;background:#eefaf3;color:var(--green)}
        .status-pill[data-tone="error"]{border-color:#f1a7a1;background:#fff1f0;color:#9f2419}
        .meta{display:grid;gap:8px;margin:0;padding:14px;border-radius:7px;background:#f8fafc;border:1px solid var(--border);color:#303846}
        @media (max-width:680px){main{padding:18px}.panel{padding:18px}.panel-head{flex-direction:column}}
      `}} />
      <main>
        <div className="shell">
          <a className="button secondary" href={onboardingMode ? onboardingPath : homePath}>{onboardingMode ? "Back to onboarding" : "Back to dashboard"}</a>
          <section className="panel" aria-labelledby="whatsapp-title">
            <div className="panel-head">
              <div>
                <h1 id="whatsapp-title">WhatsApp Linking</h1>
                <p>Manage the WhatsApp number connected to this Genaie account.</p>
              </div>
              <span className="status-pill" data-whatsapp-status data-tone={statusTone}>{statusLabel}</span>
            </div>
            <div className="meta">
              <span>Signed in as <strong>{email}</strong></span>
              <span data-whatsapp-copy>{statusCopy}</span>
            </div>
            <form data-whatsapp-form hidden={whatsappLinked}>
              <label>
                WhatsApp number
                <input data-whatsapp-phone name="phone" type="tel" autoComplete="tel" placeholder="+213600000000" maxLength={32} required />
              </label>
              <div className="actions">
                <button data-whatsapp-submit type="submit">Create link request</button>
                <a className="button" data-whatsapp-bot-link href="#" target="_blank" rel="noreferrer" hidden>Open WhatsApp bot</a>
              </div>
            </form>
            <div className="actions">
              <button className="danger" data-whatsapp-revoke type="button" hidden={!whatsappLinked}>Revoke WhatsApp link</button>
              {onboardingMode ? <a className="button secondary" href={onboardingPath}>Continue onboarding</a> : null}
              <a className="button secondary" href="/privacy-policy">Privacy &amp; Policy</a>
            </div>
            <div className="message" data-whatsapp-message></div>
          </section>
        </div>
      </main>
      <script type="module" dangerouslySetInnerHTML={{ __html: whatsappScript }} />
    </>
  );
}
