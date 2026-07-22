import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildApplicationHistory,
  summarizeApplications,
} from "@/app/_components/application-history-model";

const publicUserId = "usr_1234567890abcdef";

// Mimics a Firestore Timestamp (exposes toDate()).
function ts(iso: string) {
  return { toDate: () => new Date(iso) };
}

test("summarizeApplications counts by status", () => {
  const summary = summarizeApplications([
    { status: "applied" },
    { status: "applied" },
    { status: "action_required" },
    { status: "skipped" },
    { status: "failed" },
    { status: "physical_submission" },
  ]);
  assert.deepEqual(summary, { sent: 2, actionRequired: 1, skipped: 1, total: 6 });
});

test("summarizeApplications tolerates non-array input", () => {
  assert.deepEqual(summarizeApplications(undefined as any), { sent: 0, actionRequired: 0, skipped: 0, total: 0 });
});

test("buildApplicationHistory maps status to StatusPill kinds", () => {
  const { rows } = buildApplicationHistory(
    [
      { applicationId: "a1", company: "Acme", role: "Engineer", status: "applied" },
      { applicationId: "a2", company: "Beta", role: "Analyst", status: "action_required" },
      { applicationId: "a3", company: "Cyan", role: "Designer", status: "failed" },
    ],
    publicUserId,
  );
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
  assert.equal(byId.a1.statusKind, "complete");
  assert.equal(byId.a2.statusKind, "warning");
  assert.equal(byId.a3.statusKind, "error");
});

test("buildApplicationHistory drops records missing company/role/id", () => {
  const { rows } = buildApplicationHistory(
    [
      { applicationId: "ok", company: "Acme", role: "Engineer", status: "applied" },
      { applicationId: "", company: "Acme", role: "Engineer" },
      { applicationId: "x", company: "", role: "Engineer" },
      { applicationId: "y", company: "Acme", role: "" },
    ],
    publicUserId,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "ok");
});

test("buildApplicationHistory sorts newest first by appliedAt/createdAt", () => {
  const { rows } = buildApplicationHistory(
    [
      { applicationId: "old", company: "A", role: "R", status: "applied", appliedAt: ts("2026-01-01T00:00:00Z") },
      { applicationId: "new", company: "B", role: "R", status: "applied", appliedAt: ts("2026-06-01T00:00:00Z") },
      { applicationId: "mid", company: "C", role: "R", status: "applied", createdAt: ts("2026-03-01T00:00:00Z") },
    ],
    publicUserId,
  );
  assert.deepEqual(rows.map((row) => row.id), ["new", "mid", "old"]);
  assert.ok(rows[0].appliedLabel, "formats a human date label");
});

test("buildApplicationHistory builds artifact download hrefs from the latest attempt", () => {
  const { rows } = buildApplicationHistory(
    [
      {
        applicationId: "app123",
        company: "Acme",
        role: "Engineer",
        status: "applied",
        artifactRefs: {
          attempt: 2,
          cv: "uid/applications/app123/2/cv.pdf",
          coverLetterPdf: "uid/applications/app123/2/cover-letter.pdf",
          coverLetterText: "uid/applications/app123/2/cover-letter.txt",
        },
      },
    ],
    publicUserId,
  );
  const links = rows[0].artifacts;
  // PDF cover letter is preferred, so the text variant is suppressed.
  assert.deepEqual(links.map((link) => link.kind), ["cv", "cover_letter_pdf"]);
  assert.equal(
    links[0].href,
    `/${publicUserId}/application-artifact?applicationId=app123&attempt=2&kind=cv`,
  );
});

test("buildApplicationHistory falls back to text cover letter when no PDF", () => {
  const { rows } = buildApplicationHistory(
    [
      {
        applicationId: "app123",
        company: "Acme",
        role: "Engineer",
        status: "applied",
        artifactRefs: { attempt: 1, coverLetterText: "uid/applications/app123/1/cover-letter.txt" },
      },
    ],
    publicUserId,
  );
  assert.deepEqual(rows[0].artifacts.map((link) => link.kind), ["cover_letter_text"]);
});
