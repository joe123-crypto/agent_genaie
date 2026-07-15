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
import { StatusNotice, StatusPill, type StatusKind } from "@/app/_components/status-ui";

type ConnectionStatus = {
  googleCalendarConnected: boolean;
  googleGmailConnected: boolean;
  whatsappLinked: boolean;
  whatsappMaskedPhone?: string | null;
};

type ServiceSummary = {
  actionHref: string;
  actionLabel: string;
  details: string[];
  kind: StatusKind;
  name: string;
  status: string;
  type: "job-scout" | "webetu";
};

type CronRow = {
  icon: "utensils" | "briefcase" | "send";
  lastRun: string;
  schedule: string;
  service: string;
  status: string;
  task: string;
  type: string;
};

export type DashboardOverviewProps = {
  connections: ConnectionStatus;
  cronRows: CronRow[];
  nextRunLabel: string;
  nextRunTime: string;
  lastDeliveryLabel: string;
  services: ServiceSummary[];
};

function CronIcon({ icon }: { icon: CronRow["icon"] }) {
  if (icon === "utensils") return <Utensils aria-hidden="true" />;
  if (icon === "briefcase") return <BriefcaseBusiness aria-hidden="true" />;
  return <Send aria-hidden="true" />;
}

function ServiceIcon({ type }: { type: ServiceSummary["type"] }) {
  if (type === "job-scout") return <BriefcaseBusiness aria-hidden="true" />;
  return <Utensils aria-hidden="true" />;
}

export function DashboardOverview({
  connections,
  cronRows,
  lastDeliveryLabel,
  nextRunLabel,
  nextRunTime,
  services,
}: DashboardOverviewProps) {
  const googleConnected = connections.googleGmailConnected || connections.googleCalendarConnected;
  const googleLabel = googleConnected ? "Google linked" : "Google not linked";
  const googleCopy = [
    connections.googleGmailConnected ? "Gmail" : null,
    connections.googleCalendarConnected ? "Calendar" : null,
  ].filter(Boolean).join(" + ") || "Connect Gmail and Calendar in Settings.";
  const whatsappLabel = connections.whatsappLinked ? "WhatsApp linked" : "WhatsApp not linked";
  const whatsappCopy = connections.whatsappLinked
    ? connections.whatsappMaskedPhone || "Linked number"
    : "Connect a WhatsApp number in Settings.";

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
            <strong>{whatsappLabel}</strong>
            <span>{whatsappCopy}</span>
          </div>
          <span className={connections.whatsappLinked ? "status-dot is-live" : "status-dot"} />
        </div>
      </header>

      <section className="overview-hero" aria-labelledby="overview-hero-title">
        <div>
          <h2 id="overview-hero-title">Your AI agent is working for you.</h2>
          <p>Sit back while Genaie Scout handles reservations and job applications.</p>
        </div>
        <Image
          className="overview-hero-image"
          src="/Pasted image (2).png"
          alt="Robot assistant holding an envelope"
          width={1536}
          height={1024}
          priority
          sizes="(max-width: 900px) 74vw, 34vw"
        />
      </section>

      <section className="overview-status-grid" aria-label="Connection and service status">
        <article className="overview-status-card">
          <span className="overview-icon"><MessageCircle aria-hidden="true" /></span>
          <div>
            <span>WhatsApp</span>
            <strong>{whatsappLabel}</strong>
            <p>{whatsappCopy}</p>
          </div>
        </article>
        <article className="overview-status-card">
          <span className="overview-icon"><Mail aria-hidden="true" /></span>
          <div>
            <span>Google</span>
            <strong>{googleLabel}</strong>
            <p>{googleCopy}</p>
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
            <p>Upcoming cron jobs</p>
          </div>
        </article>
        <article>
          <span className="overview-icon"><FileText aria-hidden="true" /></span>
          <div>
            <span>Next Run</span>
            <strong>{nextRunLabel}</strong>
            <p>{nextRunTime}</p>
          </div>
        </article>
        <article>
          <span className="overview-icon"><Send aria-hidden="true" /></span>
          <div>
            <span>Last Delivery</span>
            <strong>{lastDeliveryLabel}</strong>
            <p>To WhatsApp</p>
          </div>
        </article>
      </section>

      <section className="overview-table-panel" aria-labelledby="active-cron-title">
        <div className="overview-table-head">
          <h2 id="active-cron-title">Active Cron Jobs</h2>
          <span><Clock3 aria-hidden="true" /> Dummy data</span>
        </div>
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
                <tr key={row.task}>
                  <td>
                    <span className="overview-task">
                      <span className="overview-icon"><CronIcon icon={row.icon} /></span>
                      <span><strong>{row.task}</strong><small>{row.service}</small></span>
                    </span>
                  </td>
                  <td><span className="overview-chip">{row.type}</span></td>
                  <td>{row.schedule}</td>
                  <td><span className="overview-live-status"><span className="status-dot is-live" />{row.status}</span></td>
                  <td>{row.lastRun}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
