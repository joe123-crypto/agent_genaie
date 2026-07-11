import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { verifyFirebaseSessionCookie } from "@/src/security/session";
import { syncUserToCentralData, resolvePublicUser, getSignedInAccountStatus } from "@/src/domains/users";
import { getJobScoutStatusForUser } from "@/src/domains/job-scout";

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

export default async function JobScoutSetupPage({ params }: { params: Promise<{ publicUserId: string }> }) {
  const { publicUserId } = await params;

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
  const connectPath = `${homePath}/connect-gmail`;
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
  message.textContent = text || "";
  message.dataset.tone = tone || "info";
}
function setPill(el, text, tone) {
  el.textContent = text;
  el.dataset.tone = tone || "info";
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
  setMessage("Saving Job Scout setup...", "info");
  try {
    const payload = await readJson(await fetch("/job-scout/profile", {
      method: "POST",
      credentials: "same-origin",
      body: new FormData(form)
    }));
    setPill(readyStatus, payload.ready ? "Ready" : "Draft", payload.ready ? "success" : "error");
    setPill(cvStatus, payload.cvAvailable ? "CV: Uploaded" : "CV: Missing", payload.cvAvailable ? "success" : "error");
    missingStatus.textContent = missingCopy(payload.missingRequirements);
    setMessage(payload.ready ? "Job Scout setup saved and ready." : "Setup saved, but requirements are still missing.", payload.ready ? "success" : "error");
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
      <style dangerouslySetInnerHTML={{ __html: `
        :root{color-scheme:light;--bg:#f6f7f9;--panel:#fff;--border:#d8dee7;--text:#15171a;--muted:#5f6875;--blue:#2f74d0;--green:#11603a;--red:#b42318}
        *{box-sizing:border-box}
        body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--text)}
        main{min-height:100vh;padding:28px}
        .shell{width:min(860px,100%);margin:0 auto;display:grid;gap:18px}
        .panel{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:22px;box-shadow:0 14px 36px rgba(22,28,36,.08);display:grid;gap:16px}
        .panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
        h1{margin:0;font-size:1.85rem;line-height:1.15;letter-spacing:0}
        p{margin:0;color:var(--muted);line-height:1.5}
        form{display:grid;gap:14px}
        label{display:grid;gap:7px;font-weight:750;color:#303846}
        input{width:100%;min-height:44px;border:1px solid #b9c3d1;border-radius:7px;padding:0 12px;font:inherit;background:#fff;color:var(--text)}
        input[type="file"]{padding:9px 12px}
        input[type="checkbox"]{width:18px;min-height:18px;accent-color:var(--blue)}
        input:focus{outline:3px solid rgba(47,116,208,.18);border-color:var(--blue)}
        .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
        .status-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
        .status-pill{display:inline-flex;align-items:center;min-height:30px;border-radius:999px;border:1px solid #cbd5e1;background:#f8fafc;color:#303846;padding:0 10px;font-size:.88rem;font-weight:800;white-space:nowrap}
        .status-pill[data-tone="success"]{border-color:#7fc9a2;background:#eefaf3;color:var(--green)}
        .status-pill[data-tone="error"]{border-color:#f1a7a1;background:#fff1f0;color:#9f2419}
        .status-pill[data-tone="info"]{border-color:#cbd5e1;background:#f8fafc;color:#303846}
        .readonly{display:grid;gap:7px;color:#303846;font-weight:750}
        .readonly span{display:flex;align-items:center;min-height:44px;border:1px solid #d8dee7;border-radius:7px;background:#f8fafc;padding:0 12px;color:var(--muted);font-weight:500}
        .check{display:flex;align-items:flex-start;gap:10px;font-weight:650;line-height:1.45}
        .check span{color:#303846}
        .file-note{font-size:.92rem;color:var(--muted);font-weight:500}
        .actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
        button,a.button{display:inline-flex;min-height:42px;align-items:center;justify-content:center;border:0;border-radius:7px;background:var(--blue);color:#fff;font:inherit;font-weight:750;text-decoration:none;padding:0 14px;cursor:pointer}
        button.secondary,a.secondary{background:#eef2f7;color:#263142;border:1px solid #cbd5e1}
        button:disabled{opacity:.55;cursor:not-allowed}
        button:hover:not(:disabled),a.button:hover{filter:brightness(.94)}
        button:focus-visible,a.button:focus-visible,input:focus-visible{outline:3px solid rgba(47,116,208,.28);outline-offset:2px}
        .message{min-height:22px;color:var(--muted);font-size:.95rem;line-height:1.45}
        .message[data-tone="success"]{color:var(--green)}
        .message[data-tone="error"]{color:#9f2419}
        .missing{color:var(--muted);font-size:.95rem}
        @media (max-width:720px){main{padding:18px}.panel{padding:18px}.panel-head{flex-direction:column}.grid{grid-template-columns:1fr}}
      `}} />
      <main>
        <div className="shell">
          <a className="button secondary" href={homePath}>Back to dashboard</a>
          <section className="panel" aria-labelledby="job-scout-title">
            <div className="panel-head">
              <div>
                <h1 id="job-scout-title">Job Scout Setup</h1>
                <p>Complete the profile Job Scout uses for applications.</p>
              </div>
              <span className="status-pill" data-ready-status data-tone={ready ? "success" : "error"}>{ready ? "Ready" : "Draft"}</span>
            </div>
            <div className="status-row" aria-label="Job Scout requirements">
              <span className="status-pill" data-tone={whatsappLinked ? "success" : "error"}>{whatsappLinked ? "WhatsApp: Linked" : "WhatsApp: Not linked"}</span>
              <span className="status-pill" data-tone={googleConnected ? "success" : "error"}>{googleConnected ? "Google: Connected" : "Google: Not connected"}</span>
              <span className="status-pill" data-cv-status data-tone={cvAvailable ? "success" : "error"}>{cvAvailable ? "CV: Uploaded" : "CV: Missing"}</span>
            </div>
            <p className="missing" data-missing>{missingCopy(jobScoutStatus?.missingRequirements)}</p>
            <form data-job-scout-form>
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
                <span>I confirm these profile details and job preferences are accurate.</span>
              </label>
              <label className="check">
                <input name="safetyAcknowledged" type="checkbox" defaultChecked={!!jobScoutStatus?.safetyAcknowledged} required />
                <span>I agree that I will not pay money upfront to anyone, I understand scammers may target job seekers, and I acknowledge Genaie is not accountable if I am scammed.</span>
              </label>
              <div className="actions">
                <button data-save type="submit">Save Job Scout setup</button>
                <a className="button secondary" href={connectPath}>Connect Google</a>
                <a className="button secondary" href="/privacy-policy">Privacy &amp; Policy</a>
              </div>
            </form>
            <div className="message" data-message></div>
          </section>
        </div>
      </main>
      <script dangerouslySetInnerHTML={{ __html: pageScript }} />
    </>
  );
}
