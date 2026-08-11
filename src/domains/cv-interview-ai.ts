// The LLM-driven side of the CV interview. The scripted flow in cv-interview.ts
// (and cv-interview.tsx) stays the fallback; this module is what runs when
// OpenRouter is available. It keeps the prompt and — more importantly — the
// defensive JSON parsing out of the route so both can be unit-tested.
//
// Row shapes are reused from cv-interview.ts so what the model produces stays
// assignable to what CreateCvForm / buildCvHtml consume. Server-only (imports
// the OpenRouter client), but free of firebase-admin so it can be tested in
// isolation.
import type {
  ExtractedExperience,
  ExtractedEducation,
  ExtractedReferee,
} from "@/src/domains/cv-interview";
import { openRouterChat, type ChatMessage } from "@/src/lib/openrouter";

// The full running CV, identical in shape to the client's InterviewData. The
// model returns this whole object every turn; the client replaces its state with
// it so the review form stays populated.
export type InterviewData = {
  fullName: string;
  email: string;
  phone: string;
  location: string;
  summary: string;
  skills: string;
  experience: ExtractedExperience[];
  education: ExtractedEducation[];
  referees: ExtractedReferee[];
};

export type InterviewMessage = { role: "assistant" | "user"; text: string };

export type InterviewTurn = {
  reply: string;
  data: InterviewData;
  complete: boolean;
};

export const SYSTEM_PROMPT = `You are Genaie, an assistant that builds a user's CV by chatting with them. Your ONLY job is to collect the facts below as fast as possible, then stop.

Collect: full name; contact (email, phone, city); work experience (title, company, start, end); education/certifications (degree, institution, start, end); referees (name, position, company, email, phone).

Do NOT ask for skills, the professional summary, or descriptions of work experience or education. Those are optional — Job Scout fills them in automatically, tailored to each job, when it applies. Only record them if the user volunteers them; otherwise leave those fields empty and never prompt for them.

Rules:
- Be brief. No greetings, no filler, no praise, no restating their answers. One short question per turn.
- Batch naturally-grouped fields into a single question (e.g. ask for email, phone and city together).
- Never ask about or re-confirm anything already present in collectedSoFar — move straight to the next missing field.
- Accept "skip"/"none"/"done" to move past optional sections (referees) or to stop adding more experience/education/referees.
- Experience, education and referees are lists — keep asking "another?" only until the user is done, then move on.
- Skills, the professional summary, and all experience/education descriptions are optional; leave them empty unless the user offers them (the system fills them later per application).

Output ONLY the JSON object — no prose before or after it, no markdown code fences, no reasoning. Reply with a single JSON object and nothing else:
{
  "reply": "<your next message to the user>",
  "data": {
    "fullName": "", "email": "", "phone": "", "location": "", "summary": "", "skills": "",
    "experience": [{"title":"","company":"","start":"","end":"","description":""}],
    "education": [{"degree":"","institution":"","start":"","end":"","description":""}],
    "referees": [{"name":"","position":"","company":"","email":"","phone":""}]
  },
  "complete": false
}
"data" must ALWAYS be the COMPLETE CV collected so far: copy every field already in collectedSoFar and merge the user's new answer into it. Never drop or blank a field you were previously given. Set "complete" to true only once you have the essentials (at least a full name) and the user has nothing more to add; in that turn "reply" should tell them their CV is ready to review.`;

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// Keep only rows that carry at least one real value, and force every field to a
// trimmed string so the shape always matches what the CV builder expects. A
// model that emits an all-empty placeholder row (as our prompt example shows)
// contributes nothing.
function normalizeExperience(value: unknown): ExtractedExperience[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => {
      const r = (row ?? {}) as Record<string, unknown>;
      return {
        title: str(r.title),
        company: str(r.company),
        start: str(r.start),
        end: str(r.end),
        description: str(r.description),
      };
    })
    .filter((r) => r.title || r.company || r.description || r.start || r.end);
}

function normalizeEducation(value: unknown): ExtractedEducation[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => {
      const r = (row ?? {}) as Record<string, unknown>;
      return {
        degree: str(r.degree),
        institution: str(r.institution),
        start: str(r.start),
        end: str(r.end),
        description: str(r.description),
      };
    })
    .filter((r) => r.degree || r.institution || r.description || r.start || r.end);
}

function normalizeReferees(value: unknown): ExtractedReferee[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => {
      const r = (row ?? {}) as Record<string, unknown>;
      return {
        name: str(r.name),
        position: str(r.position),
        company: str(r.company),
        email: str(r.email),
        phone: str(r.phone),
      };
    })
    .filter((r) => r.name || r.position || r.company || r.email || r.phone);
}

function normalizeData(value: unknown): InterviewData {
  const d = (value ?? {}) as Record<string, unknown>;
  return {
    fullName: str(d.fullName),
    email: str(d.email),
    phone: str(d.phone),
    location: str(d.location),
    summary: str(d.summary),
    skills: str(d.skills),
    experience: normalizeExperience(d.experience),
    education: normalizeEducation(d.education),
    referees: normalizeReferees(d.referees),
  };
}

// Pull the JSON object out of the model's reply and normalize it. Tolerates code
// fences and leading/trailing prose by grabbing the outermost {...}. Throws when
// no usable object or no "reply" text can be found, so the route falls back to
// the scripted flow rather than showing the user a broken turn.
export function parseInterviewTurn(raw: string): InterviewTurn {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) {
      throw new Error("No JSON object found in interview completion.");
    }
    parsed = JSON.parse(text.slice(start, end + 1));
  }

  const obj = (parsed ?? {}) as Record<string, unknown>;
  const reply = str(obj.reply);
  if (!reply) {
    throw new Error("Interview completion is missing a reply.");
  }
  return {
    reply,
    data: normalizeData(obj.data),
    complete: obj.complete === true,
  };
}

// Runs one interview turn: hands the model everything collected so far plus the
// transcript, and returns its next question and the updated CV. Throws on any
// OpenRouter or parse failure (the route converts that into the scripted flow).
export async function runCvInterviewTurn(
  history: InterviewMessage[],
  data: InterviewData,
): Promise<InterviewTurn> {
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: JSON.stringify({ collectedSoFar: data, transcript: history }),
    },
  ];
  const raw = await openRouterChat(messages, { json: true });
  return parseInterviewTurn(raw);
}
