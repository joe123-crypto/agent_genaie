import type { StatusKind } from "@/app/_components/status-ui";

// Raw Firestore application documents (from listJobApplications) contain
// Timestamp objects and R2 object keys that must never reach the client. This
// module normalizes them into serializable rows and summary counts.

export type ApplicationStatus =
  | "applied"
  | "skipped"
  | "action_required"
  | "physical_submission"
  | "failed";

export type ApplicationArtifactLink = {
  kind: "cv" | "cover_letter_pdf" | "cover_letter_text";
  label: string;
  href: string;
};

export type ApplicationRow = {
  id: string;
  company: string;
  role: string;
  status: ApplicationStatus;
  statusKind: StatusKind;
  statusLabel: string;
  appliedLabel: string | null;
  applicationEmail: string | null;
  sourceUrl: string | null;
  matchReason: string | null;
  closing: string | null;
  submissionMethod: string | null;
  attemptCount: number;
  artifacts: ApplicationArtifactLink[];
};

export type ApplicationSummary = {
  sent: number;
  actionRequired: number;
  skipped: number;
  total: number;
};

export type ApplicationHistory = {
  rows: ApplicationRow[];
  summary: ApplicationSummary;
};

const STATUS_KINDS: Record<ApplicationStatus, StatusKind> = {
  applied: "complete",
  action_required: "warning",
  physical_submission: "info",
  skipped: "pending",
  failed: "error",
};

const STATUS_LABELS: Record<ApplicationStatus, string> = {
  applied: "Applied",
  action_required: "Needs action",
  physical_submission: "Physical submission",
  skipped: "Skipped",
  failed: "Failed",
};

function normalizeStatus(value: unknown): ApplicationStatus {
  const text = String(value ?? "").trim();
  return (Object.hasOwn(STATUS_KINDS, text) ? text : "skipped") as ApplicationStatus;
}

// Firestore Timestamps expose toDate(); some paths already hold Date/ISO values.
function toDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value.toDate === "function") {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  }
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value: any): string | null {
  const date = toDate(value);
  if (!date) return null;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function cleanString(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

const ARTIFACT_KINDS = [
  { field: "cv", kind: "cv", label: "CV" },
  { field: "coverLetterPdf", kind: "cover_letter_pdf", label: "Cover letter" },
  { field: "coverLetterText", kind: "cover_letter_text", label: "Cover letter (text)" },
] as const;

// Prefer the latest attempt's artifacts (artifactRefs mirrors that attempt), and
// avoid emitting both a PDF and text cover letter — the PDF is preferred.
function artifactLinks(record: Record<string, any>, publicUserId: string, applicationId: string): ApplicationArtifactLink[] {
  const refs = record.artifactRefs && typeof record.artifactRefs === "object" ? record.artifactRefs : null;
  const attempt = Number(refs?.attempt);
  const source = refs && Number.isInteger(attempt)
    ? refs
    : (() => {
        const artifacts = record.artifacts && typeof record.artifacts === "object" ? record.artifacts : {};
        const attempts = Object.values(artifacts).filter((entry): entry is Record<string, any> => Boolean(entry) && typeof entry === "object");
        return attempts.sort((a, b) => Number(b.attempt || 0) - Number(a.attempt || 0))[0] || null;
      })();
  if (!source) return [];
  const sourceAttempt = Number(source.attempt);
  if (!Number.isInteger(sourceAttempt) || sourceAttempt < 1) return [];

  const links: ApplicationArtifactLink[] = [];
  let hasCoverLetter = false;
  for (const spec of ARTIFACT_KINDS) {
    if (!cleanString(source[spec.field])) continue;
    if (spec.field === "coverLetterText" && hasCoverLetter) continue;
    if (spec.field === "coverLetterPdf") hasCoverLetter = true;
    const params = new URLSearchParams({
      applicationId,
      attempt: String(sourceAttempt),
      kind: spec.kind,
    });
    links.push({
      kind: spec.kind,
      label: spec.label,
      href: `/${publicUserId}/application-artifact?${params.toString()}`,
    });
  }
  return links;
}

export function buildApplicationHistory(rawApps: any[], publicUserId: string): ApplicationHistory {
  const apps = Array.isArray(rawApps) ? rawApps : [];
  const rows = apps
    .map((record): { row: ApplicationRow; ts: number } | null => {
      const applicationId = cleanString(record?.applicationId ?? record?.id);
      const company = cleanString(record?.company);
      const role = cleanString(record?.role);
      if (!applicationId || !company || !role) return null;
      const status = normalizeStatus(record?.status);
      const attemptValue = Number(record?.attemptCount);
      const sortDate = toDate(record?.appliedAt) ?? toDate(record?.createdAt);
      return {
        ts: sortDate ? sortDate.getTime() : 0,
        row: {
          id: applicationId,
          company,
          role,
          status,
          statusKind: STATUS_KINDS[status],
          statusLabel: STATUS_LABELS[status],
          appliedLabel: formatDate(record?.appliedAt) ?? formatDate(record?.createdAt),
          applicationEmail: cleanString(record?.applicationEmail),
          sourceUrl: cleanString(record?.sourceUrl ?? record?.url ?? record?.applicationUrl),
          matchReason: cleanString(record?.matchReason),
          closing: cleanString(record?.closing),
          submissionMethod: cleanString(record?.submissionMethod),
          attemptCount: Number.isFinite(attemptValue) ? Math.max(0, Math.trunc(attemptValue)) : 0,
          artifacts: artifactLinks(record, publicUserId, applicationId),
        },
      };
    })
    .filter((entry): entry is { row: ApplicationRow; ts: number } => Boolean(entry))
    .sort((a, b) => b.ts - a.ts)
    .map((entry) => entry.row);

  return { rows, summary: summarizeApplications(apps) };
}

export function summarizeApplications(rawApps: any[]): ApplicationSummary {
  const apps = Array.isArray(rawApps) ? rawApps : [];
  const summary: ApplicationSummary = { sent: 0, actionRequired: 0, skipped: 0, total: 0 };
  for (const record of apps) {
    summary.total += 1;
    const status = normalizeStatus(record?.status);
    if (status === "applied") summary.sent += 1;
    else if (status === "action_required") summary.actionRequired += 1;
    else if (status === "skipped") summary.skipped += 1;
  }
  return summary;
}
