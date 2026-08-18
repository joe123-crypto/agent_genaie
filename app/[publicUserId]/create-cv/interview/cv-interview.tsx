"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, RotateCcw, Sparkles, SquarePen } from "lucide-react";
import type {
  EducationRow,
  ExperienceRow,
  RefereeRow,
} from "../create-cv-form";
import { saveCvDraft, type CvDraft } from "../cv-draft";
import {
  extractContact,
  extractDateRange,
  extractEducation,
  extractExperience,
  extractReferee,
  extractSkills,
} from "@/src/domains/cv-interview";

type Role = "assistant" | "user";
type Message = { role: Role; text: string };

// Ordered interview stages. Each section is split into short sub-stages so the
// scripted fallback never asks for more than two fields in one turn (mirroring the
// AI prompt). The looping stages stay on the same section until the user says
// "done"/"skip"; sub-stages (…_dates, referee_*) collect the rest of one record.
type Stage =
  | "name"
  | "contact"
  | "city"
  | "experience"
  | "experience_dates"
  | "education"
  | "education_dates"
  | "skills"
  | "summary"
  | "referees"
  | "referee_company"
  | "referee_contact"
  | "review";

const STAGE_ORDER: Stage[] = [
  "name",
  "contact",
  "city",
  "experience",
  "experience_dates",
  "education",
  "education_dates",
  "skills",
  "summary",
  "referees",
  "referee_company",
  "referee_contact",
];

// Sub-stages share their section's label so the progress chip reads by section.
const STAGE_LABEL: Record<Stage, string> = {
  name: "Your details",
  contact: "Your details",
  city: "Your details",
  experience: "Work experience",
  experience_dates: "Work experience",
  education: "Education",
  education_dates: "Education",
  skills: "Skills",
  summary: "Summary",
  referees: "Referees",
  referee_company: "Referees",
  referee_contact: "Referees",
  review: "Review",
};

// Section-entry prompts pushed from more than one place, kept as constants so the
// wording stays in one spot.
const EXPERIENCE_PROMPT =
  'Now your work experience. What was your most recent job title, and which company? For example "Software Engineer at ABC". Type "skip" to add these later.';
const EDUCATION_PROMPT =
  'Now education or certifications. What\'s the qualification, and where did you get it? For example "BSc Computer Science at Trinity College". Type "skip" if you have none.';
const SKILLS_PROMPT =
  'What are your key skills? List a few separated by commas — for example "JavaScript, React, project management". Type "skip" to let Job Scout pick skills per job.';
const REVIEW_PROMPT =
  'Perfect — I\'ve filled in your CV from our chat. Review and tweak anything below, then hit "Create CV".';

// The interview collects exactly the shape the /create-cv form consumes; it is
// handed over verbatim through sessionStorage (see ../cv-draft).
type InterviewData = CvDraft;

function s(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// The first still-empty stage. Used to resume the scripted flow from where the AI
// left off if it ever drops mid-session, instead of restarting at "name".
function stageFromData(data: InterviewData): Stage {
  if (!s(data.fullName).trim()) return "name";
  if (!s(data.email).trim() && !s(data.phone).trim() && !s(data.location).trim()) return "contact";
  if (!Array.isArray(data.experience) || data.experience.length === 0) return "experience";
  if (!Array.isArray(data.education) || data.education.length === 0) return "education";
  if (!s(data.skills).trim()) return "skills";
  if (!s(data.summary).trim()) return "summary";
  return "referees";
}

// Merge an AI-returned CV over the current one without losing earlier answers:
// keep a new scalar only when non-empty, and a new list only when non-empty.
function mergeInterviewData(current: InterviewData, incoming: InterviewData): InterviewData {
  const pick = (next: unknown, prev: string) => (s(next).trim() ? s(next) : prev);
  const list = <T,>(next: unknown, prev: T[]) =>
    Array.isArray(next) && next.length ? (next as T[]) : prev;
  return {
    fullName: pick(incoming.fullName, current.fullName),
    email: pick(incoming.email, current.email),
    phone: pick(incoming.phone, current.phone),
    location: pick(incoming.location, current.location),
    summary: pick(incoming.summary, current.summary),
    skills: pick(incoming.skills, current.skills),
    experience: list(incoming.experience, current.experience),
    education: list(incoming.education, current.education),
    referees: list(incoming.referees, current.referees),
  };
}

const DONE_RE = /^(done|finished|complete|that'?s all|no more|nothing else|that is all)\b/i;
const SKIP_RE = /^(skip|none|no|nope|n\/?a|pass|not now)\b/i;
const AFFIRM_RE = /^(yes|yep|yeah|correct|right|keep|ok|okay|sure|confirmed|y)\b/i;

function isDone(text: string) {
  return DONE_RE.test(text.trim());
}
function isSkip(text: string) {
  return SKIP_RE.test(text.trim());
}
function isAffirm(text: string) {
  return AFFIRM_RE.test(text.trim());
}

function formatRange(start: string, end: string) {
  if (start && end) return ` (${start} – ${end})`;
  if (start) return ` (${start})`;
  return "";
}

function experienceEcho(row: ExperienceRow) {
  const head = [row.title, row.company && `at ${row.company}`].filter(Boolean).join(" ") || "that role";
  return `${head}${formatRange(row.start, row.end)}`;
}

function educationEcho(row: EducationRow) {
  const head =
    [row.degree, row.institution && `at ${row.institution}`].filter(Boolean).join(" ") ||
    "that qualification";
  return `${head}${formatRange(row.start, row.end)}`;
}

function initialsFrom(name: string, email: string) {
  const source = name.trim() || email.trim();
  if (!source) return "You";
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

type CvInterviewProps = {
  formPath: string;
  displayName?: string;
  email?: string;
};

export function CvInterview({ formPath, displayName = "", email = "" }: CvInterviewProps) {
  const firstPrompt = displayName
    ? `Hi! I'll help you build your CV just by chatting — no long forms. I've got your name as ${displayName}. Reply "yes" to keep it, or type your correct full name.`
    : `Hi! I'll help you build your CV just by chatting — no long forms. First up: what's your full name?`;

  const [messages, setMessages] = useState<Message[]>([{ role: "assistant", text: firstPrompt }]);
  const [stage, setStage] = useState<Stage>("name");
  const [phase, setPhase] = useState<"chat" | "review">("chat");
  const [draft, setDraft] = useState("");
  // The interview is AI-driven by default. If a turn can't be served by the
  // server (no OpenRouter key, or an API/parse failure), we flip aiAvailable off
  // and finish the session on the scripted flow — the user shouldn't notice.
  const [aiAvailable, setAiAvailable] = useState(true);
  // True while an AI turn is in flight; drives the "typing…" bubble and disables
  // the composer so answers can't race ahead of the assistant.
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<InterviewData>({
    fullName: displayName,
    email,
    phone: "",
    location: "",
    summary: "",
    skills: "",
    experience: [],
    education: [],
    referees: [],
  });

  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const userName = displayName || email || "You";
  const userInitials = useMemo(() => initialsFrom(displayName, email), [displayName, email]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  // When the interview completes, hand the collected CV to the /create-cv form
  // page for review: stash it in sessionStorage (too large for the URL) and
  // navigate there with ?from=interview so the form hydrates it. The form is now
  // the review-and-edit step, and pricing follows it.
  useEffect(() => {
    if (phase !== "review") return;
    saveCvDraft(data);
    const separator = formPath.includes("?") ? "&" : "?";
    window.location.assign(`${formPath}${separator}from=interview`);
  }, [phase, formPath, data]);

  const stepIndex = Math.min(STAGE_ORDER.indexOf(stage), STAGE_ORDER.length - 1);
  const stepLabel =
    phase === "review"
      ? "Review your CV"
      : aiAvailable
        ? "AI interview"
        : `${STAGE_LABEL[stage]} · ${stepIndex + 1} of ${STAGE_ORDER.length}`;

  // The scripted state machine — the fallback that runs when the AI is
  // unavailable. The user's message has already been appended by submitAnswer,
  // so this only computes the assistant's reply, the updated data, and the next
  // stage. (Unchanged from the original rule-based flow, minus the user append.)
  function scriptedTurn(text: string, fromStage: Stage = stage) {
    const next: InterviewData = {
      ...data,
      experience: [...data.experience],
      education: [...data.education],
      referees: [...data.referees],
    };
    const replies: string[] = [];
    let nextStage: Stage = fromStage;

    switch (fromStage) {
      case "name": {
        next.fullName = displayName && isAffirm(text) ? displayName : text;
        const first = next.fullName.split(/\s+/)[0];
        replies.push(
          `Thanks${first ? `, ${first}` : ""}! What's your email address and phone number?`,
        );
        nextStage = "contact";
        break;
      }
      case "contact": {
        if (!isSkip(text)) {
          const c = extractContact(text);
          if (c.email) next.email = c.email;
          if (c.phone) next.phone = c.phone;
          if (c.location) next.location = c.location;
        }
        // Skipped, or the user already volunteered a city — move on; otherwise
        // ask for the city on its own (one field per turn).
        if (isSkip(text) || next.location.trim()) {
          replies.push(EXPERIENCE_PROMPT);
          nextStage = "experience";
        } else {
          replies.push(`And which city are you based in?`);
          nextStage = "city";
        }
        break;
      }
      case "city": {
        if (!isSkip(text)) {
          // Bare city answers ("Bindura") don't match the contact location
          // pattern, so fall back to the raw answer.
          const c = extractContact(text);
          next.location = c.location || text.trim();
        }
        replies.push(EXPERIENCE_PROMPT);
        nextStage = "experience";
        break;
      }
      case "experience": {
        if (isDone(text) || isSkip(text)) {
          replies.push(EDUCATION_PROMPT);
          nextStage = "education";
        } else {
          // Collect title & company now; dates come next. Drop the free-form
          // description so the raw "title at company" line isn't dumped into it.
          const row = extractExperience(text);
          next.experience.push({ title: row.title, company: row.company, start: "", end: "", description: "" });
          replies.push(
            `Got it — ${experienceEcho(next.experience[next.experience.length - 1])}. When did you start and finish there? For example "Jan 2020 to 2022".`,
          );
          nextStage = "experience_dates";
        }
        break;
      }
      case "experience_dates": {
        const rows = next.experience;
        if (rows.length) {
          const { start, end } = extractDateRange(text);
          rows[rows.length - 1] = { ...rows[rows.length - 1], start, end };
        }
        replies.push(`Any other roles? Give the job title and company, or type "done".`);
        nextStage = "experience";
        break;
      }
      case "education": {
        if (isDone(text) || isSkip(text)) {
          replies.push(SKILLS_PROMPT);
          nextStage = "skills";
        } else {
          const row = extractEducation(text);
          next.education.push({ degree: row.degree, institution: row.institution, start: "", end: "", description: "" });
          replies.push(
            `Added — ${educationEcho(next.education[next.education.length - 1])}. What were the dates? For example "2015 to 2018".`,
          );
          nextStage = "education_dates";
        }
        break;
      }
      case "education_dates": {
        const rows = next.education;
        if (rows.length) {
          const { start, end } = extractDateRange(text);
          rows[rows.length - 1] = { ...rows[rows.length - 1], start, end };
        }
        replies.push(`Any other qualifications? Give the qualification and institution, or type "done".`);
        nextStage = "education";
        break;
      }
      case "skills": {
        if (!isSkip(text)) {
          next.skills = extractSkills(text).join(", ");
        }
        replies.push(
          `Would you like a short professional summary? Type a sentence or two about yourself, or "skip" and Job Scout will write one tailored to each application.`,
        );
        nextStage = "summary";
        break;
      }
      case "summary": {
        if (!isSkip(text)) {
          next.summary = text;
        }
        replies.push(
          `Almost done. Any referees? What's the first referee's name and their job title? Or type "skip".`,
        );
        nextStage = "referees";
        break;
      }
      case "referees": {
        if (isDone(text) || isSkip(text)) {
          replies.push(REVIEW_PROMPT);
          nextStage = "review";
          setPhase("review");
        } else {
          const row = extractReferee(text);
          next.referees.push({ name: row.name || text.trim(), position: row.position, company: "", email: "", phone: "" });
          replies.push(
            `Noted — ${next.referees[next.referees.length - 1].name || "that referee"}. Which company or organisation are they at?`,
          );
          nextStage = "referee_company";
        }
        break;
      }
      case "referee_company": {
        const rows = next.referees;
        if (rows.length && !isSkip(text)) {
          rows[rows.length - 1] = { ...rows[rows.length - 1], company: text.trim() };
        }
        replies.push(`And their email and phone number?`);
        nextStage = "referee_contact";
        break;
      }
      case "referee_contact": {
        const rows = next.referees;
        if (rows.length && !isSkip(text)) {
          const c = extractContact(text);
          rows[rows.length - 1] = { ...rows[rows.length - 1], email: c.email, phone: c.phone };
        }
        replies.push(`Any other referees? Give their name and job title, or type "done".`);
        nextStage = "referees";
        break;
      }
      default:
        break;
    }

    setData(next);
    setStage(nextStage);
    setMessages((prev) => [
      ...prev,
      ...replies.map((reply) => ({ role: "assistant" as const, text: reply })),
    ]);
  }

  // The primary path: append the user's turn, then let the AI drive. On any
  // server failure, downgrade to the scripted flow for this turn and the rest of
  // the session so the conversation continues seamlessly.
  async function submitAnswer(rawText: string) {
    const text = rawText.trim();
    if (!text || busy) return;

    const history: Message[] = [...messages, { role: "user", text }];
    setMessages(history);

    if (!aiAvailable) {
      scriptedTurn(text);
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/job-scout/cv/interview", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, data }),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload.ok) {
        // Merge (don't replace) so a turn that omits an earlier field can't wipe it.
        setData((prev) => mergeInterviewData(prev, payload.data as InterviewData));
        setMessages((prev) => [...prev, { role: "assistant", text: String(payload.reply) }]);
        if (payload.complete) setPhase("review");
        return;
      }
    } catch {
      // network error — fall through to the scripted flow
    } finally {
      setBusy(false);
    }

    // AI unavailable or errored: finish on the scripted machine, resuming from
    // where the AI got to (not restarting at "name") so the handoff stays coherent.
    setAiAvailable(false);
    const seeded = stageFromData(data);
    setStage(seeded);
    scriptedTurn(text, seeded);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    submitAnswer(draft);
    setDraft("");
    inputRef.current?.focus();
  }

  function handleRestart() {
    setMessages([{ role: "assistant", text: firstPrompt }]);
    setStage("name");
    setPhase("chat");
    setDraft("");
    setAiAvailable(true);
    setBusy(false);
    setData({
      fullName: displayName,
      email,
      phone: "",
      location: "",
      summary: "",
      skills: "",
      experience: [],
      education: [],
      referees: [],
    });
  }

  if (phase === "review") {
    // The chat is done; the handoff effect above is navigating to the /create-cv
    // form where the user reviews and edits before creating the CV.
    return (
      <div className="cv-interview">
        <div className="chat-review-lead">
          <Sparkles aria-hidden="true" />
          <p>Preparing your CV — taking you to review and edit it…</p>
        </div>
      </div>
    );
  }

  const lastAssistantIndex = messages.reduce(
    (acc, message, index) => (message.role === "assistant" ? index : acc),
    -1,
  );

  return (
    <div className="cv-interview">
      <div className="chat-switch">
        <a className="chat-switch-link" href={formPath}>
          <SquarePen aria-hidden="true" />
          Use the form instead
        </a>
      </div>

      <div className="chat-step-chip">{stepLabel}</div>

      <div className="chat-thread" aria-live="polite">
        {messages.map((message, index) => (
          <div className="chat-turn" data-role={message.role} key={index}>
            <span className="chat-avatar" aria-hidden="true">
              {message.role === "assistant" ? <Sparkles /> : userInitials}
            </span>
            <div className="chat-main">
              <div className="chat-name">{message.role === "assistant" ? "Genaie" : userName}</div>
              <div className="chat-body">{message.text}</div>
              {message.role === "assistant" && index === lastAssistantIndex && messages.length > 1 ? (
                <div className="chat-actions">
                  <button type="button" className="chat-action" onClick={handleRestart}>
                    <RotateCcw aria-hidden="true" />
                    Start over
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ))}
        {busy ? (
          <div className="chat-turn" data-role="assistant">
            <span className="chat-avatar" aria-hidden="true">
              <Sparkles />
            </span>
            <div className="chat-main">
              <div className="chat-name">Genaie</div>
              <div className="chat-body chat-typing">Typing…</div>
            </div>
          </div>
        ) : null}
        <div ref={threadEndRef} />
      </div>

      <form className="chat-composer" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          className="chat-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Type your answer…"
          maxLength={4000}
          autoComplete="off"
          aria-label="Your answer"
          disabled={busy}
        />
        <button type="submit" className="chat-send" disabled={busy || !draft.trim()} aria-label="Send">
          <ArrowUp aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}
