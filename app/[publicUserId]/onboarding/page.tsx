import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { syncUserToCentralData, resolvePublicUser, getSignedInAccountStatus } from "@/src/domains/users";
import { completeOnboarding, getOnboardingStatus, type OnboardingStep } from "@/src/domains/onboarding";
import { OnboardingProgress } from "@/app/_components/onboarding-progress";

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
      <main className="app-main app-main-center">
        <div className="shell">
          <OnboardingProgress backHref={homePath} current={1} total={4} />
          <section className="panel" aria-labelledby="onboarding-title">
            <div>
              <h1 id="onboarding-title">Choose your setup</h1>
              <p>Select the service you want to configure first.</p>
            </div>
            <div className="meta">Signed in as <strong>{email}</strong></div>
            <form className="choice-grid" data-onboarding-form>
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
