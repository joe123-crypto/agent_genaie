"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, RotateCcw, Sparkles, SquarePen } from "lucide-react";
import {
  CreateCvForm,
  type EducationRow,
  type ExperienceRow,
  type RefereeRow,
} from "../create-cv-form";
import {
  extractContact,
  extractEducation,
  extractExperience,
  extractReferee,
  extractSkills,
} from "@/src/domains/cv-interview";

type Role = "assistant" | "user";
type Message = { role: Role; text: string };

// Ordered interview stages. The looping stages (experience/education/referees)
// stay on the same stage until the user says "done"/"skip".
type Stage =
  | "name"
  | "contact"
  | "experience"
  | "education"
  | "skills"
  | "summary"
  | "referees"
  | "review";

const STAGE_ORDER: Stage[] = [
  "name",
  "contact",
  "experience",
  "education",
  "skills",
  "summary",
  "referees",
];

const STAGE_LABEL: Record<Stage, string> = {
  name: "Your details",
  contact: "Your details",
  experience: "Work experience",
  education: "Education",
  skills: "Skills",
  summary: "Summary",
  referees: "Referees",
  review: "Review",
};

type InterviewData = {
  fullName: string;
  email: string;
  phone: string;
  location: string;
  summary: string;
  skills: string;
  experience: ExperienceRow[];
  education: EducationRow[];
  referees: RefereeRow[];
};

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
  jobScoutPath: string;
  formPath: string;
  displayName?: string;
  email?: string;
};

export function CvInterview({ jobScoutPath, formPath, displayName = "", email = "" }: CvInterviewProps) {
  const firstPrompt = displayName
    ? `Hi! I'll help you build your CV just by chatting — no long forms. I've got your name as ${displayName}. Reply "yes" to keep it, or type your correct full name.`
    : `Hi! I'll help you build your CV just by chatting — no long forms. First up: what's your full name?`;

  const [messages, setMessages] = useState<Message[]>([{ role: "assistant", text: firstPrompt }]);
  const [stage, setStage] = useState<Stage>("name");
  const [phase, setPhase] = useState<"chat" | "review">("chat");
  const [draft, setDraft] = useState("");
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

  const stepIndex = Math.min(STAGE_ORDER.indexOf(stage), STAGE_ORDER.length - 1);
  const stepLabel =
    phase === "review"
      ? "Review your CV"
      : `${STAGE_LABEL[stage]} · ${stepIndex + 1} of ${STAGE_ORDER.length}`;

  function submitAnswer(rawText: string) {
    const text = rawText.trim();
    if (!text) return;

    const next: InterviewData = {
      ...data,
      experience: [...data.experience],
      education: [...data.education],
      referees: [...data.referees],
    };
    const replies: string[] = [];
    let nextStage: Stage = stage;

    switch (stage) {
      case "name": {
        next.fullName = displayName && isAffirm(text) ? displayName : text;
        const first = next.fullName.split(/\s+/)[0];
        replies.push(
          `Thanks${first ? `, ${first}` : ""}! What are your contact details? Share your email, phone number, and city in one message — or type "skip".`,
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
        replies.push(
          `Now your work experience. Tell me about a recent role in your own words — where you worked, your job title, and roughly when. For example: "I worked at ABC for 2 years as a frontend developer." Type "skip" if you'd rather add these later.`,
        );
        nextStage = "experience";
        break;
      }
      case "experience": {
        if (isDone(text) || isSkip(text)) {
          replies.push(
            `Great. Now education or certifications. Tell me about one — for example "BSc Computer Science at Trinity College, 2015-2018". Type "skip" if you have none.`,
          );
          nextStage = "education";
        } else {
          const row = extractExperience(text);
          next.experience.push(row);
          replies.push(`Got it — ${experienceEcho(row)}. Tell me about another role, or type "done" to move on.`);
        }
        break;
      }
      case "education": {
        if (isDone(text) || isSkip(text)) {
          replies.push(
            `What are your key skills? List a few separated by commas — for example "JavaScript, React, project management". Type "skip" to let Job Scout pick skills per job.`,
          );
          nextStage = "skills";
        } else {
          const row = extractEducation(text);
          next.education.push(row);
          replies.push(`Added — ${educationEcho(row)}. Add another qualification, or type "done".`);
        }
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
          `Almost done. Any referees? Share one per message — name, their role, company, email, and phone — or type "skip".`,
        );
        nextStage = "referees";
        break;
      }
      case "referees": {
        if (isDone(text) || isSkip(text)) {
          replies.push(
            `Perfect — I've filled in your CV from our chat. Review and tweak anything below, then hit "Create CV".`,
          );
          nextStage = "review";
          setPhase("review");
        } else {
          const row = extractReferee(text);
          next.referees.push(row);
          replies.push(`Noted — ${row.name || "that referee"}. Add another referee, or type "done".`);
        }
        break;
      }
      default:
        break;
    }

    setData(next);
    setStage(nextStage);
    setMessages((prev) => [
      ...prev,
      { role: "user", text },
      ...replies.map((reply) => ({ role: "assistant" as const, text: reply })),
    ]);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submitAnswer(draft);
    setDraft("");
    inputRef.current?.focus();
  }

  function handleRestart() {
    setMessages([{ role: "assistant", text: firstPrompt }]);
    setStage("name");
    setPhase("chat");
    setDraft("");
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
    return (
      <div className="cv-interview">
        <div className="chat-review-lead">
          <Sparkles aria-hidden="true" />
          <p>Here's your CV, built from our chat. Check each field, edit anything that needs fixing, then create it.</p>
        </div>
        <div className="chat-review-actions">
          <button type="button" className="button secondary" onClick={handleRestart}>
            <RotateCcw aria-hidden="true" />
            Start the interview over
          </button>
        </div>
        <CreateCvForm
          jobScoutPath={jobScoutPath}
          defaultFullName={data.fullName || displayName}
          defaultEmail={data.email || email}
          initialPhone={data.phone}
          initialLocation={data.location}
          initialSummary={data.summary}
          initialSkills={data.skills}
          initialExperience={data.experience}
          initialEducation={data.education}
          initialReferees={data.referees}
        />
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
        <span className="file-note">Prefer to type it all at once?</span>
        <a className="chat-switch-link" href={formPath}>
          <SquarePen aria-hidden="true" />
          Fill in the form instead
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
        />
        <button type="submit" className="chat-send" disabled={!draft.trim()} aria-label="Send">
          <ArrowUp aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}
