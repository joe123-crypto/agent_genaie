"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlignLeft,
  Briefcase,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  GraduationCap,
  LayoutTemplate,
  Mail,
  MapPin,
  Phone,
  Plus,
  ScrollText,
  SquarePen,
  Tags,
  Trash2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { FieldLabel } from "@/app/_components/field-label";
import { StatusNotice, type StatusKind } from "@/app/_components/status-ui";
import { CV_TEMPLATES, DEFAULT_TEMPLATE_ID, renderCvHtml } from "@/src/domains/cv-templates";
import { clearCvDraft, loadCvDraft, saveCvDraft, type CvDraft } from "./cv-draft";

export type ExperienceRow = {
  title: string;
  company: string;
  start: string;
  end: string;
  description: string;
};

export type EducationRow = {
  degree: string;
  institution: string;
  start: string;
  end: string;
  description: string;
};

export type RefereeRow = {
  name: string;
  position: string;
  company: string;
  email: string;
  phone: string;
};

function emptyExperience(): ExperienceRow {
  return { title: "", company: "", start: "", end: "", description: "" };
}

function emptyEducation(): EducationRow {
  return { degree: "", institution: "", start: "", end: "", description: "" };
}

function emptyReferee(): RefereeRow {
  return { name: "", position: "", company: "", email: "", phone: "" };
}

type CreateCvFormProps = {
  jobScoutPath: string;
  // Where to go after the CV is saved. Points to pricing for a planless user
  // (plan selection is the final step of the flow) or straight to Job Scout
  // setup for someone who already has a plan. Defaults to jobScoutPath so the
  // plain form path is unaffected.
  successPath?: string;
  // When true (the chat interview handoff), hydrate the form from the CV draft
  // stashed in sessionStorage on mount. The draft is NOT cleared on hydrate so it
  // survives the anonymous-form → login → scoped-form chain; it is cleared only
  // after a successful immediate save.
  hydrateDraft?: boolean;
  // "immediate" (default): POST the CV to the account and continue to successPath.
  // "deferred": the visitor isn't signed in yet — stash the CV to the session draft
  // and send them straight to payment (no account save happens on this path).
  saveMode?: "immediate" | "deferred";
  // Post-login: when the scoped form loads with a hydrated draft, submit it once
  // automatically so the user doesn't have to click "Create CV" a second time.
  autoSave?: boolean;
  defaultFullName?: string;
  defaultEmail?: string;
  // Optional pre-filled values. The AI interview (see cv-interview.tsx) uses
  // these to hand its extracted data to this form for review before saving.
  // Each defaults to the form's normal empty state so the plain form path is
  // unaffected.
  initialPhone?: string;
  initialLocation?: string;
  initialSummary?: string;
  initialSkills?: string;
  initialExperience?: ExperienceRow[];
  initialEducation?: EducationRow[];
  initialReferees?: RefereeRow[];
};

// Fall back to a single blank row (the form's normal starting state) when the
// caller supplies no rows, so "Remove" stays hidden until the user adds a second.
function withFallback<T>(rows: T[] | undefined, empty: () => T): T[] {
  return rows && rows.length > 0 ? rows : [empty()];
}

export function CreateCvForm({
  jobScoutPath,
  successPath = jobScoutPath,
  hydrateDraft = false,
  saveMode = "immediate",
  autoSave = false,
  defaultFullName = "",
  defaultEmail = "",
  initialPhone = "",
  initialLocation = "",
  initialSummary = "",
  initialSkills = "",
  initialExperience,
  initialEducation,
  initialReferees,
}: CreateCvFormProps) {
  const [fullName, setFullName] = useState(defaultFullName);
  const [email, setEmail] = useState(defaultEmail);
  const [phone, setPhone] = useState(initialPhone);
  const [location, setLocation] = useState(initialLocation);
  const [summary, setSummary] = useState(initialSummary);
  const [experience, setExperience] = useState<ExperienceRow[]>(
    withFallback(initialExperience, emptyExperience),
  );
  const [education, setEducation] = useState<EducationRow[]>(
    withFallback(initialEducation, emptyEducation),
  );
  const [referees, setReferees] = useState<RefereeRow[]>(
    withFallback(initialReferees, emptyReferee),
  );
  const [skills, setSkills] = useState(initialSkills);
  // Selected CV template. Drives both the live preview and, on submit, the
  // styling of the saved CV. Defaults to the first registered template.
  const [templateId, setTemplateId] = useState(DEFAULT_TEMPLATE_ID);
  // Preview-first layout: the detail fields live in a collapsible panel. Start
  // expanded so a fresh, empty CV shows the fields to fill in; the interview
  // handoff collapses it below once a full draft hydrates, leading with the
  // preview instead.
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: StatusKind; message: string } | null>(null);
  // Whether a usable draft (one with a name) was hydrated on mount. Drives the
  // post-login auto-save: without a name there is nothing to submit, so we show
  // the empty form instead (e.g. the draft was lost by signing in on another
  // device via a magic link).
  const [hydratedName, setHydratedName] = useState(false);
  const autoSaveFiredRef = useRef(false);

  // Chat-interview handoff: the draft lives in sessionStorage (too large for the
  // URL), so it can only be read on the client after mount. Read it once and fill
  // every field. The draft is deliberately NOT cleared here — it must survive the
  // anonymous-form → login → scoped-form chain; a successful immediate save clears
  // it. A stale draft on a later direct visit is prevented by the caller only
  // setting hydrateDraft when ?from=interview is present.
  useEffect(() => {
    if (!hydrateDraft) return;
    const draft = loadCvDraft();
    if (!draft) return;
    if (draft.fullName) setFullName(draft.fullName);
    if (draft.email) setEmail(draft.email);
    setPhone(draft.phone);
    setLocation(draft.location);
    setSummary(draft.summary);
    setSkills(draft.skills);
    if (draft.experience.length) setExperience(draft.experience);
    if (draft.education.length) setEducation(draft.education);
    if (draft.referees.length) setReferees(draft.referees);
    if (draft.template) setTemplateId(draft.template);
    const hydratedFullName = Boolean(draft.fullName?.trim());
    setHydratedName(hydratedFullName);
    // A full draft came from the chat interview — lead with the preview and
    // tuck the (already-filled) fields away until the user wants to tweak them.
    if (hydratedFullName) setDetailsOpen(false);
    // Run once on mount; the draft is a one-shot handoff.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Post-login auto-save: fire the immediate save exactly once, after the draft
  // has hydrated a name into the form. Runs only in immediate mode.
  useEffect(() => {
    if (!autoSave || saveMode !== "immediate") return;
    if (autoSaveFiredRef.current || busy) return;
    if (!hydratedName || !fullName.trim()) return;
    autoSaveFiredRef.current = true;
    void submitCv();
    // submitCv is stable enough for this one-shot; deps kept minimal on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSave, saveMode, hydratedName, fullName, busy]);

  function currentDraft(): CvDraft {
    return { fullName, email, phone, location, summary, skills, experience, education, referees, template: templateId };
  }

  // Live CV preview: rendered from the same code path that saves the CV, so the
  // preview is exactly what "Use template" produces. Preview mode tolerates an
  // empty name (shows a placeholder) so it renders while the form is still blank.
  const previewHtml = useMemo(
    () => renderCvHtml(currentDraft(), templateId, { preview: true }),
    // currentDraft is derived purely from these values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fullName, email, phone, location, summary, skills, experience, education, referees, templateId],
  );

  const templateIndex = Math.max(
    0,
    CV_TEMPLATES.findIndex((template) => template.id === templateId),
  );
  const activeTemplate = CV_TEMPLATES[templateIndex] ?? CV_TEMPLATES[0];
  const hasMultipleTemplates = CV_TEMPLATES.length > 1;

  function stepTemplate(delta: number) {
    const count = CV_TEMPLATES.length;
    const next = (templateIndex + delta + count) % count;
    setTemplateId(CV_TEMPLATES[next].id);
  }

  function updateExperience(index: number, patch: Partial<ExperienceRow>) {
    setExperience((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function updateEducation(index: number, patch: Partial<EducationRow>) {
    setEducation((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function updateReferee(index: number, patch: Partial<RefereeRow>) {
    setReferees((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function submitCv() {
    if (busy) return;
    if (!fullName.trim()) {
      // Reveal the fields so the user can see the empty name to fix it.
      setDetailsOpen(true);
      setNotice({ kind: "error", message: "Please enter your full name." });
      return;
    }

    // Not signed in: stash the CV (with any edits made on this form) so it
    // survives the session, then send the visitor to sign in first — /payment
    // needs a signed-in user to upload payment proof, so login comes before it
    // in the flow. destinationForSession sends a fresh/planless user straight
    // to /payment once they're signed in (see src/auth/login.ts). No account
    // save happens on this path — the CV stays in the browser session.
    if (saveMode === "deferred") {
      setBusy(true);
      setNotice({ kind: "loading", message: "Taking you to sign in..." });
      saveCvDraft(currentDraft());
      window.location.assign("/login?next=%2Fpayment");
      return;
    }

    setBusy(true);
    setNotice({ kind: "loading", message: "Building your CV..." });
    try {
      const response = await fetch("/job-scout/cv/create", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName,
          email,
          phone,
          location,
          summary,
          experience,
          education,
          skills,
          referees,
          template: templateId,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || `Request failed with ${response.status}`);
      }
      // Saved to the account — drop the handoff draft so a later visit is clean.
      clearCvDraft();
      setNotice({ kind: "complete", message: "CV created. Continuing..." });
      window.location.assign(successPath);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not create your CV.";
      setNotice({ kind: "error", message });
      setBusy(false);
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitCv();
  }

  return (
    <form className="form-stack" onSubmit={handleSubmit}>
      <div className="cv-preview">
        <div className="cv-template-switcher">
          {hasMultipleTemplates ? (
            <button
              type="button"
              className="button secondary icon-only"
              onClick={() => stepTemplate(-1)}
              aria-label="Previous template"
            >
              <ChevronLeft aria-hidden="true" />
            </button>
          ) : null}
          <span className="cv-template-name">
            <LayoutTemplate aria-hidden="true" />
            {activeTemplate.name}
            {hasMultipleTemplates ? (
              <span className="cv-template-count">
                {templateIndex + 1} / {CV_TEMPLATES.length}
              </span>
            ) : null}
          </span>
          {hasMultipleTemplates ? (
            <button
              type="button"
              className="button secondary icon-only"
              onClick={() => stepTemplate(1)}
              aria-label="Next template"
            >
              <ChevronRight aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <div className="cv-preview-frame-wrap">
          <iframe
            className="cv-preview-frame"
            title="CV preview"
            sandbox=""
            srcDoc={previewHtml}
          />
        </div>
        <p className="file-note cv-preview-note">
          This is how your details will look. {hasMultipleTemplates ? "Use the arrows to try another template. " : ""}
          Edit your details below, then choose &ldquo;Use template&rdquo;.
        </p>
      </div>

      <div className="cv-details">
        <button
          type="button"
          className="cv-details-toggle"
          onClick={() => setDetailsOpen((open) => !open)}
          aria-expanded={detailsOpen}
        >
          <SquarePen aria-hidden="true" />
          <span>Edit details</span>
          <ChevronDown aria-hidden="true" className={detailsOpen ? "cv-details-chevron open" : "cv-details-chevron"} />
        </button>
      </div>

      {detailsOpen ? (
        <div className="cv-details-body form-stack">
      <div className="grid">
        <label>
          <FieldLabel icon={UserRound}>Full name</FieldLabel>
          <input
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            maxLength={120}
            autoComplete="name"
            required
          />
        </label>
        <label>
          <FieldLabel icon={Mail}>Email</FieldLabel>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            maxLength={200}
            autoComplete="email"
          />
        </label>
      </div>
      <div className="grid">
        <label>
          <FieldLabel icon={Phone}>Phone</FieldLabel>
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            maxLength={60}
            autoComplete="tel"
          />
        </label>
        <label>
          <FieldLabel icon={MapPin}>Location</FieldLabel>
          <input
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            maxLength={120}
            autoComplete="address-level2"
          />
        </label>
      </div>

      <label>
        <FieldLabel icon={AlignLeft}>Professional summary (optional)</FieldLabel>
        <textarea
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          maxLength={4000}
          placeholder="A short paragraph about your experience and goals."
        />
        <span className="file-note">Leave this blank and Job Scout will write one for you from your details.</span>
      </label>

      <label>
        <FieldLabel icon={Tags}>Skills (optional)</FieldLabel>
        <input
          value={skills}
          onChange={(event) => setSkills(event.target.value)}
          maxLength={1000}
          placeholder="e.g. JavaScript, React, Project management"
        />
        <span className="file-note">
          Separate skills with commas. Leave this blank and Job Scout will choose skills that match each job.
        </span>
      </label>

      <div className="cv-section-head">
        <h2>
          <Briefcase aria-hidden="true" />
          Work experience
        </h2>
        <button
          type="button"
          className="button secondary"
          onClick={() => setExperience((rows) => [...rows, emptyExperience()])}
        >
          <Plus aria-hidden="true" />
          Add experience
        </button>
      </div>
      <div className="cv-entries">
        {experience.map((row, index) => (
          <div className="cv-entry" key={index}>
            <div className="grid">
              <label>
                <FieldLabel icon={SquarePen}>Job title</FieldLabel>
                <input
                  value={row.title}
                  onChange={(event) => updateExperience(index, { title: event.target.value })}
                  maxLength={200}
                />
              </label>
              <label>
                <FieldLabel icon={Building2}>Company</FieldLabel>
                <input
                  value={row.company}
                  onChange={(event) => updateExperience(index, { company: event.target.value })}
                  maxLength={200}
                />
              </label>
            </div>
            <div className="grid">
              <label>
                <FieldLabel icon={CalendarDays}>Start</FieldLabel>
                <input
                  value={row.start}
                  onChange={(event) => updateExperience(index, { start: event.target.value })}
                  maxLength={60}
                  placeholder="Jan 2022"
                />
              </label>
              <label>
                <FieldLabel icon={CalendarDays}>End</FieldLabel>
                <input
                  value={row.end}
                  onChange={(event) => updateExperience(index, { end: event.target.value })}
                  maxLength={60}
                  placeholder="Present"
                />
              </label>
            </div>
            <label>
              <FieldLabel icon={AlignLeft}>Description (optional)</FieldLabel>
              <textarea
                value={row.description}
                onChange={(event) => updateExperience(index, { description: event.target.value })}
                maxLength={4000}
                placeholder="What you did and achieved in this role."
              />
              <span className="file-note">
                Leave this blank and Job Scout will describe this role to fit each job you apply for.
              </span>
            </label>
            {experience.length > 1 ? (
              <div className="actions">
                <button
                  type="button"
                  className="button danger"
                  onClick={() => setExperience((rows) => rows.filter((_, i) => i !== index))}
                >
                  <Trash2 aria-hidden="true" />
                  Remove
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="cv-section-head">
        <h2>
          <GraduationCap aria-hidden="true" />
          Education &amp; certifications
        </h2>
        <button
          type="button"
          className="button secondary"
          onClick={() => setEducation((rows) => [...rows, emptyEducation()])}
        >
          <Plus aria-hidden="true" />
          Add education or certification
        </button>
      </div>
      <div className="cv-entries">
        {education.map((row, index) => (
          <div className="cv-entry" key={index}>
            <div className="grid">
              <label>
                <FieldLabel icon={ScrollText}>Degree, certification, or qualification</FieldLabel>
                <input
                  value={row.degree}
                  onChange={(event) => updateEducation(index, { degree: event.target.value })}
                  maxLength={200}
                  placeholder="e.g. BSc Computer Science, AWS Certified, PMP"
                />
              </label>
              <label>
                <FieldLabel icon={Building2}>Institution or issuer</FieldLabel>
                <input
                  value={row.institution}
                  onChange={(event) => updateEducation(index, { institution: event.target.value })}
                  maxLength={200}
                />
              </label>
            </div>
            <div className="grid">
              <label>
                <FieldLabel icon={CalendarDays}>Start</FieldLabel>
                <input
                  value={row.start}
                  onChange={(event) => updateEducation(index, { start: event.target.value })}
                  maxLength={60}
                  placeholder="2018"
                />
              </label>
              <label>
                <FieldLabel icon={CalendarDays}>End</FieldLabel>
                <input
                  value={row.end}
                  onChange={(event) => updateEducation(index, { end: event.target.value })}
                  maxLength={60}
                  placeholder="2022"
                />
              </label>
            </div>
            <label>
              <FieldLabel icon={AlignLeft}>Description (optional)</FieldLabel>
              <textarea
                value={row.description}
                onChange={(event) => updateEducation(index, { description: event.target.value })}
                maxLength={4000}
                placeholder="Key modules, achievements, or what this qualification covered."
              />
              <span className="file-note">
                Leave this blank and Job Scout will describe this qualification to fit each job you apply for.
              </span>
            </label>
            {education.length > 1 ? (
              <div className="actions">
                <button
                  type="button"
                  className="button danger"
                  onClick={() => setEducation((rows) => rows.filter((_, i) => i !== index))}
                >
                  <Trash2 aria-hidden="true" />
                  Remove
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="cv-section-head">
        <h2>
          <Users aria-hidden="true" />
          Referees
        </h2>
        <button
          type="button"
          className="button secondary"
          onClick={() => setReferees((rows) => [...rows, emptyReferee()])}
        >
          <Plus aria-hidden="true" />
          Add referee
        </button>
      </div>
      <div className="cv-entries">
        {referees.map((row, index) => (
          <div className="cv-entry" key={index}>
            <div className="grid">
              <label>
                <FieldLabel icon={UserRound}>Name</FieldLabel>
                <input
                  value={row.name}
                  onChange={(event) => updateReferee(index, { name: event.target.value })}
                  maxLength={200}
                />
              </label>
              <label>
                <FieldLabel icon={SquarePen}>Position</FieldLabel>
                <input
                  value={row.position}
                  onChange={(event) => updateReferee(index, { position: event.target.value })}
                  maxLength={200}
                  placeholder="e.g. Line manager"
                />
              </label>
            </div>
            <div className="grid">
              <label>
                <FieldLabel icon={Building2}>Company or organisation</FieldLabel>
                <input
                  value={row.company}
                  onChange={(event) => updateReferee(index, { company: event.target.value })}
                  maxLength={200}
                />
              </label>
              <label>
                <FieldLabel icon={Mail}>Email</FieldLabel>
                <input
                  type="email"
                  value={row.email}
                  onChange={(event) => updateReferee(index, { email: event.target.value })}
                  maxLength={200}
                />
              </label>
            </div>
            <label>
              <FieldLabel icon={Phone}>Phone</FieldLabel>
              <input
                value={row.phone}
                onChange={(event) => updateReferee(index, { phone: event.target.value })}
                maxLength={60}
              />
            </label>
            {referees.length > 1 ? (
              <div className="actions">
                <button
                  type="button"
                  className="button danger"
                  onClick={() => setReferees((rows) => rows.filter((_, i) => i !== index))}
                >
                  <Trash2 aria-hidden="true" />
                  Remove
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>

        </div>
      ) : null}

      <div className="actions">
        <button type="submit" disabled={busy}>
          <LayoutTemplate aria-hidden="true" />
          {busy ? "Saving..." : "Use template"}
        </button>
        <a className="button secondary" href={jobScoutPath}>
          <X aria-hidden="true" />
          Cancel
        </a>
      </div>

      {notice ? <StatusNotice kind={notice.kind}>{notice.message}</StatusNotice> : null}
    </form>
  );
}
