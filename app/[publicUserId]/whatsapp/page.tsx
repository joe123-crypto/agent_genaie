import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";

export const metadata: Metadata = {
  title: "Genaie | WhatsApp",
  description: "Link your WhatsApp number to receive Job Scout notifications and updates.",
};
import { SESSION_COOKIE_NAME } from "@/src/config";
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { syncUserToCentralData, resolvePublicUser, getSignedInAccountStatus, pricingGatePath } from "@/src/domains/users";
import {
  getAccountLinkInvite,
  whatsappBotLink,
} from "@/src/domains/account-link";
import { getOnboardingStatus } from "@/src/domains/onboarding";
import { maskPhone, setupPurposeLabel } from "@/src/lib/utils";
import { OnboardingProgress } from "@/app/_components/onboarding-progress";
import { DashboardShell } from "@/app/_components/dashboard-shell";
import { StatusNotice, StatusPill } from "@/app/_components/status-ui";

export const runtime = "nodejs";

export default async function WhatsAppLinkingPage({
  params,
  searchParams,
}: {
  params: Promise<{ publicUserId: string }>;
  searchParams: Promise<{ onboarding?: string; token?: string; handoff?: string }>;
}) {
  const { publicUserId } = await params;
  const query = await searchParams;
  const token = String(query.token ?? "").trim();
  const tokenMode = Boolean(token);
  const onboardingMode = query.onboarding === "1" || query.onboarding === "true";

  if (!/^usr_[A-Za-z0-9_-]{16}$/.test(publicUserId)) notFound();

  const queryString = new URLSearchParams();
  if (token) queryString.set("token", token);
  if (onboardingMode) queryString.set("onboarding", "1");
  if (query.handoff === "1") queryString.set("handoff", "1");
  const pagePath = `/${publicUserId}/whatsapp${queryString.size ? `?${queryString}` : ""}`;
  const sessionCookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) redirect(`/login?next=${encodeURIComponent(pagePath)}`);

  const [verified, routeUser] = await Promise.all([
    verifyFirebaseSessionCookie(sessionCookie).catch(() => null),
    resolvePublicUser(publicUserId).catch(() => null),
  ]);
  if (!verified) redirect(`/login?next=${encodeURIComponent(pagePath)}`);
  if (!routeUser) notFound();

  const uid = verified.uid;
  if (uid !== routeUser.id) {
    const synced = await syncUserToCentralData(uid);
    if (synced.publicUserId) {
      redirect(`/${synced.publicUserId}/whatsapp${queryString.size ? `?${queryString}` : ""}`);
    }
    redirect("/login");
  }

  const [accountStatus, invite, onboardingStatus] = await Promise.all([
    getSignedInAccountStatus(uid).catch(() => null),
    tokenMode ? getAccountLinkInvite(token) : Promise.resolve(null),
    onboardingMode ? getOnboardingStatus(uid).catch(() => null) : Promise.resolve(null),
  ]);
  if (!tokenMode && !accountStatus?.plan) redirect(pricingGatePath(pagePath));
  const homePath = `/${publicUserId}`;
  const onboardingPath = `/${publicUserId}/onboarding`;
  // Job Scout onboarding is Connect Gmail then the Job Scout profile (the chat
  // handoff stands in for that second step); WhatsApp linking is no longer a step.
  const onboardingTotal = onboardingStatus?.selectedService === "webetu" ? 3 : 2;
  const whatsappLinked = !!accountStatus?.whatsappLinked;
  const email = accountStatus?.profile?.email
    ?? (routeUser as { profile?: { email?: string } }).profile?.email
    ?? "signed-in user";
  const chatHandoff = Boolean(
    onboardingMode
      && onboardingStatus?.channel === "chat"
      && onboardingStatus.nextStep === "whatsapp_chat",
  );
  let chatHandoffUrl: string | null = null;
  if (chatHandoff) {
    try {
      chatHandoffUrl = whatsappBotLink("Continue my Job Scout setup in this chat.");
    } catch {
      chatHandoffUrl = null;
    }
  }

  // Once WhatsApp is linked the onboarding step is satisfied, so continue automatically
  // instead of offering a redundant manual button. The invite/token confirm flow and the
  // chat handoff have their own navigation and are excluded.
  if (onboardingMode && !tokenMode && !chatHandoff && whatsappLinked) {
    redirect(onboardingPath);
  }

  const statusLabel = tokenMode ? "Ready to link" : whatsappLinked ? "Linked" : "Not linked";
  const statusKind = tokenMode ? "pending" : whatsappLinked ? "complete" : "unlinked";
  const statusCopy = tokenMode
    ? "Confirm this link to use the WhatsApp chat shown below with your signed-in account."
    : whatsappLinked
      ? `This account is linked to ${accountStatus?.maskedPhone || "your WhatsApp number"}. Revoke it before linking a different number.`
      : onboardingMode
        ? "link your WhatsApp to get job application updates in chat"
        : "Enter a WhatsApp number, then open the bot link to complete verification.";

  const whatsappScript = `
const inviteForm = document.querySelector("[data-whatsapp-invite-form]");
const directForm = document.querySelector("[data-whatsapp-form]");
const phoneInput = document.querySelector("[data-whatsapp-phone]");
const submitButton = document.querySelector("[data-whatsapp-submit]");
const confirmButton = document.querySelector("[data-whatsapp-confirm]");
const revokeButton = document.querySelector("[data-whatsapp-revoke]");
const skipButton = document.querySelector("[data-whatsapp-skip]");
const switchButton = document.querySelector("[data-switch-account]");
const statusPill = document.querySelector("[data-whatsapp-status]");
const copyEl = document.querySelector("[data-whatsapp-copy]");
const messageEl = document.querySelector("[data-whatsapp-message]");
const botLink = document.querySelector("[data-whatsapp-bot-link]");

function setMessage(message, tone) {
  messageEl.querySelector("[data-status-label]").textContent = message || "";
  messageEl.dataset.statusKind = tone || "info";
}
function setPill(label, kind) {
  statusPill.querySelector("[data-status-label]").textContent = label;
  statusPill.dataset.statusKind = kind || "info";
}
function setBusy(value) {
  if (submitButton) submitButton.disabled = value;
  if (confirmButton) confirmButton.disabled = value;
  if (revokeButton) revokeButton.disabled = value;
  if (skipButton) skipButton.disabled = value;
  if (switchButton) switchButton.disabled = value;
}
function setLinked(maskedPhone) {
  setPill("Linked", "complete");
  copyEl.textContent = "This account is linked to " + (maskedPhone || "your WhatsApp number") + ". Revoke it before linking a different number.";
  if (directForm) directForm.hidden = true;
  if (revokeButton) revokeButton.hidden = false;
  if (botLink) {
    botLink.hidden = true;
    botLink.removeAttribute("href");
  }
}
function setUnlinked() {
  setPill("Not linked", "unlinked");
  copyEl.textContent = "Enter a WhatsApp number, then open the bot link to complete verification.";
  if (directForm) directForm.hidden = false;
  if (revokeButton) revokeButton.hidden = true;
  if (botLink) {
    botLink.hidden = true;
    botLink.removeAttribute("href");
  }
}
async function readJson(response) {
  const body = await response.json().catch(function() { return {}; });
  if (!response.ok) throw new Error(body.error || "Request failed with " + response.status);
  return body;
}

if (inviteForm) inviteForm.addEventListener("submit", async function(event) {
  event.preventDefault();
  setBusy(true);
  setMessage("Linking this WhatsApp chat...", "loading");
  try {
    const result = await readJson(await fetch("/account/whatsapp/link-request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ token: ${JSON.stringify(token)} })
    }));
    setMessage("WhatsApp linked. Continuing setup...", "complete");
    window.location.assign(result.destination || ${JSON.stringify(onboardingPath)});
  } catch (err) {
    setMessage(err.message || "Could not link this WhatsApp chat.", "error");
    setBusy(false);
  }
});

if (directForm) directForm.addEventListener("submit", async function(event) {
  event.preventDefault();
  setBusy(true);
  setMessage("");
  if (botLink) {
    botLink.hidden = true;
    botLink.removeAttribute("href");
  }
  try {
    const result = await readJson(await fetch("/account/whatsapp/link-request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ phone: phoneInput.value, onboarding: ${JSON.stringify(onboardingMode)} })
    }));
    if (result.alreadyLinked) {
      setLinked(result.maskedPhone);
      setMessage("This number is already linked to your account.", "complete");
      return;
    }
    if (result.whatsappBotUrl && botLink) {
      botLink.href = result.whatsappBotUrl;
      botLink.hidden = false;
      setMessage("Link request created for " + (result.maskedPhone || "that number") + ". Open WhatsApp to confirm it.", "pending");
      return;
    }
    setMessage("Link request created, but the WhatsApp bot link is unavailable.", "error");
  } catch (err) {
    setMessage(err.message || "Could not create WhatsApp link request.", "error");
  } finally {
    setBusy(false);
  }
});

if (skipButton) skipButton.addEventListener("click", async function() {
  setBusy(true);
  setMessage("Skipping WhatsApp linking...", "loading");
  try {
    await readJson(await fetch("/account/onboarding/whatsapp/skip", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: "{}"
    }));
    window.location.assign(${JSON.stringify(onboardingPath)});
  } catch (err) {
    setMessage(err.message || "Could not skip WhatsApp linking.", "error");
    setBusy(false);
  }
});

if (revokeButton) revokeButton.addEventListener("click", async function() {
  setBusy(true);
  setMessage("");
  try {
    await readJson(await fetch("/account/whatsapp/revoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: "{}"
    }));
    if (phoneInput) phoneInput.value = "";
    setUnlinked();
    setMessage("WhatsApp link revoked.", "complete");
  } catch (err) {
    setMessage(err.message || "Could not revoke WhatsApp link.", "error");
  } finally {
    setBusy(false);
  }
});

if (switchButton) switchButton.addEventListener("click", async function() {
  setBusy(true);
  try {
    await fetch("/auth/session/logout", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: "{}" });
  } catch {}
  try {
    const settings = await fetch("/config/firebase").then(function(response) { return response.json(); });
    if (settings.configured) {
      const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js");
      const { getAuth, signOut } = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js");
      await signOut(getAuth(initializeApp(settings.firebase)));
    }
  } catch {}
  window.location.assign(${JSON.stringify(`/login?next=${encodeURIComponent(pagePath)}`)});
});
`;

  const userLabel = accountStatus?.profile?.displayName
    || accountStatus?.profile?.email
    || verified.name
    || verified.email
    || "Account";
  const whatsappPanel = (
    <section className="panel panel-narrow dashboard-form-panel" aria-labelledby="whatsapp-title">
      <div className="panel-head">
        <div>
          <h1 id="whatsapp-title">{tokenMode ? "Confirm WhatsApp link" : "WhatsApp Linking"}</h1>
          <p>{tokenMode ? "Link the originating WhatsApp chat to this account." : "Link your WhatsApp number to this account."}</p>
        </div>
        <StatusPill data-whatsapp-status kind={statusKind}>{statusLabel}</StatusPill>
      </div>
      <div className="meta">
        <span>Signed in as <strong>{email}</strong></span>
        <span data-whatsapp-copy>{statusCopy}</span>
        {invite ? <span><strong>WhatsApp:</strong> {maskPhone(invite.phone)}</span> : null}
        {invite ? <span><strong>Purpose:</strong> {setupPurposeLabel(invite.purpose)}</span> : null}
      </div>

      {tokenMode ? (
        <form className="actions actions-spaced" data-whatsapp-invite-form>
          <button data-whatsapp-confirm type="submit">Confirm and link</button>
          <button className="secondary" data-switch-account type="button">Use a different Google account</button>
          <a className="button secondary" href={homePath}>Cancel</a>
        </form>
      ) : (
        <>
          <form className="form-stack" data-whatsapp-form hidden={whatsappLinked}>
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
            {chatHandoffUrl ? <a className="button" href={chatHandoffUrl}>Continue in WhatsApp</a> : null}
            {onboardingMode && !chatHandoff ? (
              <button className="secondary" data-whatsapp-skip type="button">Skip for now</button>
            ) : null}
            <a className="button secondary" href="/privacy-policy">Privacy &amp; Policy</a>
          </div>
        </>
      )}
      {chatHandoff ? <p>Google is connected. Continue your Job Scout profile in WhatsApp.</p> : null}
      <StatusNotice data-whatsapp-message />
    </section>
  );

  return (
    <>
      {onboardingMode || tokenMode ? (
        <main className="app-main app-main-center">
          <div className="shell shell-narrow">
            {onboardingMode
              ? <OnboardingProgress backHref={onboardingPath} current={2} total={onboardingTotal} />
              : <a className="toplink" href={homePath}>Back to dashboard</a>}
            {whatsappPanel}
          </div>
        </main>
      ) : (
        <DashboardShell active="settings" publicUserId={publicUserId} userLabel={userLabel}>
          {whatsappPanel}
        </DashboardShell>
      )}
      <script type="module" dangerouslySetInnerHTML={{ __html: whatsappScript }} />
    </>
  );
}
