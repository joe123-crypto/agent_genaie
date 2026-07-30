"use client";

import { useState } from "react";
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
          Full name
          <input
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            maxLength={120}
            autoComplete="name"
            required
          />
        </label>
        <label>
          Email
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
          Phone
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            maxLength={60}
            autoComplete="tel"
          />
        </label>
        <label>
          Location
          <input
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            maxLength={120}
            autoComplete="address-level2"
          />
        </label>
      </div>

      <label>
        Professional summary
        <textarea
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          maxLength={4000}
          placeholder="A short paragraph about your experience and goals."
        />
      </label>

      <div className="cv-section-head">
        <h2>Work experience</h2>
        <button
          type="button"
          className="button secondary"
          onClick={() => setExperience((rows) => [...rows, emptyExperience()])}
        >
          Add experience
        </button>
      </div>
      <div className="cv-entries">
        {experience.map((row, index) => (
          <div className="cv-entry" key={index}>
            <div className="grid">
              <label>
                Job title
                <input
                  value={row.title}
                  onChange={(event) => updateExperience(index, { title: event.target.value })}
                  maxLength={200}
                />
              </label>
              <label>
                Company
                <input
                  value={row.company}
                  onChange={(event) => updateExperience(index, { company: event.target.value })}
                  maxLength={200}
                />
              </label>
            </div>
            <div className="grid">
              <label>
                Start
                <input
                  value={row.start}
                  onChange={(event) => updateExperience(index, { start: event.target.value })}
                  maxLength={60}
                  placeholder="Jan 2022"
                />
              </label>
              <label>
                End
                <input
                  value={row.end}
                  onChange={(event) => updateExperience(index, { end: event.target.value })}
                  maxLength={60}
                  placeholder="Present"
                />
              </label>
            </div>
            <label>
              Description
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
                  Remove
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="cv-section-head">
        <h2>Education</h2>
        <button
          type="button"
          className="button secondary"
          onClick={() => setEducation((rows) => [...rows, emptyEducation()])}
        >
          Add education
        </button>
      </div>
      <div className="cv-entries">
        {education.map((row, index) => (
          <div className="cv-entry" key={index}>
            <div className="grid">
              <label>
                Degree or qualification
                <input
                  value={row.degree}
                  onChange={(event) => updateEducation(index, { degree: event.target.value })}
                  maxLength={200}
                />
              </label>
              <label>
                Institution
                <input
                  value={row.institution}
                  onChange={(event) => updateEducation(index, { institution: event.target.value })}
                  maxLength={200}
                />
              </label>
            </div>
            <div className="grid">
              <label>
                Start
                <input
                  value={row.start}
                  onChange={(event) => updateEducation(index, { start: event.target.value })}
                  maxLength={60}
                  placeholder="2018"
                />
              </label>
              <label>
                End
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
                  Remove
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <label>
        Skills
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
          {busy ? "Creating CV..." : "Create CV"}
        </button>
        <a className="button secondary" href={jobScoutPath}>
          Cancel
        </a>
      </div>

      {notice ? <StatusNotice kind={notice.kind}>{notice.message}</StatusNotice> : null}
    </form>
  );
}
