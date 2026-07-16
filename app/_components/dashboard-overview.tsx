import Image from "next/image";
import {
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileText,
  Mail,
  MessageCircle,
  Send,
  Utensils,
} from "lucide-react";
import type { ConnectionState, DashboardCronRow, DashboardService, DashboardViewModel } from "@/app/_components/dashboard-model";
import { StatusNotice, StatusPill } from "@/app/_components/status-ui";

export type DashboardOverviewProps = DashboardViewModel;

function CronIcon({ icon }: { icon: DashboardCronRow["icon"] }) {
  if (icon === "utensils") return <Utensils aria-hidden="true" />;
  if (icon === "briefcase") return <BriefcaseBusiness aria-hidden="true" />;
  return <Send aria-hidden="true" />;
}

function ServiceIcon({ type }: { type: DashboardService["type"] }) {
  if (type === "job-scout") return <BriefcaseBusiness aria-hidden="true" />;
  return <Utensils aria-hidden="true" />;
}

function statusDotClass(state: ConnectionState | DashboardCronRow["statusKind"]) {
  if (state === "connected" || state === "live") return "status-dot is-live";
  if (state === "partial") return "status-dot is-partial";
  if (state === "unavailable" || state === "error") return "status-dot is-error";
  return "status-dot";
}

export function DashboardOverview({
  connections,
  cronRows,
  hasStatusError,
  hero,
  lastDeliveryCopy,
  lastDeliveryLabel,
  nextRunCopy,
  nextRunLabel,
  services,
  telemetryAvailable,
}: DashboardOverviewProps) {
  return (
    <>
      <header className="dashboard-topbar">
        <div>
          <h1>Overview</h1>
          <p>Current service health and scheduled agent work.</p>
        </div>
        <div className="dashboard-whatsapp-card" aria-label="WhatsApp connection summary">
          <MessageCircle aria-hidden="true" />
          <div>
            <strong>{connections.whatsapp.label}</strong>
            <span>{connections.whatsapp.detail}</span>
          </div>
          <span className={statusDotClass(connections.whatsapp.state)} aria-hidden="true" />
        </div>
      </header>

      {hasStatusError ? (
        <StatusNotice kind="warning" variant="block">
          Some account or agent status could not be loaded. Displayed setup information may be incomplete.
        </StatusNotice>
      ) : null}

      <section className="overview-hero" aria-labelledby="overview-hero-title">
        <div>
          <h2 id="overview-hero-title">{hero.title}</h2>
          <p>{hero.copy}</p>
        </div>
        <div className="overview-hero-art">
          <Image
            className="overview-hero-image"
            src="/Pasted image (2).png"
            alt="Robot assistant holding an envelope"
            width={1536}
            height={1024}
            priority
            sizes="(max-width: 820px) 72vw, 300px"
          />
        </div>
      </section>

      <section className="overview-status-grid" aria-label="Connection and service status">
        <article className="overview-status-card">
          <span className="overview-icon"><MessageCircle aria-hidden="true" /></span>
          <div>
            <span>WhatsApp</span>
            <strong>{connections.whatsapp.label}</strong>
            <p>{connections.whatsapp.detail}</p>
          </div>
        </article>
        <article className="overview-status-card">
          <span className="overview-icon"><Mail aria-hidden="true" /></span>
          <div>
            <span>Google</span>
            <strong>{connections.google.label}</strong>
            <p>{connections.google.detail}</p>
          </div>
        </article>
        <article className="overview-status-card">
          <span className="overview-icon"><CheckCircle2 aria-hidden="true" /></span>
          <div>
            <span>Registered Services</span>
            <strong>{services.length}</strong>
            <p>{services.length > 0 ? services.map((service) => service.name).join(", ") : "No services registered yet."}</p>
          </div>
        </article>
      </section>

      <section className="overview-services" aria-labelledby="registered-services-title">
        <div className="overview-section-head">
          <h2 id="registered-services-title">Registered Services</h2>
          <p>Setup status for services currently enabled on this account.</p>
        </div>
        {services.length > 0 ? (
          <div className="overview-service-grid">
            {services.map((service) => (
              <article className="overview-service-card" key={service.name}>
                <div className="overview-service-card-head">
                  <span className="overview-icon"><ServiceIcon type={service.type} /></span>
                  <div>
                    <h3>{service.name}</h3>
                    <StatusPill kind={service.kind}>{service.status}</StatusPill>
                  </div>
                </div>
                <ul>
                  {service.details.map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
                <a className="overview-inline-link" href={service.actionHref}>{service.actionLabel}</a>
              </article>
            ))}
          </div>
        ) : (
          <StatusNotice kind="info" variant="block">
            No services are registered yet. Open Job Scout or Webetu Reservations to finish setup.
          </StatusNotice>
        )}
      </section>

      <section className="overview-metrics" aria-label="Agent schedule metrics">
        <article>
          <span className="overview-icon"><CalendarDays aria-hidden="true" /></span>
          <div>
            <span>Tasks Scheduled</span>
            <strong>{cronRows.length}</strong>
            <p>{telemetryAvailable ? "Live agent tasks" : "Agent schedule unavailable"}</p>
          </div>
        </article>
        <article>
          <span className="overview-icon"><FileText aria-hidden="true" /></span>
          <div>
            <span>Next Run</span>
            <strong>{nextRunLabel}</strong>
            <p>{nextRunCopy}</p>
          </div>
        </article>
        <article>
          <span className="overview-icon"><Send aria-hidden="true" /></span>
          <div>
            <span>Last Delivery</span>
            <strong>{lastDeliveryLabel}</strong>
            <p>{lastDeliveryCopy}</p>
          </div>
        </article>
      </section>

      <section className="overview-table-panel" aria-labelledby="active-cron-title">
        <div className="overview-table-head">
          <h2 id="active-cron-title">Active Cron Jobs</h2>
          <span><Clock3 aria-hidden="true" /> Live agent schedule</span>
        </div>
        {cronRows.length > 0 ? (
          <div className="overview-table-wrap">
            <table className="overview-table">
              <thead>
                <tr>
                  <th scope="col">Task</th>
                  <th scope="col">Type</th>
                  <th scope="col">Schedule</th>
                  <th scope="col">Status</th>
                  <th scope="col">Last Run</th>
                </tr>
              </thead>
              <tbody>
                {cronRows.map((row) => (
                  <tr key={row.taskId}>
                    <td>
                      <span className="overview-task">
                        <span className="overview-icon"><CronIcon icon={row.icon} /></span>
                        <span><strong>{row.task}</strong><small>{row.service}</small></span>
                      </span>
                    </td>
                    <td><span className="overview-chip">{row.type}</span></td>
                    <td>{row.schedule}</td>
                    <td><span className="overview-live-status"><span className={statusDotClass(row.statusKind)} aria-hidden="true" />{row.status}</span></td>
                    <td>{row.lastRun}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overview-empty-schedule">
            <Clock3 aria-hidden="true" />
            <div>
              <strong>{services.some((service) => service.ready) ? "No live schedule reported yet" : "No active tasks"}</strong>
              <p>{services.some((service) => service.ready) ? "The agent has not published schedule telemetry for this account." : "Complete a registered service setup to start scheduled work."}</p>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
