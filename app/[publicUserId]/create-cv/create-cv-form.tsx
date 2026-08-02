"use client";

import { useState } from "react";
import {
  AlignLeft,
  Briefcase,
  Building2,
  CalendarDays,
  FileCheck2,
  GraduationCap,
  Mail,
  MapPin,
  Phone,
  Plus,
  ScrollText,
  SquarePen,
  Tags,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { FieldLabel } from "@/app/_components/field-label";
import { StatusNotice, type StatusKind } from "@/app/_components/status-ui";

type ExperienceRow = {
  title: string;
  company: string;
  start: string;
  end: string;
  description: string;
};

type EducationRow = {
  degree: string;
  institution: string;
  start: string;
  end: string;
};

function emptyExperience(): ExperienceRow {
  return { title: "", company: "", start: "", end: "", description: "" };
}

function emptyEducation(): EducationRow {
  return { degree: "", institution: "", start: "", end: "" };
}

type CreateCvFormProps = {
  jobScoutPath: string;
  defaultFullName?: string;
  defaultEmail?: string;
};

export function CreateCvForm({ jobScoutPath, defaultFullName = "", defaultEmail = "" }: CreateCvFormProps) {
  const [fullName, setFullName] = useState(defaultFullName);
  const [email, setEmail] = useState(defaultEmail);
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");
  const [summary, setSummary] = useState("");
  const [experience, setExperience] = useState<ExperienceRow[]>([emptyExperience()]);
  const [education, setEducation] = useState<EducationRow[]>([emptyEducation()]);
  const [skills, setSkills] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: StatusKind; message: string } | null>(null);

  function updateExperience(index: number, patch: Partial<ExperienceRow>) {
    setExperience((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function updateEducation(index: number, patch: Partial<EducationRow>) {
    setEducation((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!fullName.trim()) {
      setNotice({ kind: "error", message: "Please enter your full name." });
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
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || `Request failed with ${response.status}`);
      }
      setNotice({ kind: "complete", message: "CV created. Returning to Job Scout setup..." });
      window.location.assign(jobScoutPath);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not create your CV.";
      setNotice({ kind: "error", message });
      setBusy(false);
    }
  }

  return (
    <form className="form-stack" onSubmit={handleSubmit}>
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
              <FieldLabel icon={AlignLeft}>Description</FieldLabel>
              <textarea
                value={row.description}
                onChange={(event) => updateExperience(index, { description: event.target.value })}
                maxLength={4000}
                placeholder="What you did and achieved in this role."
              />
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

      <label>
        <FieldLabel icon={Tags}>Skills</FieldLabel>
        <input
          value={skills}
          onChange={(event) => setSkills(event.target.value)}
          maxLength={1000}
          placeholder="e.g. JavaScript, React, Project management"
        />
        <span className="file-note">Separate skills with commas.</span>
      </label>

      <div className="actions">
        <button type="submit" disabled={busy}>
          <FileCheck2 aria-hidden="true" />
          {busy ? "Creating CV..." : "Create CV"}
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
