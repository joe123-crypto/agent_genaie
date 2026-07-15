import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { DashboardOverview, type DashboardOverviewProps } from "@/app/_components/dashboard-overview";
import { DashboardShell } from "@/app/_components/dashboard-shell";
import { SESSION_COOKIE_NAME } from "@/src/config";
import { getJobScoutStatusForUser } from "@/src/domains/job-scout";
import { getSignedInAccountStatus, resolvePublicUser, syncUserToCentralData } from "@/src/domains/users";
import { getWebetuCredentialStatus } from "@/src/domains/webetu";
import { verifyFirebaseSessionCookie } from "@/src/security/session";

export const runtime = "nodejs";

const cronRows: DashboardOverviewProps["cronRows"] = [
  {
    icon: "utensils",
    lastRun: "Today, 7:45 AM",
    schedule: "Daily - 10:00 AM",
    service: "Webetu Progress",
    status: "Active",
    task: "Reserve Meals",
    type: "Reservation",
  },
  {
    icon: "briefcase",
    lastRun: "Today, 9:15 AM",
    schedule: "Daily - 12:00 PM",
    service: "Job Applications",
    status: "Active",
    task: "Search & Apply Jobs",
    type: "Jobs",
  },
  {
    icon: "send",
    lastRun: "Today, 9:15 AM",
    schedule: "After each task run",
    service: "WhatsApp",
    status: "Active",
    task: "Deliver Results",
    type: "Delivery",
  },
];

const missingLabels: Record<string, string> = {
  phone_link: "WhatsApp link",
  gmail_connection: "Google connection",
  sender_email: "sender email",
  cv: "CV",
  target_roles: "target role",
  locations: "target location",
  profile_confirmation: "profile confirmation",
  safety_acknowledgement: "terms acknowledgement",
};

function serviceIsRegistered(value: unknown) {
  const text = String(value ?? "").trim();
  return text !== "" && text !== "not_subscribed" && text !== "not_connected";
}

function missingCopy(missing: unknown) {
  if (!Array.isArray(missing) || missing.length === 0) return "All setup requirements are complete.";
  return `Missing ${missing.map((item) => missingLabels[String(item)] || String(item)).join(", ")}.`;
}

export default async function DashboardPage({ params }: { params: Promise<{ publicUserId: string }> }) {
  const { publicUserId } = await params;

  if (!/^usr_[A-Za-z0-9_-]{16}$/.test(publicUserId)) notFound();

  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionCookie) redirect(`/login?next=/${publicUserId}`);

  const [verified, routeUser] = await Promise.all([
    verifyFirebaseSessionCookie(sessionCookie).catch(() => null),
    resolvePublicUser(publicUserId).catch(() => null),
  ]);

  if (!verified) redirect(`/login?next=/${publicUserId}`);
  const uid = verified.uid;

  if (!routeUser) notFound();

  if (uid !== routeUser.id) {
    await syncUserToCentralData(uid);
    const myStatus = await getSignedInAccountStatus(uid).catch(() => null);
    if (myStatus?.publicUserId) redirect(`/${myStatus.publicUserId}`);
    redirect("/login");
  }

  const [accountStatus, jobScoutStatus, webetuStatus] = await Promise.all([
    getSignedInAccountStatus(uid).catch(() => null),
    getJobScoutStatusForUser(uid).catch(() => null),
    getWebetuCredentialStatus(uid).catch(() => null),
  ]);

  const services: DashboardOverviewProps["services"] = [];
  const userServices = accountStatus?.services ?? {};
  const jobScoutRegistered = serviceIsRegistered(userServices.jobs) || !!jobScoutStatus?.configured;
  const webetuRegistered = serviceIsRegistered(userServices.webetu) || !!webetuStatus?.configured;

  if (jobScoutRegistered) {
    const ready = !!jobScoutStatus?.ready;
    services.push({
      actionHref: `/${publicUserId}/job-scout`,
      actionLabel: "Manage Job Scout",
      details: [
        jobScoutStatus?.cvAvailable ? "CV uploaded" : "CV missing",
        jobScoutStatus?.gmailConnected ? "Google connected" : "Google not linked",
        accountStatus?.whatsappLinked ? "WhatsApp linked" : "WhatsApp not linked",
        missingCopy(jobScoutStatus?.missingRequirements),
      ],
      kind: ready ? "complete" : "warning",
      name: "Job Scout",
      status: ready ? "Ready" : "Setup needed",
      type: "job-scout",
    });
  }

  if (webetuRegistered) {
    const configured = !!webetuStatus?.configured;
    services.push({
      actionHref: `/${publicUserId}/vault`,
      actionLabel: "Manage Webetu Reservations",
      details: [
        configured ? "Credentials saved" : webetuStatus?.status === "revoked" ? "Credentials revoked" : "Credentials not saved",
        accountStatus?.whatsappLinked ? "WhatsApp delivery linked" : "WhatsApp delivery not linked",
      ],
      kind: configured ? "complete" : webetuStatus?.status === "revoked" ? "error" : "warning",
      name: "Webetu Reservations",
      status: configured ? "Ready" : "Setup needed",
      type: "webetu",
    });
  }

  const userLabel =
    accountStatus?.profile.displayName
    || accountStatus?.profile.email
    || verified.name
    || verified.email
    || "Account";

  return (
    <DashboardShell active="overview" publicUserId={publicUserId} userLabel={userLabel}>
      <DashboardOverview
        connections={{
          googleCalendarConnected: accountStatus?.services.calendar === "connected",
          googleGmailConnected: accountStatus?.services.gmail === "connected",
          whatsappLinked: !!accountStatus?.whatsappLinked,
          whatsappMaskedPhone: accountStatus?.maskedPhone,
        }}
        cronRows={cronRows}
        lastDeliveryLabel="Today, 7:45 AM"
        nextRunLabel="In 2h 15m"
        nextRunTime="10:00 AM"
        services={services}
      />
    </DashboardShell>
  );
}
