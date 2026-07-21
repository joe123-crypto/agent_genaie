import {
  CalendarCheck,
  ChevronRight,
  Mail,
  MessageCircle,
  ShieldCheck,
} from "lucide-react";
import { StatusNotice, StatusPill } from "@/app/_components/status-ui";

type DashboardSettingsProps = {
  calendarConnected: boolean;
  gmailConnected: boolean;
  publicUserId: string;
  statusAvailable?: boolean;
  whatsappLinked: boolean;
  whatsappMaskedPhone?: string | null;
};

export function DashboardSettings({
  calendarConnected,
  gmailConnected,
  publicUserId,
  statusAvailable = true,
  whatsappLinked,
  whatsappMaskedPhone,
}: DashboardSettingsProps) {
  const googleConnected = gmailConnected && calendarConnected;
  const gmailLabel = !statusAvailable ? "Gmail status unavailable" : gmailConnected ? "Gmail connected" : "Gmail not linked";
  const calendarLabel = !statusAvailable ? "Calendar status unavailable" : calendarConnected ? "Calendar connected" : "Calendar not linked";
  const whatsappLabel = !statusAvailable ? "WhatsApp status unavailable" : whatsappLinked ? "WhatsApp linked" : "WhatsApp not linked";

  return (
    <>
      <header className="dashboard-topbar">
        <div>
          <h1>Settings</h1>
          <p>Manage account links used by Genaie services.</p>
        </div>
      </header>

      {!statusAvailable ? (
        <StatusNotice kind="warning" variant="block">
          Connection status could not be loaded. Open a connection to verify its current state.
        </StatusNotice>
      ) : null}

      <section className="settings-grid" aria-label="Connection settings">
        <a className="settings-card" href={`/${publicUserId}/connect-gmail`}>
          <span className="overview-icon"><Mail aria-hidden="true" /></span>
          <div>
            <h2>Connect Google</h2>
            <p>Manage Gmail and Calendar access for job applications.</p>
            <div className="settings-pills">
              <StatusPill kind={!statusAvailable ? "error" : gmailConnected ? "complete" : "unlinked"}>{gmailLabel}</StatusPill>
              <StatusPill kind={!statusAvailable ? "error" : calendarConnected ? "complete" : "unlinked"}>{calendarLabel}</StatusPill>
            </div>
          </div>
          <ChevronRight aria-hidden="true" />
        </a>

        <a className="settings-card" href={`/${publicUserId}/whatsapp`}>
          <span className="overview-icon"><MessageCircle aria-hidden="true" /></span>
          <div>
            <h2>WhatsApp Linking</h2>
            <p>{!statusAvailable ? "WhatsApp connection status could not be loaded." : whatsappLinked ? `Linked to ${whatsappMaskedPhone || "your WhatsApp number"}.` : "Optional: link a WhatsApp number to get updates in chat."}</p>
            <div className="settings-pills">
              <StatusPill kind={!statusAvailable ? "error" : whatsappLinked ? "complete" : "unlinked"}>{whatsappLabel}</StatusPill>
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
            {!statusAvailable
              ? "Connection coverage is temporarily unavailable."
              : googleConnected && whatsappLinked
              ? "Core account links are ready for service automation."
              : "Connect Google to unlock job applications. WhatsApp is optional — link it to get updates in chat."}
          </p>
        </div>
        <CalendarCheck aria-hidden="true" />
      </section>
    </>
  );
}
