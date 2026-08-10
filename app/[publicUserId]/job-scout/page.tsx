import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";

export const metadata: Metadata = {
  title: "Genaie | Job Scout",
  description: "Set up and manage your Job Scout profile, preferences, and CV.",
};
import {
  Briefcase,
  FilePlus2,
  FileText,
  Globe,
  Mail,
  MapPin,
  Radar,
  Save,
  UserRound,
} from "lucide-react";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { syncUserToCentralData, resolvePublicUser, getSignedInAccountStatus, pricingGatePath } from "@/src/domains/users";
import { getJobScoutStatusForUser } from "@/src/domains/job-scout";
import { DashboardShell } from "@/app/_components/dashboard-shell";
import { FieldLabel } from "@/app/_components/field-label";
import { OnboardingProgress } from "@/app/_components/onboarding-progress";
import { StatusNotice, StatusPill } from "@/app/_components/status-ui";
import { COUNTRIES } from "@/app/_data/countries";

export const runtime = "nodejs";

function firstValue(value: unknown) {
  return Array.isArray(value) ? String(value[0] ?? "") : "";
}

function missingCopy(missing: unknown, conversionStatus?: unknown) {
  const requirements = Array.isArray(missing)
    ? missing.map(String).filter((item) => item !== "cv_conversion")
    : [];
  const labels: Record<string, string> = {
    phone_link: "WhatsApp link",
    gmail_connection: "Gmail connection",
    sender_email: "sender email",
    cv: "CV",
    target_roles: "target role",
    locations: "target location",
    profile_confirmation: "profile confirmation",
    safety_acknowledgement: "terms acknowledgement",
  };
  if (String(conversionStatus) === "pending") {
    if (requirements.length === 0) return "Your PDF is uploaded and being processed. No action is needed.";
    return `Your PDF is being processed. Missing: ${requirements.map((item) => labels[item] || item).join(", ")}.`;
  }
  if (requirements.length === 0) return "All requirements are complete.";
  return `Missing: ${requirements.map((item) => labels[item] || item).join(", ")}.`;
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
  if (!accountStatus?.plan) redirect(pricingGatePath(setupPath));

  const onboardingPath = `/${publicUserId}/onboarding`;
  const email = (routeUser as { profile?: { email?: string } }).profile?.email ?? verified.email ?? "signed-in user";
  const displayName =
    jobScoutStatus?.profile?.displayName
    ?? (routeUser as { profile?: { displayName?: string } }).profile?.displayName
    ?? verified.name
    ?? "";
  const targetRole = firstValue(jobScoutStatus?.preferences?.targetRoles);
  const targetLocation = firstValue(jobScoutStatus?.preferences?.locations);
  const country = jobScoutStatus?.preferences?.country ?? "zw";
  const countryOptions = COUNTRIES.map((c) => (
    <option key={c.code} value={c.code}>{c.name}</option>
  ));
  const cvAvailable = !!jobScoutStatus?.cvAvailable;
  const cvUploaded = !!jobScoutStatus?.cvUploaded;
  const cvConversionStatus = String(jobScoutStatus?.cvConversionStatus || "missing");
  const ready = !!jobScoutStatus?.ready;
  const autoApply = !!jobScoutStatus?.configured
    && jobScoutStatus?.preferences?.autoApply === true;

  const pageScript = `
const form = document.querySelector("[data-job-scout-form]");
const saveButton = document.querySelector("[data-save]");
const message = document.querySelector("[data-message]");
const readyStatus = document.querySelector("[data-ready-status]");
const cvStatus = document.querySelector("[data-cv-status]");
const missingStatus = document.querySelector("[data-missing]");
const cvInput = document.querySelector("[data-cv]");
const cvName = document.querySelector("[data-cv-name]");
const initialCvConversionPending = ${JSON.stringify(cvConversionStatus === "pending")};
const onboardingMode = ${JSON.stringify(onboardingMode)};
const onboardingPath = ${JSON.stringify(onboardingPath)};
let activeConversionPoll = null;

function maybeAdvanceOnboarding(payload) {
  if (onboardingMode && payload && payload.ready) {
    setMessage("Job Scout setup saved. Continuing onboarding...", "complete");
    window.location.assign(onboardingPath);
    return true;
  }
  return false;
}

const labels = {
  phone_link: "WhatsApp link",
  gmail_connection: "Gmail connection",
  sender_email: "sender email",
  cv: "CV",
  target_roles: "target role",
  locations: "target location",
  profile_confirmation: "profile confirmation",
  safety_acknowledgement: "terms acknowledgement"
};

function setMessage(text, tone) {
  if (!message) return;
  message.querySelector("[data-status-label]").textContent = text || "";
  message.dataset.statusKind = tone || "info";
}
function setPill(el, text, kind) {
  if (!el) return;
  el.querySelector("[data-status-label]").textContent = text;
  el.dataset.statusKind = kind || "info";
}
function missingCopy(missing, conversionStatus) {
  const requirements = Array.isArray(missing)
    ? missing.filter(function(item) { return item !== "cv_conversion"; })
    : [];
  if (conversionStatus === "pending") {
    if (requirements.length === 0) return "Your PDF is uploaded and being processed. No action is needed.";
    return "Your PDF is being processed. Missing: " + requirements.map(function(item) { return labels[item] || item; }).join(", ") + ".";
  }
  if (requirements.length === 0) return "All requirements are complete.";
  return "Missing: " + requirements.map(function(item) { return labels[item] || item; }).join(", ") + ".";
}
async function readJson(response) {
  const body = await response.json().catch(function() { return {}; });
  if (!response.ok) throw new Error(body.error || "Request failed with " + response.status);
  return body;
}
function applyStatus(payload) {
  setPill(readyStatus, payload.ready ? "Ready" : "Processing", payload.ready ? "complete" : "pending");
  setPill(
    cvStatus,
    payload.cvAvailable ? "CV: Ready" : payload.cvConversionStatus === "pending" ? "CV: Processing" : "CV: Missing",
    payload.cvAvailable ? "complete" : "pending"
  );
  if (missingStatus) {
    missingStatus.querySelector("[data-status-label]").textContent = missingCopy(
      payload.missingRequirements,
      payload.cvConversionStatus
    );
    missingStatus.dataset.statusKind = payload.ready ? "complete" : payload.cvConversionStatus === "pending" ? "info" : "warning";
  }
}
function sleep(ms) {
  return new Promise(function(resolve) { window.setTimeout(resolve, ms); });
}
function waitForCvConversion(initialStatus) {
  if (activeConversionPoll) return activeConversionPoll;
  activeConversionPoll = (async function() {
    let status = initialStatus;
    for (let attempt = 0; attempt < 30 && status.cvConversionStatus === "pending"; attempt += 1) {
      await sleep(2000);
      status = await readJson(await fetch("/job-scout/profile/status", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store"
      }));
      applyStatus(status);
      if (status.ready) return status;
    }
    return status;
  })().finally(function() {
    activeConversionPoll = null;
  });
  return activeConversionPoll;
}

if (cvInput) {
  cvInput.addEventListener("change", function() {
    const file = cvInput.files && cvInput.files[0];
    if (cvName) cvName.textContent = file ? file.name : "No new file selected";
    if (typeof window.__jobScoutWizardCvChanged === "function") window.__jobScoutWizardCvChanged();
  });
}

if (form) {
  form.addEventListener("submit", async function(event) {
    event.preventDefault();
    saveButton.disabled = true;
    setMessage("Saving Job Scout setup...", "loading");
    try {
      let payload = await readJson(await fetch("/job-scout/profile", {
        method: "POST",
        credentials: "same-origin",
        body: new FormData(form)
      }));
      applyStatus(payload);
      if (payload.cvConversionStatus === "pending") {
        setMessage("PDF uploaded. Preparing it for Job Scout...", "loading");
        payload = await waitForCvConversion(payload);
      }
      if (maybeAdvanceOnboarding(payload)) return;
      setMessage(
        payload.ready
          ? "Job Scout setup saved and ready."
          : payload.cvConversionStatus === "pending"
            ? "Setup saved. Your PDF is still being processed; you can leave this page."
            : "Setup saved, but requirements are still missing.",
        payload.ready ? "complete" : payload.cvConversionStatus === "pending" ? "info" : "warning"
      );
      if (cvInput) cvInput.value = "";
      if (cvName) cvName.textContent = "No new file selected";
    } catch (err) {
      setMessage(err.message || "Could not save Job Scout setup.", "error");
    } finally {
      saveButton.disabled = false;
    }
  });
}

if (initialCvConversionPending) {
  setMessage("Your uploaded PDF is being prepared for Job Scout...", "loading");
  waitForCvConversion({ cvConversionStatus: "pending" }).then(function(payload) {
    if (maybeAdvanceOnboarding(payload)) return;
    setMessage(
      payload.ready
        ? "Your CV is ready."
        : "Your PDF is still being processed; you can leave this page.",
      payload.ready ? "complete" : "info"
    );
  }).catch(function() {
    setMessage("Your PDF is uploaded and will continue processing in the background.", "info");
  });
}

// Multi-step onboarding wizard. Only active when the stepped layout is rendered.
const wizard = document.querySelector("[data-wizard]");
if (wizard) {
  const steps = Array.prototype.slice.call(wizard.querySelectorAll("[data-step]"));
  const total = steps.length;
  const backBtn = wizard.querySelector("[data-back]");
  const nextBtn = wizard.querySelector("[data-next]");
  const hint = wizard.querySelector("[data-step-hint]");
  const roleInput = wizard.querySelector("[name='targetRole']");
  const locationInput = wizard.querySelector("[name='targetLocation']");
  const countryInput = wizard.querySelector("[name='country']");
  const reviewRole = wizard.querySelector("[data-review-role]");
  const reviewLocation = wizard.querySelector("[data-review-location]");
  const reviewCountry = wizard.querySelector("[data-review-country]");
  let current = 1;

  function setHint(text) {
    if (!hint) return;
    hint.textContent = text || "";
    hint.hidden = !text;
  }

  function validateStep(n) {
    if (n === 1) {
      if (!roleInput || !roleInput.value.trim()) { setHint("Enter the role you want Job Scout to target."); return false; }
      if (!locationInput || !locationInput.value.trim()) { setHint("Enter a target location."); return false; }
      if (!countryInput || !/^[A-Za-z]{2}$/.test(countryInput.value.trim())) { setHint("Enter a two-letter country code (e.g. zw)."); return false; }
      return true;
    }
    return true;
  }

  function fillReview() {
    if (reviewRole && roleInput) reviewRole.textContent = roleInput.value.trim() || "—";
    if (reviewLocation && locationInput) reviewLocation.textContent = locationInput.value.trim() || "—";
    if (reviewCountry && countryInput) {
      const selected = countryInput.selectedOptions && countryInput.selectedOptions[0];
      reviewCountry.textContent = (selected ? selected.text : countryInput.value.trim().toUpperCase()) || "—";
    }
  }

  function render() {
    steps.forEach(function(step) { step.hidden = Number(step.dataset.step) !== current; });
    if (backBtn) backBtn.hidden = current === 1;
    if (nextBtn) nextBtn.hidden = current === total;
    if (saveButton) saveButton.hidden = current !== total;
    if (current === total) fillReview();
    setHint("");
  }

  if (nextBtn) nextBtn.addEventListener("click", function() {
    if (!validateStep(current)) return;
    if (current < total) { current += 1; render(); }
  });
  if (backBtn) backBtn.addEventListener("click", function() {
    if (current > 1) { current -= 1; render(); }
  });

  render();
}
`;

  const userLabel = displayName || email;

  const dashboardPanel = (
    <section className="panel dashboard-form-panel" aria-labelledby="job-scout-title">
      <div className="panel-head">
        <div className="panel-head-title">
          <span className="panel-head-icon"><Radar aria-hidden="true" /></span>
          <div>
            <h1 id="job-scout-title">Job Scout Setup</h1>
            <p>Complete the profile Job Scout uses for applications.</p>
          </div>
        </div>
        <StatusPill data-ready-status kind={ready ? "complete" : "pending"}>{ready ? "Ready" : cvConversionStatus === "pending" ? "Processing" : "Draft"}</StatusPill>
      </div>
      <div className="status-row" aria-label="Job Scout requirements">
        <StatusPill data-cv-status kind={cvAvailable ? "complete" : "pending"}>
          {cvAvailable ? "CV: Ready" : cvConversionStatus === "pending" ? "CV: Processing" : "CV: Missing"}
        </StatusPill>
      </div>
      <StatusNotice className="missing" data-missing kind={ready ? "complete" : cvConversionStatus === "pending" ? "info" : "warning"}>
        {missingCopy(jobScoutStatus?.missingRequirements, cvConversionStatus)}
      </StatusNotice>
      <form className="form-stack" data-job-scout-form>
        <div className="grid">
          <label>
            <FieldLabel icon={UserRound}>Display name</FieldLabel>
            <input name="displayName" defaultValue={displayName} maxLength={120} autoComplete="name" required />
          </label>
          <div className="readonly">
            <FieldLabel icon={Mail}>Email</FieldLabel>
            <span>{email}</span>
          </div>
        </div>
        <label>
          <FieldLabel icon={FileText}>CV PDF</FieldLabel>
          <input data-cv name="cv" type="file" accept="application/pdf,.pdf" />
          <span className="file-note">
            {cvAvailable
              ? "Your CV is ready. Choose a new PDF only if you want to replace it."
              : cvUploaded
                ? "Your PDF is uploaded and being processed. Upload another PDF only to replace it."
                : "Upload a PDF CV, max 4 MB. Job Scout prepares it automatically for applications."}
          </span>
          <span className="file-note" data-cv-name>No new file selected</span>
        </label>
        <div className="actions">
          <span className="file-note">No PDF? Build one by filling in your details instead.</span>
          <a className="button secondary" href={`/${publicUserId}/create-cv`}>
            <FilePlus2 aria-hidden="true" />
            Create CV
          </a>
        </div>
        <div className="grid">
          <label>
            <FieldLabel icon={Briefcase}>Target role</FieldLabel>
            <input name="targetRole" defaultValue={targetRole} maxLength={200} required />
          </label>
          <label>
            <FieldLabel icon={MapPin}>Target location</FieldLabel>
            <input name="targetLocation" defaultValue={targetLocation} maxLength={200} required />
          </label>
        </div>
        <label>
          <FieldLabel icon={Globe}>Country</FieldLabel>
          <select name="country" defaultValue={country} required>
            {countryOptions}
          </select>
        </label>
        <label className="check">
          <input name="profileConfirmed" type="checkbox" defaultChecked={!!jobScoutStatus?.profileConfirmed} required />
          <span>I have read and agree to the <a href="/terms-of-service" target="_blank" rel="noopener noreferrer">Terms of Service</a>.</span>
        </label>
        <label className="check">
          <input name="safetyAcknowledged" type="checkbox" defaultChecked={!!jobScoutStatus?.safetyAcknowledged} required />
          <span>I will not pay upfront, I understand job scams exist, and Genaie is not accountable if I am scammed.</span>
        </label>
        <label className="check">
          <input name="autoApply" type="checkbox" defaultChecked={autoApply} />
          <span>Automatically submit suitable applications for me. Leave this off if you only want suggestions.</span>
        </label>
        <div className="actions">
          <button data-save type="submit">
            <Save aria-hidden="true" />
            Save Job Scout setup
          </button>
        </div>
      </form>
      <StatusNotice data-message />
    </section>
  );

  const onboardingPanel = (
    <section className="panel dashboard-form-panel" aria-label="Job Scout setup">
      <form className="form-stack" data-job-scout-form data-wizard>
        <section className="wizard-step" data-step="1">
          <div className="wizard-step-heading">
            <h2>What are you looking for?</h2>
            <p>Job Scout searches for openings that match these details.</p>
          </div>
          <label>
            <FieldLabel icon={Briefcase}>Target role</FieldLabel>
            <input name="targetRole" defaultValue={targetRole} maxLength={200} placeholder="e.g. Software Engineer" />
          </label>
          <label>
            <FieldLabel icon={MapPin}>Target location</FieldLabel>
            <input name="targetLocation" defaultValue={targetLocation} maxLength={200} placeholder="e.g. Harare" />
          </label>
          <label>
            <FieldLabel icon={Globe}>Country</FieldLabel>
            <select name="country" defaultValue={country} required>
              {countryOptions}
            </select>
            <span className="file-note">Select the country where you want Job Scout to search.</span>
          </label>
        </section>

        <section className="wizard-step" data-step="2" hidden>
          <div className="wizard-step-heading">
            <h2>Review &amp; confirm</h2>
            <p>Check your details and agree to the terms before Job Scout starts.</p>
          </div>
          <div className="wizard-summary" data-review-summary>
            <div><span>Target role</span><strong data-review-role>—</strong></div>
            <div><span>Target location</span><strong data-review-location>—</strong></div>
            <div><span>Country</span><strong data-review-country>—</strong></div>
          </div>
          <label>
            <FieldLabel icon={UserRound}>Display name</FieldLabel>
            <input name="displayName" defaultValue={displayName} maxLength={120} autoComplete="name" required />
          </label>
          <label className="check">
            <input name="profileConfirmed" type="checkbox" defaultChecked={!!jobScoutStatus?.profileConfirmed} required />
            <span>I have read and agree to the <a href="/terms-of-service" target="_blank" rel="noopener noreferrer">Terms of Service</a>.</span>
          </label>
          <label className="check">
            <input name="safetyAcknowledged" type="checkbox" defaultChecked={!!jobScoutStatus?.safetyAcknowledged} required />
            <span>I will not pay upfront, I understand job scams exist, and Genaie is not accountable if I am scammed.</span>
          </label>
        </section>

        <p className="file-note wizard-hint" data-step-hint hidden />

        <div className="actions wizard-nav">
          <button type="button" className="button secondary" data-back hidden>Back</button>
          <button type="button" data-next>Next</button>
          <button data-save type="submit" hidden>
            <Save aria-hidden="true" />
            Save Job Scout setup
          </button>
        </div>
      </form>
      <StatusNotice data-message />
    </section>
  );

  return (
    <>
      {onboardingMode ? (
        <main className="app-main app-main-center">
          <div className="shell">
            <OnboardingProgress backHref={onboardingPath} current={2} total={2} />
            {onboardingPanel}
          </div>
        </main>
      ) : (
        <DashboardShell active="job-scout" publicUserId={publicUserId} userLabel={userLabel}>
          {dashboardPanel}
        </DashboardShell>
      )}
      <script dangerouslySetInnerHTML={{ __html: pageScript }} />
    </>
  );
}
