import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { syncUserToCentralData, resolvePublicUser, getSignedInAccountStatus } from "@/src/domains/users";
import { completeOnboarding, getOnboardingStatus, type OnboardingStep } from "@/src/domains/onboarding";

export const runtime = "nodejs";

function onboardingStepPath(publicUserId: string, step: OnboardingStep) {
  if (step === "whatsapp") return `/${publicUserId}/whatsapp?onboarding=1`;
  if (step === "connect_google") return `/${publicUserId}/connect-gmail?onboarding=1`;
  if (step === "job_scout") return `/${publicUserId}/job-scout?onboarding=1`;
  if (step === "vault") return `/${publicUserId}/vault?onboarding=1`;
  return `/${publicUserId}`;
}

export default async function OnboardingPage({ params }: { params: Promise<{ publicUserId: string }> }) {
  const { publicUserId } = await params;
  if (!/^usr_[A-Za-z0-9_-]{16}$/.test(publicUserId)) notFound();

  const onboardingPath = `/${publicUserId}/onboarding`;
  const homePath = `/${publicUserId}`;
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) redirect(`/login?next=${encodeURIComponent(onboardingPath)}`);

  const [verified, routeUser] = await Promise.all([
    verifyFirebaseSessionCookie(sessionCookie).catch(() => null),
    resolvePublicUser(publicUserId).catch(() => null),
  ]);

  if (!verified) redirect(`/login?next=${encodeURIComponent(onboardingPath)}`);
  const uid = verified.uid;
  if (!routeUser) notFound();

  if (uid !== routeUser.id) {
    await syncUserToCentralData(uid);
    const myStatus = await getSignedInAccountStatus(uid).catch(() => null);
    if (myStatus?.publicUserId) redirect(`/${myStatus.publicUserId}/onboarding`);
    redirect("/login");
  }

  const status = await getOnboardingStatus(uid);
  if (status.completed || status.skipped || !status.onboardingRequired) redirect(homePath);
  if (status.nextStep === "dashboard") {
    await completeOnboarding(uid);
    redirect(homePath);
  }
  if (status.nextStep !== "service_selection") redirect(onboardingStepPath(publicUserId, status.nextStep));

  const email = (routeUser as { profile?: { email?: string } }).profile?.email ?? verified.email ?? "signed-in user";

  const onboardingScript = `
const form = document.querySelector("[data-onboarding-form]");
const skipButton = document.querySelector("[data-skip]");
const message = document.querySelector("[data-message]");
const buttons = Array.from(document.querySelectorAll("button"));
const onboardingPath = ${JSON.stringify(onboardingPath)};
const homePath = ${JSON.stringify(homePath)};

function setMessage(text, tone) {
  message.textContent = text || "";
  message.dataset.tone = tone || "info";
}
function setBusy(value) {
  buttons.forEach(function(button) { button.disabled = value; });
}
async function readJson(response) {
  const body = await response.json().catch(function() { return {}; });
  if (!response.ok) throw new Error(body.error || "Request failed with " + response.status);
  return body;
}

form.addEventListener("submit", async function(event) {
  event.preventDefault();
  const submitter = event.submitter;
  const service = submitter && submitter.value;
  if (!service) return;
  setBusy(true);
  setMessage("Saving selection...", "info");
  try {
    await readJson(await fetch("/account/onboarding/select", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ service })
    }));
    window.location.assign(onboardingPath);
  } catch (err) {
    setMessage(err.message || "Could not save onboarding selection.", "error");
    setBusy(false);
  }
});

skipButton.addEventListener("click", async function() {
  setBusy(true);
  setMessage("Skipping onboarding...", "info");
  try {
    await readJson(await fetch("/account/onboarding/skip", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: "{}"
    }));
    window.location.assign(homePath);
  } catch (err) {
    setMessage(err.message || "Could not skip onboarding.", "error");
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
        main{min-height:100vh;padding:28px;display:grid;place-items:center}
        .shell{width:min(840px,100%);display:grid;gap:18px}
        section{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:24px;box-shadow:0 14px 36px rgba(22,28,36,.08);display:grid;gap:18px}
        h1{margin:0 0 8px;font-size:1.9rem;line-height:1.12;letter-spacing:0}
        h2{margin:0;font-size:1.12rem;line-height:1.25;letter-spacing:0}
        p{margin:0;color:var(--muted);line-height:1.5}
        .meta{display:flex;flex-wrap:wrap;gap:10px;align-items:center;color:#303846;border:1px solid var(--border);background:#f8fafc;border-radius:7px;padding:12px 14px}
        form{display:grid;grid-template-columns:1fr 1fr;gap:14px}
        button,a.button{display:inline-flex;min-height:44px;align-items:center;justify-content:center;border:0;border-radius:7px;background:var(--blue);color:#fff;font:inherit;font-weight:750;text-decoration:none;padding:0 16px;cursor:pointer}
        button.choice{min-height:132px;align-items:flex-start;justify-content:flex-start;text-align:left;background:#fff;color:var(--text);border:1px solid var(--border);padding:18px;display:grid;gap:8px}
        button.choice strong{font-size:1.08rem}
        button.choice span{color:var(--muted);font-weight:500;line-height:1.45}
        button.choice:hover:not(:disabled){border-color:#9eb6d6;filter:none;box-shadow:0 12px 28px rgba(22,28,36,.08)}
        button.secondary,a.secondary{background:#eef2f7;color:#263142;border:1px solid #cbd5e1}
        button:disabled{opacity:.55;cursor:not-allowed}
        button:focus-visible,a.button:focus-visible{outline:3px solid rgba(47,116,208,.28);outline-offset:2px}
        button:hover:not(:disabled),a.button:hover{filter:brightness(.94)}
        .actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
        .message{min-height:22px;color:var(--muted);font-size:.95rem;line-height:1.45}
        .message[data-tone="success"]{color:var(--green)}
        .message[data-tone="error"]{color:#9f2419}
        @media (max-width:720px){main{padding:18px}section{padding:18px}form{grid-template-columns:1fr}}
      `}} />
      <main>
        <div className="shell">
          <section aria-labelledby="onboarding-title">
            <div>
              <h1 id="onboarding-title">Choose your setup</h1>
              <p>Select the service you want to configure first.</p>
            </div>
            <div className="meta">Signed in as <strong>{email}</strong></div>
            <form data-onboarding-form>
              <button className="choice" type="submit" name="service" value="jobs">
                <strong>Job Scout</strong>
                <span>Link WhatsApp, connect Google, then prepare your application profile.</span>
              </button>
              <button className="choice" type="submit" name="service" value="webetu">
                <strong>Webetu</strong>
                <span>Link WhatsApp, then save encrypted Webetu credentials for reservations.</span>
              </button>
            </form>
            <div className="actions">
              <button className="secondary" data-skip type="button">Skip onboarding</button>
              <a className="button secondary" href="/privacy-policy">Privacy &amp; Policy</a>
            </div>
            <div className="message" data-message></div>
          </section>
        </div>
      </main>
      <script dangerouslySetInnerHTML={{ __html: onboardingScript }} />
    </>
  );
}
