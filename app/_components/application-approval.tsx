"use client";

import { useState } from "react";
import {
  Building2,
  CalendarClock,
  Check,
  Download,
  ExternalLink,
  Mail,
  Sparkles,
  X,
} from "lucide-react";
import type { ApplicationRow } from "@/app/_components/application-history-model";
import { StatusNotice, StatusPill } from "@/app/_components/status-ui";

export type ApplicationApprovalProps = {
  rows: ApplicationRow[];
};

type Notice = { kind: "complete" | "error"; text: string } | null;

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

export function ApplicationApproval({ rows }: ApplicationApprovalProps) {
  const [items, setItems] = useState<ApplicationRow[]>(rows);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  async function decide(row: ApplicationRow, decision: "approve" | "reject") {
    setPendingId(row.id);
    setNotice(null);
    try {
      const response = await fetch("/applications/decision", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId: row.id, decision }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Request failed with ${response.status}`);
      setItems((current) => current.filter((item) => item.id !== row.id));
      setNotice({
        kind: "complete",
        text: decision === "approve"
          ? `Approved ${row.role} at ${row.company}. Your agent will submit it.`
          : `Skipped ${row.role} at ${row.company}.`,
      });
    } catch (err) {
      setNotice({ kind: "error", text: (err as Error).message || "Could not update this application." });
    } finally {
      setPendingId(null);
    }
  }

  return (
    <>
      <header className="dashboard-topbar">
        <div>
          <h1>Application Approval</h1>
          <p>Review the jobs your agent found and choose which ones it should apply to.</p>
        </div>
      </header>

      {notice ? (
        <StatusNotice kind={notice.kind} variant="block">{notice.text}</StatusNotice>
      ) : null}

      {items.length === 0 ? (
        <StatusNotice kind="info" variant="block">
          No applications waiting for approval. When your agent finds a suitable job, it will appear here for you to approve.
        </StatusNotice>
      ) : (
        <section className="application-list" aria-label="Applications awaiting approval">
          {items.map((row) => {
            const busy = pendingId === row.id;
            return (
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
                  {row.closing ? (
                    <DetailItem icon={<CalendarClock aria-hidden="true" />} label="Deadline">{row.closing}</DetailItem>
                  ) : null}
                  {row.applicationEmail ? (
                    <DetailItem icon={<Mail aria-hidden="true" />} label="Would send to">{row.applicationEmail}</DetailItem>
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

                <div className="actions">
                  <button type="button" disabled={busy} onClick={() => decide(row, "approve")}>
                    <Check aria-hidden="true" /> Approve
                  </button>
                  <button className="secondary" type="button" disabled={busy} onClick={() => decide(row, "reject")}>
                    <X aria-hidden="true" /> Reject
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      )}
    </>
  );
}
