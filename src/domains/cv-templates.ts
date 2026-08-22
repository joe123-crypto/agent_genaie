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
export function renderCvHtml(input: CvInput, templateId?: string, opts: RenderCvOptions = {}): string {
  const cv = normalizeCvInput(input, opts);
  const template = resolveTemplate(templateId);
  const body =
    (template.layout ?? "single") === "sidebar"
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${safeText(
    cv.fullName,
  )} — CV</title><style>${template.style}</style></head><body><main class="cv">${body}</main></body></html>`;
}
