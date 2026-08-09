// Deterministic, rule-based extraction that turns a free-text interview answer
// into the same structured shapes the Create CV form collects. There is no LLM
// here — the "AI interview" is a scripted question flow (see cv-interview.tsx)
// plus these heuristics. Extraction is best-effort by design: the interview
// hands the parsed values to the existing Create CV form for the user to review
// and correct before anything is saved, so wrong splits are recoverable.
//
// Kept free of server-only imports (no firebase-admin, no src/lib/utils) so the
// client interview component can import it directly. Types are imported
// type-only from cv-html so the row shapes never drift from what buildCvHtml
// consumes.
import type {
  CvExperienceInput,
  CvEducationInput,
  CvRefereeInput,
} from "@/src/domains/cv-html";

export type ExtractedExperience = {
  title: string;
  company: string;
  start: string;
  end: string;
  description: string;
};

export type ExtractedEducation = {
  degree: string;
  institution: string;
  start: string;
  end: string;
  description: string;
};

export type ExtractedReferee = {
  name: string;
  position: string;
  company: string;
  email: string;
  phone: string;
};

export type ExtractedContact = {
  email: string;
  phone: string;
  location: string;
};

// Compile-time guarantee that the shapes above stay assignable to what the CV
// builder accepts. (Values are unused; this only exercises the types.)
const _experienceShape: CvExperienceInput = {} as ExtractedExperience;
const _educationShape: CvEducationInput = {} as ExtractedEducation;
const _refereeShape: CvRefereeInput = {} as ExtractedReferee;
void _experienceShape;
void _educationShape;
void _refereeShape;

const CURRENT_YEAR = new Date().getFullYear();

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

const MONTH_ALT =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t)?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

// Role nouns that let us recover a job title even when the sentence has no
// explicit "as a …" clause (e.g. "I was a frontend developer at ABC").
const ROLE_NOUN =
  "developer|engineer|designer|manager|analyst|consultant|lead|director|officer|administrator|administrator|specialist|intern|scientist|architect|accountant|nurse|teacher|technician|coordinator|assistant|associate|marketer|recruiter|writer|editor|researcher|supervisor|strategist|advisor|agent|clerk|cashier|chef|driver|salesperson|representative|founder|freelancer";

// Degree/qualification openers used to spot the "degree" phrase in an answer.
const DEGREE_WORD =
  "b\\.?sc|b\\.?a|b\\.?eng|bachelor(?:'?s)?|m\\.?sc|m\\.?a|m\\.?eng|mba|master(?:'?s)?|ph\\.?d|doctorate|hnd|nd|diploma|certificate|certification|associate|foundation|a-?levels?|high\\s+school|gcse";

const CONNECTORS = /^(?:and|&|the|of|at|for|from|in|on|with|a|an)$/i;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_RE = /\+?\d[\d\s().-]{6,}\d/;

function firstEmail(text: string): string {
  return text.match(EMAIL_RE)?.[0] ?? "";
}

function firstPhone(text: string): string {
  return (text.match(PHONE_RE)?.[0] ?? "").replace(/[.,;\s]+$/g, "").trim();
}

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

// Trim leading/trailing connector words and stray punctuation from a captured
// name-ish phrase (company, institution) without touching its inner words.
function trimPhrase(value: string): string {
  let words = clean(value)
    .replace(/[,.;:]+$/g, "")
    .split(" ")
    .filter(Boolean);
  while (words.length && CONNECTORS.test(words[0])) words = words.slice(1);
  while (words.length && CONNECTORS.test(words[words.length - 1])) words = words.slice(0, -1);
  return words.slice(0, 6).join(" ");
}

// --- dates ---------------------------------------------------------------

function normalizeEndWord(value: string): string {
  return /^(present|current|now|ongoing|to date|till date|todate)$/i.test(value.trim())
    ? "Present"
    : "";
}

function formatMonthYear(month: string, year: string): string {
  const key = month.toLowerCase().replace(/\./g, "");
  const idx = MONTHS[key];
  if (!idx) return year;
  const label = key.slice(0, 3);
  return `${label.charAt(0).toUpperCase()}${label.slice(1)} ${year}`;
}

export function extractDateRange(text: string): { start: string; end: string } {
  const source = text || "";

  // Month-Year ranges, e.g. "Jan 2020 - March 2022" / "Jan 2020 to present".
  const monthRange = new RegExp(
    `\\b(${MONTH_ALT})\\.?\\s+(\\d{4})\\s*(?:-|–|—|to|until|till|through)\\s*(?:(${MONTH_ALT})\\.?\\s+)?(\\d{4}|present|current|now|ongoing)`,
    "i",
  );
  const m1 = source.match(monthRange);
  if (m1) {
    const start = formatMonthYear(m1[1], m1[2]);
    const endWord = normalizeEndWord(m1[4]);
    const end = endWord || (m1[3] ? formatMonthYear(m1[3], m1[4]) : m1[4]);
    return { start, end };
  }

  // Plain year ranges, e.g. "2018-2022", "2020 to present".
  const yearRange = source.match(
    /\b(\d{4})\s*(?:-|–|—|to|until|till|through)\s*(\d{4}|present|current|now|ongoing)\b/i,
  );
  if (yearRange) {
    const endWord = normalizeEndWord(yearRange[2]);
    return { start: yearRange[1], end: endWord || yearRange[2] };
  }

  // "since 2021" / "from 2019" / "since Jan 2021".
  const since = source.match(
    new RegExp(`\\b(?:since|from)\\s+(?:(${MONTH_ALT})\\.?\\s+)?(\\d{4})\\b`, "i"),
  );
  if (since) {
    const start = since[1] ? formatMonthYear(since[1], since[2]) : since[2];
    return { start, end: "Present" };
  }

  // Duration, e.g. "for 2 years" / "for 18 months" → approximate from today.
  const duration = source.match(/\bfor\s+(\d{1,2})\s+(year|yr|month|mo)s?\b/i);
  if (duration) {
    const n = Number.parseInt(duration[1], 10);
    const unit = duration[2].toLowerCase();
    const years = unit.startsWith("y") ? n : Math.max(1, Math.round(n / 12));
    const startYear = CURRENT_YEAR - years;
    return { start: String(startYear), end: "Present" };
  }

  // A single month-year, e.g. "started in Jan 2022".
  const monthYear = source.match(new RegExp(`\\b(${MONTH_ALT})\\.?\\s+(\\d{4})\\b`, "i"));
  if (monthYear) {
    return { start: formatMonthYear(monthYear[1], monthYear[2]), end: "" };
  }

  // A lone year.
  const singleYear = source.match(/\b(\d{4})\b/);
  if (singleYear) {
    return { start: singleYear[1], end: "" };
  }

  return { start: "", end: "" };
}

// --- helpers for "at <Company>" / role phrases ---------------------------

// Capture the noun phrase after a keyword ("at", "from", "for") up to the next
// clause boundary. Requires the phrase to start with a capital/number so we
// pick up real names (Google, ABC, 10 Downing) and not filler.
function captureAfter(text: string, keyword: string): string {
  const re = new RegExp(
    `\\b${keyword}\\s+([A-Z0-9][^,.;\\n]*?)(?=\\s+(?:for|as|from|since|between|during|where|working|until|till|and\\s+i|in\\s+\\d)\\b|[,.;\\n]|$)`,
  );
  const match = text.match(re);
  return match ? trimPhrase(match[1]) : "";
}

function captureRole(text: string): string {
  // "as a frontend developer" / "as an analyst".
  const asRole = text.match(
    /\bas\s+(?:an?\s+)?([a-z][\w /+&-]*?)(?=\s+(?:at|for|from|since|in|with)\b|[,.;\n]|$)/i,
  );
  if (asRole) return trimPhrase(asRole[1]);

  // "I was a senior frontend developer" — a role noun with its modifiers.
  const roleNoun = text.match(
    new RegExp(`\\b((?:[A-Za-z/+-]+\\s+){0,3}(?:${ROLE_NOUN}))\\b`, "i"),
  );
  if (roleNoun) return trimPhrase(roleNoun[1]);

  return "";
}

// --- public extractors ---------------------------------------------------

export function extractExperience(text: string): ExtractedExperience {
  const source = clean(text);
  const { start, end } = extractDateRange(source);
  const forPhrase = captureAfter(source, "for");
  const company =
    captureAfter(source, "at") ||
    captureAfter(source, "with") ||
    // "for Google" is a company; "for 2 years" is a duration — reject the latter.
    (/^\d+\s+(?:year|yr|month|mo)/i.test(forPhrase) ? "" : forPhrase);
  const title = captureRole(source);
  return {
    title,
    company,
    start,
    end,
    // Keep the user's own words so nothing is lost; the review form lets them
    // trim it, and buildCvHtml renders it as the entry's paragraph.
    description: source,
  };
}

export function extractEducation(text: string): ExtractedEducation {
  const source = clean(text);
  const { start, end } = extractDateRange(source);

  const degreeMatch = source.match(
    new RegExp(`\\b((?:${DEGREE_WORD})[^,.;\\n]*?)(?=\\s+(?:at|from|in\\s+\\d)\\b|[,.;\\n]|$)`, "i"),
  );
  const degree = degreeMatch ? trimPhrase(degreeMatch[1]) : "";

  const institution =
    captureAfter(source, "at") || captureAfter(source, "from") || captureAfter(source, "with");

  return {
    degree,
    institution,
    start,
    end,
    description: source,
  };
}

export function extractSkills(text: string): string[] {
  const withoutPreamble = (text || "").replace(
    /^[^:]*?\b(?:are|is|include(?:s)?|:|good at|skilled in|proficient in|experienced in|know|use)\b[:\s]*/i,
    "",
  );
  const parts = withoutPreamble
    .split(/,|;|\band\b|&|\n|·|•|\//gi)
    .map((part) => clean(part))
    .filter(Boolean);

  const output: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const skill = part.replace(/[.]+$/g, "").trim();
    if (!skill || skill.length > 60) continue;
    const key = skill.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(skill);
  }
  return output;
}

export function extractContact(text: string): ExtractedContact {
  const source = text || "";
  const email = firstEmail(source);
  const phone = firstPhone(source);

  let location = "";
  const loc = source.match(
    /\b(?:based in|live in|living in|located in|from|in)\s+([A-Z][\w .'-]*(?:,\s*[A-Z][\w .'-]*)?)/,
  );
  if (loc) location = trimPhraseKeepCommas(loc[1]);

  return { email, phone, location };
}

// Location can legitimately contain a comma ("Lagos, Nigeria"), so trim
// connectors/punctuation without collapsing on the comma the way trimPhrase does.
function trimPhraseKeepCommas(value: string): string {
  return clean(value).replace(/[.;:]+$/g, "").split(" ").slice(0, 6).join(" ");
}

export function extractReferee(text: string): ExtractedReferee {
  const source = clean(text);
  const email = firstEmail(source);
  const phone = firstPhone(source);

  // Name: leading run of capitalized words (before the first comma/clause).
  const nameMatch = source.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z'.-]+){0,3})/);
  const name = nameMatch ? trimPhrase(nameMatch[1]) : "";

  const company = captureAfter(source, "at") || captureAfter(source, "from");
  const position = captureRole(source);

  return { name, position, company, email, phone };
}
