import {
  Building2,
  CalendarClock,
  CalendarDays,
  Download,
  ExternalLink,
  Mail,
  Send,
  Sparkles,
} from "lucide-react";
import type { ApplicationRow } from "@/app/_components/application-history-model";
import { StatusNotice, StatusPill } from "@/app/_components/status-ui";

export type ApplicationHistoryProps = {
  rows: ApplicationRow[];
};

function DetailItem({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="application-detail">
      <span className="application-detail-icon">{icon}</span>
      <div>
        <span className="application-detail-label">{label}</span>
        <p>{children}</p>
      </div>
    </div>
  );
}

export function ApplicationHistory({ rows }: ApplicationHistoryProps) {
  return (
    <>
      <header className="dashboard-topbar">
        <div>
          <h1>Application History</h1>
          <p>Every job your agent has applied to, with the CV and cover letter it sent.</p>
        </div>
      </header>

      {rows.length === 0 ? (
        <StatusNotice kind="info" variant="block">
          No applications yet. Once your agent applies to jobs, they will appear here with the documents it sent.
        </StatusNotice>
      ) : (
        <section className="application-list" aria-label="Job applications">
          {rows.map((row) => (
            <article className="application-card" key={row.id}>
              <div className="application-card-head">
                <span className="overview-icon"><Building2 aria-hidden="true" /></span>
                <div className="application-card-title">
                  <h2>{row.role}</h2>
                  <p>{row.company}</p>
                </div>
                <StatusPill kind={row.statusKind}>{row.statusLabel}</StatusPill>
              </div>

              <div className="application-detail-grid">
                {row.appliedLabel ? (
                  <DetailItem icon={<CalendarDays aria-hidden="true" />} label="Applied">{row.appliedLabel}</DetailItem>
                ) : null}
                {row.closing ? (
                  <DetailItem icon={<CalendarClock aria-hidden="true" />} label="Deadline">{row.closing}</DetailItem>
                ) : null}
                {row.applicationEmail ? (
                  <DetailItem icon={<Mail aria-hidden="true" />} label="Sent to">{row.applicationEmail}</DetailItem>
                ) : null}
                {row.submissionMethod ? (
                  <DetailItem icon={<Send aria-hidden="true" />} label="Method">{row.submissionMethod}</DetailItem>
                ) : null}
                {row.matchReason ? (
                  <DetailItem icon={<Sparkles aria-hidden="true" />} label="Why it matched">{row.matchReason}</DetailItem>
                ) : null}
              </div>

              {(row.artifacts.length > 0 || row.sourceUrl) ? (
                <div className="application-card-actions">
                  {row.artifacts.map((artifact) => (
                    <a
                      className="application-action-link"
                      key={artifact.kind}
                      href={artifact.href}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Download aria-hidden="true" /> {artifact.label}
                    </a>
                  ))}
                  {row.sourceUrl ? (
                    <a
                      className="application-action-link is-secondary"
                      href={row.sourceUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      <ExternalLink aria-hidden="true" /> View job post
                    </a>
                  ) : null}
                </div>
              ) : null}
            </article>
          ))}
        </section>
      )}
    </>
  );
}
