import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { syncUserToCentralData, resolvePublicUser, getSignedInAccountStatus } from "@/src/domains/users";
import { getJobScoutStatusForUser } from "@/src/domains/job-scout";
import { OnboardingProgress } from "@/app/_components/onboarding-progress";
import { StatusNotice, StatusPill } from "@/app/_components/status-ui";

export const runtime = "nodejs";

function firstValue(value: unknown) {
  return Array.isArray(value) ? String(value[0] ?? "") : "";
}

function missingCopy(missing: unknown) {
  if (!Array.isArray(missing) || missing.length === 0) return "All requirements are complete.";
  const labels: Record<string, string> = {
    phone_link: "WhatsApp link",
    gmail_connection: "Google connection",
    sender_email: "sender email",
    cv: "CV",
    target_roles: "target role",
    locations: "target location",
    profile_confirmation: "profile confirmation",
    safety_acknowledgement: "terms acknowledgement",
  };
  return `Missing: ${missing.map((item) => labels[String(item)] || String(item)).join(", ")}.`;
}

export default async function JobScoutSetupPage({
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
  const setupPath = `/${publicUserId}/job-scout`;

  if (!sessionCookie) redirect(`/login?next=${encodeURIComponent(setupPath)}`);

  const [verified, routeUser] = await Promise.all([
    verifyFirebaseSessionCookie(sessionCookie).catch(() => null),
    resolvePublicUser(publicUserId).catch(() => null),
  ]);

  if (!verified) redirect(`/login?next=${encodeURIComponent(setupPath)}`);
  const uid = verified.uid;

  if (!routeUser) notFound();

  if (uid !== routeUser.id) {
    await syncUserToCentralData(uid);
    const myStatus = await getSignedInAccountStatus(uid).catch(() => null);
    if (myStatus?.publicUserId) redirect(`/${myStatus.publicUserId}/job-scout`);
    redirect("/login");
  }

  await syncUserToCentralData(uid);
  const [accountStatus, jobScoutStatus] = await Promise.all([
    getSignedInAccountStatus(uid).catch(() => null),
    getJobScoutStatusForUser(uid).catch(() => null),
  ]);

  const homePath = `/${publicUserId}`;
  const onboardingPath = `/${publicUserId}/onboarding`;
  const connectPath = `${homePath}/connect-gmail${onboardingMode ? "?onboarding=1" : ""}`;
  const email = (routeUser as { profile?: { email?: string } }).profile?.email ?? verified.email ?? "signed-in user";
  const displayName =
    jobScoutStatus?.profile?.displayName
    ?? (routeUser as { profile?: { displayName?: string } }).profile?.displayName
    ?? verified.name
    ?? "";
  const targetRole = firstValue(jobScoutStatus?.preferences?.targetRoles);
  const targetLocation = firstValue(jobScoutStatus?.preferences?.locations);
  const country = jobScoutStatus?.preferences?.country ?? "dz";
  const whatsappLinked = !!accountStatus?.whatsappLinked;
  const googleConnected = !!jobScoutStatus?.gmailConnected;
  const cvAvailable = !!jobScoutStatus?.cvAvailable;
  const ready = !!jobScoutStatus?.ready;

  const pageScript = `
const form = document.querySelector("[data-job-scout-form]");
const saveButton = document.querySelector("[data-save]");
const message = document.querySelector("[data-message]");
const readyStatus = document.querySelector("[data-ready-status]");
const cvStatus = document.querySelector("[data-cv-status]");
const missingStatus = document.querySelector("[data-missing]");
const cvInput = document.querySelector("[data-cv]");
const cvName = document.querySelector("[data-cv-name]");

const labels = {
  phone_link: "WhatsApp link",
  gmail_connection: "Google connection",
  sender_email: "sender email",
  cv: "CV",
  target_roles: "target role",
  locations: "target location",
  profile_confirmation: "profile confirmation",
  safety_acknowledgement: "terms acknowledgement"
};

function setMessage(text, tone) {
  message.querySelector("[data-status-label]").textContent = text || "";
  message.dataset.statusKind = tone || "info";
}
function setPill(el, text, kind) {
  el.querySelector("[data-status-label]").textContent = text;
  el.dataset.statusKind = kind || "info";
}
function missingCopy(missing) {
  if (!Array.isArray(missing) || missing.length === 0) return "All requirements are complete.";
  return "Missing: " + missing.map(function(item) { return labels[item] || item; }).join(", ") + ".";
}
async function readJson(response) {
  const body = await response.json().catch(function() { return {}; });
  if (!response.ok) throw new Error(body.error || "Request failed with " + response.status);
  return body;
}

cvInput.addEventListener("change", function() {
  const file = cvInput.files && cvInput.files[0];
  cvName.textContent = file ? file.name : "No new file selected";
});

form.addEventListener("submit", async function(event) {
  event.preventDefault();
  saveButton.disabled = true;
  setMessage("Saving Job Scout setup...", "loading");
  try {
    const payload = await readJson(await fetch("/job-scout/profile", {
      method: "POST",
      credentials: "same-origin",
      body: new FormData(form)
    }));
    setPill(readyStatus, payload.ready ? "Ready" : "Draft", payload.ready ? "complete" : "pending");
    setPill(cvStatus, payload.cvAvailable ? "CV: Uploaded" : "CV: Missing", payload.cvAvailable ? "complete" : "pending");
    missingStatus.querySelector("[data-status-label]").textContent = missingCopy(payload.missingRequirements);
    missingStatus.dataset.statusKind = payload.ready ? "complete" : "warning";
    setMessage(payload.ready ? "Job Scout setup saved and ready." : "Setup saved, but requirements are still missing.", payload.ready ? "complete" : "warning");
    cvInput.value = "";
    cvName.textContent = "No new file selected";
  } catch (err) {
    setMessage(err.message || "Could not save Job Scout setup.", "error");
  } finally {
    saveButton.disabled = false;
  }
});
`;

  return (
    <>
      <main className="app-main app-main-center">
        <div className="shell">
          {onboardingMode ? <OnboardingProgress backHref={onboardingPath} current={4} total={4} /> : <a className="toplink" href={homePath}>Back to dashboard</a>}
          <section className="panel" aria-labelledby="job-scout-title">
            <div className="panel-head">
              <div>
                <h1 id="job-scout-title">Job Scout Setup</h1>
                <p>Complete the profile Job Scout uses for applications.</p>
              </div>
              <StatusPill data-ready-status kind={ready ? "complete" : "pending"}>{ready ? "Ready" : "Draft"}</StatusPill>
            </div>
            <div className="status-row" aria-label="Job Scout requirements">
              <StatusPill kind={whatsappLinked ? "complete" : "unlinked"}>{whatsappLinked ? "WhatsApp: Linked" : "WhatsApp: Not linked"}</StatusPill>
              <StatusPill kind={googleConnected ? "complete" : "unlinked"}>{googleConnected ? "Google: Connected" : "Google: Not connected"}</StatusPill>
              <StatusPill data-cv-status kind={cvAvailable ? "complete" : "pending"}>{cvAvailable ? "CV: Uploaded" : "CV: Missing"}</StatusPill>
            </div>
            <StatusNotice className="missing" data-missing kind={ready ? "complete" : "warning"}>{missingCopy(jobScoutStatus?.missingRequirements)}</StatusNotice>
            <form className="form-stack" data-job-scout-form>
              <div className="grid">
                <label>
                  Display name
                  <input name="displayName" defaultValue={displayName} maxLength={120} autoComplete="name" required />
                </label>
                <div className="readonly">
                  Email
                  <span>{email}</span>
                </div>
              </div>
              <label>
                CV PDF
                <input data-cv name="cv" type="file" accept="application/pdf,.pdf" />
                <span className="file-note">{cvAvailable ? "A CV is already uploaded. Choose a new PDF to replace it." : "Upload a PDF CV, max 4 MB."}</span>
                <span className="file-note" data-cv-name>No new file selected</span>
              </label>
              <div className="grid">
                <label>
                  Target role
                  <input name="targetRole" defaultValue={targetRole} maxLength={200} required />
                </label>
                <label>
                  Target location
                  <input name="targetLocation" defaultValue={targetLocation} maxLength={200} required />
                </label>
              </div>
              <label>
                Country code
                <input name="country" defaultValue={country} minLength={2} maxLength={2} pattern="[A-Za-z]{2}" required />
              </label>
              <label className="check">
                <input name="profileConfirmed" type="checkbox" defaultChecked={!!jobScoutStatus?.profileConfirmed} required />
                <span>I confirm my profile and job preferences are accurate.</span>
              </label>
              <label className="check">
                <input name="safetyAcknowledged" type="checkbox" defaultChecked={!!jobScoutStatus?.safetyAcknowledged} required />
                <span>I will not pay upfront, I understand job scams exist, and Genaie is not accountable if I am scammed.</span>
              </label>
              <div className="actions">
                <button data-save type="submit">Save Job Scout setup</button>
                <a className="button secondary" href={connectPath}>Connect Google</a>
                {onboardingMode ? <a className="button secondary" href={onboardingPath}>Continue onboarding</a> : null}
                <a className="button secondary" href="/privacy-policy">Privacy &amp; Policy</a>
              </div>
            </form>
            <StatusNotice data-message />
          </section>
        </div>
      </main>
      <script dangerouslySetInnerHTML={{ __html: pageScript }} />
    </>
  );
}
