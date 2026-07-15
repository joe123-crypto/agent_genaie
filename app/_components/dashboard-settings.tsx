import {
  CalendarCheck,
  ChevronRight,
  Mail,
  MessageCircle,
  ShieldCheck,
} from "lucide-react";
import { StatusPill } from "@/app/_components/status-ui";

type DashboardSettingsProps = {
  calendarConnected: boolean;
  gmailConnected: boolean;
  publicUserId: string;
  whatsappLinked: boolean;
  whatsappMaskedPhone?: string | null;
};

export function DashboardSettings({
  calendarConnected,
  gmailConnected,
  publicUserId,
  whatsappLinked,
  whatsappMaskedPhone,
}: DashboardSettingsProps) {
  const googleConnected = gmailConnected || calendarConnected;

  return (
    <>
      <header className="dashboard-topbar">
        <div>
          <h1>Settings</h1>
          <p>Manage account links used by Genaie Scout services.</p>
        </div>
      </header>

      <section className="settings-grid" aria-label="Connection settings">
        <a className="settings-card" href={`/${publicUserId}/connect-gmail`}>
          <span className="overview-icon"><Mail aria-hidden="true" /></span>
          <div>
            <h2>Connect Google</h2>
            <p>Manage Gmail and Calendar access for job applications.</p>
            <div className="settings-pills">
              <StatusPill kind={gmailConnected ? "complete" : "unlinked"}>{gmailConnected ? "Gmail connected" : "Gmail not linked"}</StatusPill>
              <StatusPill kind={calendarConnected ? "complete" : "unlinked"}>{calendarConnected ? "Calendar connected" : "Calendar not linked"}</StatusPill>
            </div>
          </div>
          <ChevronRight aria-hidden="true" />
        </a>

        <a className="settings-card" href={`/${publicUserId}/whatsapp`}>
          <span className="overview-icon"><MessageCircle aria-hidden="true" /></span>
          <div>
            <h2>WhatsApp Linking</h2>
            <p>{whatsappLinked ? `Linked to ${whatsappMaskedPhone || "your WhatsApp number"}.` : "Connect a WhatsApp number for delivery updates."}</p>
            <div className="settings-pills">
              <StatusPill kind={whatsappLinked ? "complete" : "unlinked"}>{whatsappLinked ? "WhatsApp linked" : "WhatsApp not linked"}</StatusPill>
            </div>
          </div>
          <ChevronRight aria-hidden="true" />
        </a>
      </section>

      <section className="settings-note" aria-label="Connection coverage">
        <ShieldCheck aria-hidden="true" />
        <div>
          <h2>Connection Coverage</h2>
          <p>
            {googleConnected && whatsappLinked
              ? "Core account links are ready for service automation."
              : "Complete Google and WhatsApp linking to unlock the full service workflow."}
          </p>
        </div>
        <CalendarCheck aria-hidden="true" />
      </section>
    </>
  );
}
