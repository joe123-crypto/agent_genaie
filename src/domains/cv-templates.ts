// Client-safe CV rendering core + template registry.
//
// This module deliberately imports NOTHING from "@/src/lib/utils" (which pulls
// in firebase-admin and node:crypto) so it can be imported into client
// components — the create-cv form renders a live preview from it in the browser
// with the exact same code path the server uses to save the CV. The server
// wrapper lives in ./cv-html.ts and simply re-exports from here.

// Structured data captured by the "Create CV" form. This is deliberately a
// plain standard-CV shape: the app has no rich CV schema of its own, it only
// stores the canonical CV as self-contained HTML (see finalizeJobScoutCvHtml).
export type CvExperienceInput = {
  title?: unknown;
  company?: unknown;
  start?: unknown;
  end?: unknown;
  description?: unknown;
};

export type CvEducationInput = {
  degree?: unknown;
  institution?: unknown;
  start?: unknown;
  end?: unknown;
  description?: unknown;
};

export type CvRefereeInput = {
  name?: unknown;
  position?: unknown;
  company?: unknown;
  email?: unknown;
  phone?: unknown;
};

export type CvInput = {
  fullName?: unknown;
  email?: unknown;
  phone?: unknown;
  location?: unknown;
  summary?: unknown;
  experience?: unknown;
  education?: unknown;
  skills?: unknown;
  referees?: unknown;
};

type CvExperience = { title: string; company: string; start: string; end: string; description: string };
type CvEducation = { degree: string; institution: string; start: string; end: string; description: string };
type CvReferee = { name: string; position: string; company: string; email: string; phone: string };

export type NormalizedCv = {
  fullName: string;
  email: string;
  phone: string;
  location: string;
  summary: string;
  experience: CvExperience[];
  education: CvEducation[];
  skills: string[];
  referees: CvReferee[];
};

// Local httpError-equivalent: a plain Error tagged with a status, so this module
// stays free of the firebase-admin-importing utils.ts. The create route reads
// `error.status ?? 500`, so this behaves identically to utils.httpError on the
// server save path.
function badRequest(message: string) {
  const err = new Error(message) as Error & { status?: number };
  err.status = 400;
  return err;
}

const MAX_LINE = 240;
const MAX_SUMMARY = 4000;
const MAX_DESCRIPTION = 4000;
const MAX_EXPERIENCE = 20;
const MAX_EDUCATION = 20;
const MAX_SKILLS = 60;
const MAX_REFEREES = 10;

function line(value: unknown, max = MAX_LINE) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function block(value: unknown, max: number) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

// Escape for safe HTML. A client-safe copy of utils.escapeHtml so this module
// carries no server-only imports.
function escapeHtml(value: unknown) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function normalizeExperience(value: unknown): CvExperience[] {
  const rows = Array.isArray(value) ? value : [];
  const output: CvExperience[] = [];
  for (const raw of rows) {
    const item = raw && typeof raw === "object" ? (raw as CvExperienceInput) : {};
    const entry = {
      title: line(item.title),
      company: line(item.company),
      start: line(item.start, 60),
      end: line(item.end, 60),
      description: block(item.description, MAX_DESCRIPTION),
    };
    // Drop empty rows so trailing blank form entries don't render.
    if (!entry.title && !entry.company && !entry.description) continue;
    output.push(entry);
    if (output.length >= MAX_EXPERIENCE) break;
  }
  return output;
}

function normalizeEducation(value: unknown): CvEducation[] {
  const rows = Array.isArray(value) ? value : [];
  const output: CvEducation[] = [];
  for (const raw of rows) {
    const item = raw && typeof raw === "object" ? (raw as CvEducationInput) : {};
    const entry = {
      degree: line(item.degree),
      institution: line(item.institution),
      start: line(item.start, 60),
      end: line(item.end, 60),
      description: block(item.description, MAX_DESCRIPTION),
    };
    if (!entry.degree && !entry.institution && !entry.description) continue;
    output.push(entry);
    if (output.length >= MAX_EDUCATION) break;
  }
  return output;
}

function normalizeSkills(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const output: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const text = line(raw);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(text);
    if (output.length >= MAX_SKILLS) break;
  }
  return output;
}

function normalizeReferees(value: unknown): CvReferee[] {
  const rows = Array.isArray(value) ? value : [];
  const output: CvReferee[] = [];
  for (const raw of rows) {
    const item = raw && typeof raw === "object" ? (raw as CvRefereeInput) : {};
    const entry = {
      name: line(item.name),
      position: line(item.position),
      company: line(item.company),
      email: line(item.email),
      phone: line(item.phone, 60),
    };
    if (!entry.name && !entry.position && !entry.company && !entry.email && !entry.phone) continue;
    output.push(entry);
    if (output.length >= MAX_REFEREES) break;
  }
  return output;
}

// Options for renderCvHtml. `preview` relaxes the required-name rule so the
// live client preview renders while the form is still empty; the server save
// path leaves it off and keeps the validation.
export type RenderCvOptions = { preview?: boolean };

// Placeholder shown in the live preview only, before the user has typed a name.
const PREVIEW_NAME_PLACEHOLDER = "Your name";

export function normalizeCvInput(input: CvInput, opts: RenderCvOptions = {}): NormalizedCv {
  const source = input && typeof input === "object" ? input : {};
  const fullName = line(source.fullName);
  if (!fullName && !opts.preview) throw badRequest("Full name is required.");
  return {
    fullName: fullName || (opts.preview ? PREVIEW_NAME_PLACEHOLDER : fullName),
    email: line(source.email),
    phone: line(source.phone),
    location: line(source.location),
    summary: block(source.summary, MAX_SUMMARY),
    experience: normalizeExperience(source.experience),
    education: normalizeEducation(source.education),
    skills: normalizeSkills(source.skills),
    referees: normalizeReferees(source.referees),
  };
}

// Escape for safe HTML *and* neutralize the content patterns that
// validateCanonicalCvHtml scans the whole document for. That validator rejects
// inline event handlers (`\son[a-z]+=`) and CSS external refs (`url(...//`,
// `@import ...//`) anywhere in the HTML — including visible body text — so
// ordinary CV prose like "onload=" or "url(x)" would trip it. Encoding `=`,
// `(`, `)`, `@` as numeric entities renders identically in the browser while
// removing the literal characters those regexes require.
function safeText(value: string) {
  return escapeHtml(value)
    .replaceAll("=", "&#61;")
    .replaceAll("(", "&#40;")
    .replaceAll(")", "&#41;")
    .replaceAll("@", "&#64;");
}

// Render user free text, preserving paragraph/line breaks.
function renderMultiline(value: string) {
  return safeText(value)
    .split(/\n{2,}/)
    .map((para) => para.replace(/\n/g, "<br />"))
    .map((para) => `<p>${para}</p>`)
    .join("");
}

function dateRange(start: string, end: string) {
  if (start && end) return `${safeText(start)} – ${safeText(end)}`;
  if (start) return `${safeText(start)} – Present`;
  if (end) return safeText(end);
  return "";
}

// --- Template registry -----------------------------------------------------
//
// A template is just an id, a display name, and an inline stylesheet. The
// document markup (section builders below) is shared by every template; the
// style is what makes them look different. This keeps preview == saved output
// and satisfies validateCanonicalCvHtml by construction (no scripts, no
// external references — inline CSS only).
//
// Only one template ships today. Adding another is a single entry here; the
// form's switcher arrows appear automatically once CV_TEMPLATES has more than
// one entry.

// `layout` selects the document structure a template renders with:
//   "single"  – one column: header (name + inline contact) then the sections
//               stacked in a fixed order. The default; classic and elegant use it.
//   "sidebar" – a full-width name banner over a two-column grid: a left sidebar
//               (contact, education, skills) beside a wider main column
//               (profile, experience, referees). Real independent columns, so
//               the two panes need to live in separate DOM containers — which is
//               why layout is a property of the template, not just its CSS.
export type CvLayout = "single" | "sidebar";
export type CvTemplate = { id: string; name: string; style: string; layout?: CvLayout };

const CLASSIC_STYLE = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
@page { size: A4; margin: 18mm; }
html { height: 100%; }
body { margin: 0; padding: 48px; font-family: Arial, Helvetica, sans-serif; color: #111; line-height: 1.55; font-size: 16px; min-height: 100vh; display: flex; flex-direction: column; }
.cv { width: 100%; max-width: 210mm; margin: 0 auto; flex: 1 0 auto; display: flex; flex-direction: column; justify-content: space-between; }
@media print { body { padding: 0; min-height: auto; display: block; } .cv { max-width: none; margin: 0; min-height: auto; display: block; } }
section:last-child { margin-bottom: 0; }
header { border-bottom: 2px solid #111; padding-bottom: 14px; margin-bottom: 28px; }
h1 { margin: 0 0 8px; font-size: 32px; }
.contact { color: #444; font-size: 14.5px; }
.contact span + span::before { content: " • "; color: #999; }
section { margin-bottom: 30px; }
h2 { font-size: 17px; text-transform: uppercase; letter-spacing: 0.06em; border-bottom: 1px solid #ccc; padding-bottom: 5px; margin: 0 0 16px; }
.entry { margin-bottom: 18px; }
.entry-head { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.entry-title { font-weight: bold; }
.entry-sub { color: #555; }
.entry-dates { color: #777; font-size: 14.5px; white-space: nowrap; }
.entry p { margin: 7px 0 0; }
.skills { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 10px; }
.skills li { background: #f1f1f1; border-radius: 4px; padding: 5px 12px; font-size: 14.5px; }
p { margin: 0 0 8px; }
`.trim();

// A refined, minimalist single-column resume in the style of a classic
// typeset CV: a centered name in a wide-tracked serif, a contact line framed
// by hairline rules, uppercase section headings, and a multi-column skills
// list. Styles the same shared markup as every other template — only the CSS
// differs — so preview == saved output and it passes validateCanonicalCvHtml
// by construction (inline CSS only, no scripts, no external references).
const ELEGANT_STYLE = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
@page { size: A4; margin: 18mm; }
html { height: 100%; }
body { margin: 0; padding: 48px 56px; font-family: "Helvetica Neue", Arial, sans-serif; color: #2c2c2c; line-height: 1.5; font-size: 14.5px; background: #fbfaf6; min-height: 100vh; display: flex; flex-direction: column; }
.cv { width: 100%; max-width: 210mm; margin: 0 auto; flex: 1 0 auto; display: flex; flex-direction: column; justify-content: space-between; }
@media print { body { padding: 0; background: #fff; min-height: auto; display: block; } .cv { max-width: none; margin: 0; min-height: auto; display: block; } }
section:last-child { margin-bottom: 0; }
header { text-align: center; margin-bottom: 26px; }
h1 { margin: 0; font-family: Georgia, "Times New Roman", serif; font-weight: 400; font-size: 36px; letter-spacing: 0.24em; text-transform: uppercase; color: #1f1f1f; padding-left: 0.24em; }
header .contact { border-top: 1px solid #bbb5a8; border-bottom: 1px solid #bbb5a8; padding: 9px 0; margin-top: 16px; justify-content: center; }
.contact { color: #555; font-size: 13px; letter-spacing: 0.02em; }
.contact span + span::before { content: " — "; color: #9c968b; }
section { margin-bottom: 24px; }
h2 { font-size: 14.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em; color: #2b2b2b; border-bottom: 1px solid #cfc9bd; padding-bottom: 5px; margin: 0 0 14px; }
.entry { margin-bottom: 16px; }
.entry-head { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: flex-start; }
.entry-head > div:first-child { display: flex; flex-direction: column; }
.entry-sub { order: 0; font-weight: 700; color: #1f1f1f; font-size: 14.5px; }
.entry-title { order: 1; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; font-size: 13.5px; color: #444; margin-top: 2px; }
.entry-dates { color: #555; font-size: 13.5px; white-space: nowrap; text-transform: uppercase; letter-spacing: 0.04em; }
.entry p { margin: 7px 0 0; }
.skills { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 24px; }
.skills li { background: none; border-radius: 0; padding: 0; font-size: 14.5px; color: #333; }
p { margin: 0 0 8px; }
`.trim();

// A two-column resume in the style of a modern professional template: a
// centered, widely-tracked light name banner across the top, then a narrow left
// sidebar (contact with line icons, education, skills) beside a wider main
// column (profile, work experience) divided by a hairline rule. Uses the
// "sidebar" document layout; the CSS below styles that structure. Self-contained
// inline CSS only, so it passes validateCanonicalCvHtml by construction.
const MODERN_STYLE = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
@page { size: A4; margin: 18mm; }
html { height: 100%; }
body { margin: 0; padding: 52px 56px; font-family: "Helvetica Neue", Arial, sans-serif; color: #333; line-height: 1.55; font-size: 14.5px; background: #fff; min-height: 100vh; display: flex; flex-direction: column; }
.cv { width: 100%; max-width: 210mm; margin: 0 auto; flex: 1 0 auto; display: flex; flex-direction: column; }
@media print { body { padding: 0; min-height: auto; display: block; } .cv { max-width: none; margin: 0; min-height: auto; display: block; } .cv-columns { flex: 0 1 auto; } .cv-aside, .cv-main { display: block; } }
.cv-header { text-align: center; padding-bottom: 20px; border-bottom: 1px solid #d8d8d8; }
.cv-header h1 { margin: 0; font-weight: 300; font-size: 38px; letter-spacing: 0.3em; text-transform: uppercase; color: #2a2a2a; padding-left: 0.3em; }
.cv-columns { display: grid; grid-template-columns: 1fr 1.9fr; grid-template-rows: minmax(min-content, 1fr); margin-top: 32px; flex: 1 0 auto; }
.cv-aside { padding-right: 32px; display: flex; flex-direction: column; justify-content: space-between; }
.cv-main { border-left: 1px solid #e3e3e3; padding-left: 32px; display: flex; flex-direction: column; justify-content: space-between; }
.cv-aside section, .cv-main section { margin-bottom: 30px; }
.cv-aside section:last-child, .cv-main section:last-child { margin-bottom: 0; }
h2 { font-size: 15px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.18em; color: #444; margin: 0 0 16px; }
.contact-list { list-style: none; margin: 0; padding: 0; }
.contact-list li { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; font-size: 13.5px; color: #4a4a4a; }
.contact-list svg { width: 16px; height: 16px; flex: none; color: #8a8a8a; }
.contact-list span { min-width: 0; overflow-wrap: anywhere; }
.entry { margin-bottom: 20px; }
.entry-head { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; align-items: baseline; }
.entry-title { font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; font-size: 14px; color: #2a2a2a; }
.entry-sub { color: #666; font-size: 13.5px; }
.entry-dates { color: #8a8a8a; font-size: 13px; white-space: nowrap; }
.entry p { margin: 8px 0 0; color: #555; }
.cv-aside .entry-head { flex-direction: column; align-items: flex-start; gap: 2px; }
.cv-aside .entry-title { font-size: 13.5px; }
.cv-aside .entry-sub { font-size: 13px; }
.cv-aside .entry-dates { color: #999; }
.skills { list-style: none; padding: 0; margin: 0; display: block; }
.skills li { background: none; border: none; border-radius: 0; padding: 4px 0; font-size: 14px; color: #555; }
p { margin: 0 0 8px; }
`.trim();

export const CV_TEMPLATES: CvTemplate[] = [
  { id: "classic", name: "Classic", style: CLASSIC_STYLE },
  { id: "elegant", name: "Elegant", style: ELEGANT_STYLE },
  { id: "modern", name: "Modern", style: MODERN_STYLE, layout: "sidebar" },
];

export const DEFAULT_TEMPLATE_ID = CV_TEMPLATES[0].id;

// Resolve a (possibly untrusted / absent) template id to a known template,
// falling back to the default. A template id only ever selects a known inline
// style — never user-supplied HTML — so this is safe against arbitrary input.
export function resolveTemplate(id: string | undefined | null): CvTemplate {
  return CV_TEMPLATES.find((template) => template.id === id) ?? CV_TEMPLATES[0];
}

export function isValidTemplateId(id: unknown): id is string {
  return typeof id === "string" && CV_TEMPLATES.some((template) => template.id === id);
}

// --- Shared section builders ----------------------------------------------

function experienceSection(rows: CvExperience[]) {
  if (!rows.length) return "";
  const items = rows
    .map((row) => {
      const dates = dateRange(row.start, row.end);
      const sub = row.company ? `<div class="entry-sub">${safeText(row.company)}</div>` : "";
      const title = row.title ? `<div class="entry-title">${safeText(row.title)}</div>` : "";
      const description = row.description ? renderMultiline(row.description) : "";
      return `<div class="entry"><div class="entry-head"><div>${title}${sub}</div>${
        dates ? `<div class="entry-dates">${dates}</div>` : ""
      }</div>${description}</div>`;
    })
    .join("");
  return `<section><h2>Experience</h2>${items}</section>`;
}

function educationSection(rows: CvEducation[]) {
  if (!rows.length) return "";
  const items = rows
    .map((row) => {
      const dates = dateRange(row.start, row.end);
      const degree = row.degree ? `<div class="entry-title">${safeText(row.degree)}</div>` : "";
      const sub = row.institution ? `<div class="entry-sub">${safeText(row.institution)}</div>` : "";
      const description = row.description ? renderMultiline(row.description) : "";
      return `<div class="entry"><div class="entry-head"><div>${degree}${sub}</div>${
        dates ? `<div class="entry-dates">${dates}</div>` : ""
      }</div>${description}</div>`;
    })
    .join("");
  return `<section><h2>Education &amp; Certifications</h2>${items}</section>`;
}

function skillsSection(skills: string[]) {
  if (!skills.length) return "";
  const items = skills.map((skill) => `<li>${safeText(skill)}</li>`).join("");
  return `<section><h2>Skills</h2><ul class="skills">${items}</ul></section>`;
}

function summarySection(summary: string) {
  if (!summary) return "";
  return `<section><h2>Summary</h2>${renderMultiline(summary)}</section>`;
}

function refereesSection(rows: CvReferee[]) {
  if (!rows.length) return "";
  const items = rows
    .map((row) => {
      const name = row.name ? `<div class="entry-title">${safeText(row.name)}</div>` : "";
      const role = [row.position, row.company].filter(Boolean).join(", ");
      const sub = role ? `<div class="entry-sub">${safeText(role)}</div>` : "";
      const contact = [row.email, row.phone]
        .filter(Boolean)
        .map((part) => `<span>${safeText(part)}</span>`)
        .join("");
      const contactLine = contact ? `<div class="contact">${contact}</div>` : "";
      return `<div class="entry">${name}${sub}${contactLine}</div>`;
    })
    .join("");
  return `<section><h2>Referees</h2>${items}</section>`;
}

function contactLine(cv: NormalizedCv) {
  const parts = [cv.email, cv.phone, cv.location]
    .filter(Boolean)
    .map((part) => `<span>${safeText(part)}</span>`);
  return parts.length ? `<div class="contact">${parts.join("")}</div>` : "";
}

// Inline (self-contained) line icons for the sidebar contact block. Stroke-only
// SVG using currentColor — no external references, no url(), no event handlers —
// so they pass validateCanonicalCvHtml. Only used by the sidebar layout.
const CONTACT_ICONS = {
  phone:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"/></svg>',
  email:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>',
  location:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>',
} as const;

// Stacked contact block for the sidebar layout (heading + one icon-led line per
// detail), as distinct from the inline single-line `contactLine` used in the
// single-column header.
function contactSection(cv: NormalizedCv) {
  const rows = ([
    ["phone", cv.phone],
    ["email", cv.email],
    ["location", cv.location],
  ] as const)
    .filter(([, value]) => Boolean(value))
    .map(([key, value]) => `<li>${CONTACT_ICONS[key]}<span>${safeText(value)}</span></li>`)
    .join("");
  if (!rows) return "";
  return `<section><h2>Contact</h2><ul class="contact-list">${rows}</ul></section>`;
}

// Two-column body for the "sidebar" layout: a full-width name banner over a
// grid whose left pane carries contact, education, and skills and whose right
// pane carries the profile, experience, and referees. The two panes are
// separate containers so they lay out as independent columns (each as tall as
// its own content) rather than sharing grid rows.
function sidebarBody(cv: NormalizedCv) {
  const aside = [contactSection(cv), educationSection(cv.education), skillsSection(cv.skills)]
    .filter(Boolean)
    .join("");
  const main = [summarySection(cv.summary), experienceSection(cv.experience), refereesSection(cv.referees)]
    .filter(Boolean)
    .join("");
  return `<header class="cv-header"><h1>${safeText(cv.fullName)}</h1></header><div class="cv-columns"><aside class="cv-aside">${aside}</aside><div class="cv-main">${main}</div></div>`;
}

// Build a single self-contained HTML document from the create-cv form data in
// the chosen template's style. All CSS is inlined and every value is escaped so
// the result satisfies validateCanonicalCvHtml (no scripts, no external
// references) by construction. Pass { preview: true } for the live client
// preview so an empty name renders a placeholder instead of throwing.
// The inner markup of <main class="cv"> for a normalized CV in the given
// template's layout. Shared by the saved document (renderCvHtml) and the
// preview document (renderCvPreviewDocument) so both render identical content.
function buildCvBody(cv: NormalizedCv, template: CvTemplate): string {
  return (template.layout ?? "single") === "sidebar"
    ? sidebarBody(cv)
    : [
        `<header><h1>${safeText(cv.fullName)}</h1>${contactLine(cv)}</header>`,
        summarySection(cv.summary),
        skillsSection(cv.skills),
        experienceSection(cv.experience),
        educationSection(cv.education),
        refereesSection(cv.referees),
      ]
        .filter(Boolean)
        .join("");
}

export function renderCvHtml(input: CvInput, templateId?: string, opts: RenderCvOptions = {}): string {
  const cv = normalizeCvInput(input, opts);
  const template = resolveTemplate(templateId);
  const body = buildCvBody(cv, template);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${safeText(
    cv.fullName,
  )} — CV</title><style>${template.style}</style></head><body><main class="cv">${body}</main></body></html>`;
}

// --- Paginated preview document -------------------------------------------
//
// The live create-cv preview shows the CV as real, fixed-size A4 pages that the
// outer container scrolls through (rather than one internally-scrolling sheet).
// This is PREVIEW-ONLY: renderCvHtml (the saved document) stays script-free and
// self-contained so it keeps passing validateCanonicalCvHtml. The preview
// document reuses the same buildCvBody markup + template.style, but adds a small
// pagination stylesheet and an inline paginator script that lays the rendered
// content into <div class="page"> boxes. The paginator posts the total document
// height to the parent (postMessage) so the iframe can be sized and the wrap
// scrolled. The preview iframe therefore runs with sandbox="allow-scripts".

// Per-template page box metrics. These mirror the padding/background that each
// *_STYLE body rule sets — kept here (rather than reused from the body rule)
// because the paginated preview neutralizes the body box model. Keep in sync
// with the body { padding / background } of each style constant above.
const PREVIEW_PAGE_METRICS: Record<string, { pad: string; bg: string }> = {
  classic: { pad: "48px", bg: "#fff" },
  elegant: { pad: "48px 56px", bg: "#fbfaf6" },
  modern: { pad: "52px 56px", bg: "#fff" },
};

// Overrides the template's on-screen one-page fill (min-height:100vh + flex
// justify) so pages don't each stretch to full height, and styles the page
// boxes (fixed A4, non-scrolling, gap + shadow between them).
const PREVIEW_PAGINATION_CSS = `
html, body { height: auto !important; }
body { min-height: 0 !important; display: block !important; padding: 0 !important; margin: 0 !important; background: #ececea !important; }
.cv-source { position: absolute !important; left: -10000px !important; top: 0 !important; width: 794px; visibility: hidden; }
.cv { max-width: none !important; margin: 0 !important; flex: none !important; display: block !important; justify-content: flex-start !important; min-height: 0 !important; width: auto !important; }
.cv-columns { flex: none !important; margin-top: 0 !important; }
.cv-aside, .cv-main { justify-content: flex-start !important; }
.pages { display: flex; flex-direction: column; align-items: center; gap: 24px; padding: 24px 0; }
.page { position: relative; box-sizing: border-box; width: 794px; height: 1123px; overflow: hidden; background: var(--page-bg, #fff); padding: var(--page-pad, 48px); box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18); border: 1px solid #d9d9d5; }
.cv-scratch { position: absolute; left: -10000px; top: 0; }
`.trim();

// Greedy DOM paginator, run inside the preview iframe. Kept free of template
// literals and optional chaining so it stays a plain, widely-supported string.
const PAGINATOR_JS = `
(function () {
  var PAGE_W = 794;
  var pagesEl = document.getElementById("pages");
  var source = document.querySelector(".cv-source .cv");
  if (!pagesEl || !source) return;

  function el(tag, cls) { var n = document.createElement(tag); if (cls) n.className = cls; return n; }
  function avail(page) {
    var cs = getComputedStyle(page);
    return page.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  }
  function scratchPage() {
    var p = el("div", "page");
    p.classList.add("cv-scratch");
    document.body.appendChild(p);
    return p;
  }

  // A section's item-units: each .entry / <p> is one atomic unit; a
  // <ul class="skills"> expands into one unit per <li> so skills lists break.
  function sectionUnits(sec) {
    var units = [];
    var kids = sec.children;
    for (var i = 0; i < kids.length; i++) {
      var c = kids[i];
      if (c.tagName === "H2") continue;
      if (c.tagName === "UL" && c.classList.contains("skills")) {
        var lis = c.children;
        for (var j = 0; j < lis.length; j++) units.push({ kind: "li", node: lis[j] });
      } else {
        units.push({ kind: "block", node: c });
      }
    }
    return units;
  }

  // Ordered flow blocks of a container: a header (atomic) and sections.
  function blocksOf(root) {
    var blocks = [];
    var kids = root.children;
    for (var i = 0; i < kids.length; i++) {
      var c = kids[i];
      if (c.tagName === "HEADER") { blocks.push({ type: "header", node: c }); continue; }
      if (c.tagName === "SECTION") {
        blocks.push({ type: "section", className: c.className, h2: c.querySelector(":scope > h2"), units: sectionUnits(c) });
      }
    }
    return blocks;
  }

  // Lay blocks into a sequence of container elements (one per page). Returns the
  // filled, detached containers. widthPx (optional) fixes the measuring width so
  // a column wraps exactly as it will inside the real grid.
  function paginate(blocks, containerTag, containerClass, widthPx, availFor, scratch) {
    var result = [];
    var pageIndex = 0;
    var container, curAvail, curSection, curUl;

    function open() {
      container = el(containerTag, containerClass);
      if (widthPx) container.style.width = widthPx + "px";
      scratch.innerHTML = "";
      scratch.appendChild(container);
      curAvail = availFor(pageIndex);
      curSection = null;
      curUl = null;
    }
    function flush() {
      scratch.removeChild(container);
      if (widthPx) container.style.width = "";
      result.push(container);
      pageIndex++;
    }
    function over() { return container.scrollHeight > curAvail; }
    function hasContent() { return container.childNodes.length > 0; }

    function openSection(cls, h2) {
      curSection = el("section", cls || "");
      if (h2) curSection.appendChild(h2.cloneNode(true));
      curUl = null;
      container.appendChild(curSection);
    }
    // Append one unit to the current section; return a rollback function.
    function placeUnit(unit) {
      if (unit.kind === "li") {
        if (!curUl) { curUl = el("ul", "skills"); curSection.appendChild(curUl); }
        var ul = curUl;
        var li = unit.node.cloneNode(true);
        ul.appendChild(li);
        return function () { ul.removeChild(li); if (!ul.children.length) { if (ul.parentNode) ul.parentNode.removeChild(ul); if (curUl === ul) curUl = null; } };
      }
      curUl = null;
      var node = unit.node.cloneNode(true);
      curSection.appendChild(node);
      return function () { if (node.parentNode) node.parentNode.removeChild(node); };
    }

    open();

    for (var b = 0; b < blocks.length; b++) {
      var block = blocks[b];
      if (block.type === "header") {
        var h = block.node.cloneNode(true);
        container.appendChild(h);
        if (over() && container.childNodes.length > 1) {
          container.removeChild(h);
          flush(); open();
          container.appendChild(h);
        }
        curSection = null; curUl = null;
        continue;
      }
      // section: place its units, keeping the h2 with its first unit and never
      // leaving an orphan h2 at the foot of a page.
      openSection(block.className, block.h2);
      var units = block.units;
      for (var u = 0; u < units.length; u++) {
        var rollback = placeUnit(units[u]);
        if (!over()) continue;
        var placedBefore = fragmentUnitCount(curSection) - 1; // exclude the one just added
        rollback();
        if (placedBefore > 0) {
          // Earlier units already fit here: break the section and continue it on
          // a fresh page under a repeated (headingless) fragment.
          flush(); open();
          openSection(block.className, null);
          placeUnit(units[u]);
        } else if (hasOtherBlocks(container, curSection)) {
          // The h2 + first unit don't fit under existing page content: move the
          // whole section start to a fresh page so the h2 isn't orphaned.
          container.removeChild(curSection);
          flush(); open();
          openSection(block.className, block.h2);
          placeUnit(units[u]);
        } else {
          // Fresh page, a single unit still overflows: accept it (clipped).
          placeUnit(units[u]);
        }
      }
    }
    if (hasContent()) flush();
    return result;
  }

  // Count of top-level item-units currently in a section fragment.
  function fragmentUnitCount(sec) {
    return sec.querySelectorAll(":scope > .entry, :scope > p, :scope > ul.skills > li").length;
  }
  function hasOtherBlocks(cont, sec) {
    var kids = cont.children;
    for (var i = 0; i < kids.length; i++) if (kids[i] !== sec) return true;
    return false;
  }

  function buildSingle() {
    var scratch = scratchPage();
    var pageAvail = avail(scratch);
    var cols = paginate(blocksOf(source), "main", "cv", 0, function () { return pageAvail; }, scratch);
    document.body.removeChild(scratch);
    for (var i = 0; i < cols.length; i++) {
      var p = el("div", "page");
      p.appendChild(cols[i]);
      pagesEl.appendChild(p);
    }
  }

  function buildSidebar() {
    var headerSrc = source.querySelector(":scope > .cv-header") || source.querySelector(":scope > header");
    var asideSrc = source.querySelector(".cv-aside");
    var mainSrc = source.querySelector(".cv-main");

    // Measure real column widths + header height inside a scratch grid page.
    var sp = scratchPage();
    var cv = el("main", "cv"); sp.appendChild(cv);
    var headerH = 0;
    if (headerSrc) { var hc = headerSrc.cloneNode(true); cv.appendChild(hc); headerH = hc.getBoundingClientRect().height; }
    var grid = el("div", "cv-columns"); cv.appendChild(grid);
    var aMeasure = el("aside", "cv-aside"); var mMeasure = el("div", "cv-main");
    grid.appendChild(aMeasure); grid.appendChild(mMeasure);
    var asideW = aMeasure.clientWidth;
    var mainW = mMeasure.clientWidth;
    var pageAvail = avail(sp);
    document.body.removeChild(sp);

    function availFor(i) { return i === 0 ? Math.max(0, pageAvail - headerH - 8) : pageAvail; }
    var scratch = scratchPage();
    var asideCols = asideSrc ? paginate(blocksOf(asideSrc), "aside", "cv-aside", asideW, availFor, scratch) : [];
    var mainCols = mainSrc ? paginate(blocksOf(mainSrc), "div", "cv-main", mainW, availFor, scratch) : [];
    document.body.removeChild(scratch);

    var n = Math.max(asideCols.length, mainCols.length, 1);
    for (var i = 0; i < n; i++) {
      var p = el("div", "page");
      var cvw = el("main", "cv"); p.appendChild(cvw);
      if (i === 0 && headerSrc) cvw.appendChild(headerSrc.cloneNode(true));
      var colw = el("div", "cv-columns"); cvw.appendChild(colw);
      colw.appendChild(asideCols[i] || el("aside", "cv-aside"));
      colw.appendChild(mainCols[i] || el("div", "cv-main"));
      pagesEl.appendChild(p);
    }
  }

  function postSize() {
    var h = Math.ceil(document.documentElement.scrollHeight);
    if (window.parent) window.parent.postMessage({ type: "cv-preview-size", height: h }, "*");
  }

  function build() {
    pagesEl.innerHTML = "";
    if (source.querySelector(".cv-columns")) buildSidebar(); else buildSingle();
    postSize();
  }

  build();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(build);
  window.addEventListener("load", postSize);
})();
`.trim();

// Build the preview-only document (with the inline paginator). Never saved.
export function renderCvPreviewDocument(input: CvInput, templateId?: string): string {
  const cv = normalizeCvInput(input, { preview: true });
  const template = resolveTemplate(templateId);
  const body = buildCvBody(cv, template);
  const metrics = PREVIEW_PAGE_METRICS[template.id] ?? { pad: "48px", bg: "#fff" };
  const rootVars = `:root{--page-pad:${metrics.pad};--page-bg:${metrics.bg};}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${safeText(
    cv.fullName,
  )} — CV preview</title><style>${template.style}</style><style>${PREVIEW_PAGINATION_CSS}</style><style>${rootVars}</style></head><body><div class="cv-source"><main class="cv">${body}</main></div><div class="pages" id="pages"></div><script>${PAGINATOR_JS}</script></body></html>`;
}
