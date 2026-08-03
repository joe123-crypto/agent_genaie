import { escapeHtml, httpError } from "@/src/lib/utils";

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
type CvEducation = { degree: string; institution: string; start: string; end: string };
type CvReferee = { name: string; position: string; company: string; email: string; phone: string };

type NormalizedCv = {
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
    };
    if (!entry.degree && !entry.institution) continue;
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

export function normalizeCvInput(input: CvInput): NormalizedCv {
  const source = input && typeof input === "object" ? input : {};
  const fullName = line(source.fullName);
  if (!fullName) throw httpError(400, "Full name is required.");
  return {
    fullName,
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

const CV_STYLE = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; padding: 40px; font-family: Arial, Helvetica, sans-serif; color: #111; line-height: 1.5; font-size: 14px; }
.cv { max-width: 720px; margin: 0 auto; }
header { border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 20px; }
h1 { margin: 0 0 6px; font-size: 26px; }
.contact { color: #444; font-size: 13px; }
.contact span + span::before { content: " • "; color: #999; }
section { margin-bottom: 22px; }
h2 { font-size: 15px; text-transform: uppercase; letter-spacing: 0.06em; border-bottom: 1px solid #ccc; padding-bottom: 4px; margin: 0 0 12px; }
.entry { margin-bottom: 14px; }
.entry-head { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.entry-title { font-weight: bold; }
.entry-sub { color: #555; }
.entry-dates { color: #777; font-size: 13px; white-space: nowrap; }
.entry p { margin: 6px 0 0; }
.skills { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 8px; }
.skills li { background: #f1f1f1; border-radius: 4px; padding: 4px 10px; font-size: 13px; }
p { margin: 0 0 8px; }
`.trim();

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
      return `<div class="entry"><div class="entry-head"><div>${degree}${sub}</div>${
        dates ? `<div class="entry-dates">${dates}</div>` : ""
      }</div></div>`;
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

// Build a single self-contained HTML document from the create-cv form data.
// All CSS is inlined and every value is escaped so the result satisfies
// validateCanonicalCvHtml (no scripts, no external references) by construction.
export function buildCvHtml(input: CvInput): string {
  const cv = normalizeCvInput(input);
  const body = [
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
  )} — CV</title><style>${CV_STYLE}</style></head><body><main class="cv">${body}</main></body></html>`;
}
