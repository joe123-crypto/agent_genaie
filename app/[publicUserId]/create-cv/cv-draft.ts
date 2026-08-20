import type { EducationRow, ExperienceRow, RefereeRow } from "./create-cv-form";

// A CV built in the chat interview is handed to the /create-cv form page for
// review through sessionStorage rather than the URL: the payload (multiple
// experience/education/referee rows) is far too large for a query string.
export type CvDraft = {
  fullName: string;
  email: string;
  phone: string;
  location: string;
  summary: string;
  skills: string;
  experience: ExperienceRow[];
  education: EducationRow[];
  referees: RefereeRow[];
  // Selected CV template id. Optional so drafts written before this field
  // existed still load; the form falls back to the default template.
  template?: string;
};

const CV_DRAFT_STORAGE_KEY = "genaie:cv-draft";

// sessionStorage can throw (privacy mode, disabled storage). Every access is
// guarded so a storage failure downgrades to an empty form instead of crashing
// the handoff — the same defensive pattern used in app/login/login-content.tsx.
export function saveCvDraft(draft: CvDraft): void {
  try {
    sessionStorage.setItem(CV_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Storage unavailable: the form simply opens empty; the user can re-enter.
  }
}

export function loadCvDraft(): CvDraft | null {
  try {
    const raw = sessionStorage.getItem(CV_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CvDraft> | null;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      fullName: typeof parsed.fullName === "string" ? parsed.fullName : "",
      email: typeof parsed.email === "string" ? parsed.email : "",
      phone: typeof parsed.phone === "string" ? parsed.phone : "",
      location: typeof parsed.location === "string" ? parsed.location : "",
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      skills: typeof parsed.skills === "string" ? parsed.skills : "",
      experience: Array.isArray(parsed.experience) ? parsed.experience : [],
      education: Array.isArray(parsed.education) ? parsed.education : [],
      referees: Array.isArray(parsed.referees) ? parsed.referees : [],
      template: typeof parsed.template === "string" ? parsed.template : undefined,
    };
  } catch {
    return null;
  }
}

export function clearCvDraft(): void {
  try {
    sessionStorage.removeItem(CV_DRAFT_STORAGE_KEY);
  } catch {
    // Nothing to do — a stale draft is guarded by the ?from=interview param.
  }
}
