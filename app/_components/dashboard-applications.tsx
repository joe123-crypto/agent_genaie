import { ChevronRight, ClipboardList, ClipboardCheck } from "lucide-react";
import { StatusPill } from "@/app/_components/status-ui";

type DashboardApplicationsProps = {
  publicUserId: string;
  pendingCount: number;
  sentCount: number;
};

export function DashboardApplications({ publicUserId, pendingCount, sentCount }: DashboardApplicationsProps) {
  return (
    <>
      <header className="dashboard-topbar">
        <div>
          <h1>Applications</h1>
          <p>Approve the jobs your agent finds and review everything it has applied to.</p>
        </div>
      </header>

      <section className="settings-grid" aria-label="Applications">
        <a className="settings-card" href={`/${publicUserId}/applications/approval`}>
          <span className="overview-icon"><ClipboardCheck aria-hidden="true" /></span>
          <div>
            <h2>Application Approval</h2>
            <p>Review jobs your agent found and choose which ones it should apply to.</p>
            <div className="settings-pills">
              <StatusPill kind={pendingCount > 0 ? "warning" : "complete"}>
                {pendingCount > 0
                  ? `${pendingCount} awaiting approval`
                  : "None awaiting approval"}
              </StatusPill>
            </div>
          </div>
          <ChevronRight aria-hidden="true" />
        </a>

        <a className="settings-card" href={`/${publicUserId}/applications/history`}>
          <span className="overview-icon"><ClipboardList aria-hidden="true" /></span>
          <div>
            <h2>Application History</h2>
            <p>Every job your agent has applied to, with the CV and cover letter it sent.</p>
            <div className="settings-pills">
              <StatusPill kind={sentCount > 0 ? "complete" : "pending"}>
                {sentCount > 0 ? `${sentCount} applied` : "No applications yet"}
              </StatusPill>
            </div>
          </div>
          <ChevronRight aria-hidden="true" />
        </a>
      </section>
    </>
  );
}
