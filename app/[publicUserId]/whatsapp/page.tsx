import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect, notFound, unstable_rethrow } from "next/navigation";

export const metadata: Metadata = {
  title: "Genaie | WhatsApp",
  description: "Link your WhatsApp number to receive Job Scout notifications and updates.",
};
import { SESSION_COOKIE_NAME } from "@/src/config";
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { syncUserToCentralData, resolvePublicUser, getSignedInAccountStatus, pricingGatePath } from "@/src/domains/users";
import {
  getAccountLinkInvite,
  getSupersededInviteForRecovery,
  bindAccountLinkInviteToUser,
  getWhatsAppLinkForUser,
  whatsappBotLink,
} from "@/src/domains/account-link";
import {
  getOnboardingStatus,
  completeOnboarding,
  scopedPathForOnboardingStep,
} from "@/src/domains/onboarding";
import { scopedPathForAccountLink, whatsappPhoneHash, maskPhone, setupPurposeLabel } from "@/src/lib/utils";
import { decideWhatsAppAutoLink } from "@/src/domains/whatsapp-autolink";
import { OnboardingProgress } from "@/app/_components/onboarding-progress";
import { DashboardShell } from "@/app/_components/dashboard-shell";
import { StatusNotice, StatusPill } from "@/app/_components/status-ui";

export const runtime = "nodejs";

// Resolves where an auto-linked user goes next, mirroring the manual link-request
// route: onboarding-initiated invites advance to their next onboarding step, and a
// chat-channel Job Scout onboarding lands on the wa.me handoff so the user is sent
// straight back to the WhatsApp chat rather than shown a manual "Continue" button.
async function resolveAutoLinkDestination(
  uid: string,
  bindResult: {
    nextPath?: string;
    publicUserId: string | null;
    onboardingService: string | null;
    onboardingChannel: string | null;
  },
): Promise<string> {
  const publicUserId = bindResult.publicUserId;
  if (!publicUserId) return "/";
  if (bindResult.onboardingService && bindResult.onboardingChannel) {
    let onboarding = await getOnboardingStatus(uid);
    if (onboarding.nextStep === "dashboard" && onboarding.onboardingRequired) {
      onboarding = await completeOnboarding(uid);
    }
    if (onboarding.nextStep === "whatsapp_chat") {
      // Only redirect to the trusted wa.me bot link; if it is unavailable fall
      // back to the same-origin onboarding step path.
      try {
        return whatsappBotLink("Continue my Job Scout setup in this chat.");
      } catch {
        // fall through to the scoped onboarding path below
      }
    }
    return scopedPathForOnboardingStep(publicUserId, onboarding.nextStep);
  }
  return scopedPathForAccountLink(bindResult.nextPath || "/", publicUserId);
}

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
    // A token that no longer resolves to a usable invite (expired, already used,
    // superseded, or consumed by an earlier request) throws inside
    // getAccountLinkInvite. Swallow it here so a stale link never crashes the page;
    // the recovery below turns a null invite into a friendly re-link screen.
    tokenMode ? getAccountLinkInvite(token).catch(() => null) : Promise.resolve(null),
    onboardingMode ? getOnboardingStatus(uid).catch(() => null) : Promise.resolve(null),
  ]);
  const homePath = `/${publicUserId}`;
  const onboardingPath = `/${publicUserId}/onboarding`;

  // Recover from an unusable token instead of showing a server-side exception. If
  // the user is in fact already linked the invite simply completed, so send them
  // on; otherwise fall back to the normal linking screen with an "expired" notice.
  let inviteExpiredNotice: string | null = null;
  if (tokenMode && !invite) {
    const existingLink = await getWhatsAppLinkForUser(uid).catch(() => null);
    if (existingLink?.whatsappLinked) {
      redirect(onboardingMode ? onboardingPath : homePath);
    }
    // Recover the common bot-churn case: the token points at a *superseded* invite
    // (a newer invite for the same phone replaced it before the user finished
    // signing in). The phone is unambiguously theirs, so bind it and continue
    // rather than making them re-enter their number. bindAccountLinkInviteToUser
    // keeps the "phone linked to another account" guard.
    const superseded = await getSupersededInviteForRecovery(token).catch(() => null);
    if (superseded) {
      let recoveredDestination: string | null = null;
      try {
        await syncUserToCentralData(uid);
        const bindResult = await bindAccountLinkInviteToUser(token, { uid }, { allowSuperseded: true });
        recoveredDestination = await resolveAutoLinkDestination(uid, bindResult);
      } catch (err) {
        unstable_rethrow(err);
        // Fall through to the recovery notice below.
      }
      if (recoveredDestination) redirect(recoveredDestination);
    }
    inviteExpiredNotice = "This WhatsApp link has expired or was already used. Enter your number below to get a fresh link.";
  }

  // An unusable token behaves like the normal (non-token) linking screen: the
  // confirm/bind flow and the token-mode rendering are gated on a usable invite.
  const activeTokenMode = tokenMode && Boolean(invite);
  if (!activeTokenMode && !accountStatus?.plan) redirect(pricingGatePath(pagePath));

  // Auto-link WhatsApp on first signup. When an invite token is present and the
  // signed-in user has no active phone link yet (or is re-confirming the same
  // number), the number they messaged from is unambiguously theirs, so bind it
  // server-side and continue instead of forcing a manual "Confirm and link"
  // click. A returning user changing their number keeps an explicit confirm step:
  // the different-phone guard in bindAccountLinkInviteToUser rejects the auto-bind
  // and the "Confirm and link" (confirm-to-replace) form is rendered instead.
  let confirmReplacePrompt: string | null = null;
  if (invite) {
    const existingLink = await getWhatsAppLinkForUser(uid).catch(() => null);
    // getWhatsAppLinkForUser truncates the hash to 12 chars, so compare against
    // the invite's hash truncated the same way.
    const inviteHash = String(whatsappPhoneHash(invite.phone)).slice(0, 12);
    const decision = decideWhatsAppAutoLink(existingLink, inviteHash);
    if (decision.kind === "confirm-replace") {
      // Surface the existing bind guard as a confirm-to-replace prompt rather than
      // auto-binding a phone over the user's current link.
      confirmReplacePrompt = "Revoke the current WhatsApp link before linking a new number.";
    } else {
      // No active link (first-time) or the same number is already linked: bind
      // automatically. bindAccountLinkInviteToUser keeps every transaction guard
      // (single-use invite, phone scoped to the invite, reject phone linked
      // elsewhere), so this never silently binds a phone to the wrong account.
      // Sync first, mirroring the manual link-request route, so the central user
      // doc the bind transaction needs is guaranteed present.
      let autoDestination: string | null = null;
      try {
        await syncUserToCentralData(uid);
        const bindResult = await bindAccountLinkInviteToUser(token, { uid });
        autoDestination = await resolveAutoLinkDestination(uid, bindResult);
      } catch (err) {
        // Let Next's redirect()/notFound() control-flow errors propagate untouched.
        unstable_rethrow(err);
        // The invite was consumed/expired between the read above and the bind
        // transaction, or the phone is already linked elsewhere. Recover instead of
        // 500-ing: if the user ended up linked anyway, continue; otherwise surface
        // the bind guidance and re-link screen.
        const existing = await getWhatsAppLinkForUser(uid).catch(() => null);
        if (existing?.whatsappLinked) {
          autoDestination = onboardingMode ? onboardingPath : homePath;
        } else {
          confirmReplacePrompt = (err as Error)?.message
            || "Could not link this WhatsApp number. Request a fresh link and try again.";
        }
      }
      // Keep the redirect outside the try so a successful bind still navigates.
      if (autoDestination) redirect(autoDestination);
    }
  }

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

  // A WhatsApp-initiated onboarding is satisfied once linking is done, so send the
  // user straight back to the WhatsApp chat instead of showing a manual "Continue"
  // button. whatsappBotLink only ever returns the trusted wa.me bot URL, so this
  // cannot become an open redirect. Guarded by !activeTokenMode: the token/confirm flow
  // above owns its own navigation, so this never loops back into a bind.
  if (chatHandoffUrl && !activeTokenMode) {
    redirect(chatHandoffUrl);
  }

  // Once WhatsApp is linked the onboarding step is satisfied, so continue automatically
  // instead of offering a redundant manual button. The invite/token confirm flow and the
  // chat handoff have their own navigation and are excluded.
  if (onboardingMode && !activeTokenMode && !chatHandoff && whatsappLinked) {
    redirect(onboardingPath);
  }

  // In token mode the auto-link above has already redirected first-time / same-number
  // users, so reaching render means the user has an active link on a different number
  // and must confirm replacing it.
  const statusLabel = activeTokenMode ? "Confirm change" : whatsappLinked ? "Linked" : "Not linked";
  const statusKind = activeTokenMode ? "pending" : whatsappLinked ? "complete" : "unlinked";
  const statusCopy = activeTokenMode
    ? `This account is already linked to ${accountStatus?.maskedPhone || "another WhatsApp number"}. Revoke that link before linking this new number.`
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
          <h1 id="whatsapp-title">{activeTokenMode ? "Change WhatsApp number" : "WhatsApp Linking"}</h1>
          <p>{activeTokenMode ? "Confirm replacing the WhatsApp number linked to this account." : "Link your WhatsApp number to this account."}</p>
        </div>
        <StatusPill data-whatsapp-status kind={statusKind}>{statusLabel}</StatusPill>
      </div>
      {inviteExpiredNotice ? (
        <StatusNotice kind="warning" variant="block">{inviteExpiredNotice}</StatusNotice>
      ) : null}
      <div className="meta">
        <span>Signed in as <strong>{email}</strong></span>
        <span data-whatsapp-copy>{statusCopy}</span>
        {invite ? <span><strong>WhatsApp:</strong> {maskPhone(invite.phone)}</span> : null}
        {invite ? <span><strong>Purpose:</strong> {setupPurposeLabel(invite.purpose)}</span> : null}
      </div>

      {activeTokenMode ? (
        <>
          {confirmReplacePrompt ? <p className="notice">{confirmReplacePrompt}</p> : null}
          <form className="actions actions-spaced" data-whatsapp-invite-form>
            <button data-whatsapp-confirm type="submit">Confirm and change number</button>
            <button className="secondary" data-switch-account type="button">Use a different Google account</button>
            <a className="button secondary" href={homePath}>Cancel</a>
          </form>
        </>
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
      {onboardingMode || activeTokenMode ? (
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
