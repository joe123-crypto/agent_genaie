import type { StatusKind } from "@/app/_components/status-ui";

export type ConnectionState = "connected" | "partial" | "disconnected" | "unavailable";
export type ServiceState = "ready" | "setup_needed" | "revoked" | "unavailable";

export type DashboardSource<T> = {
  available: boolean;
  data: T | null;
};

type AccountStatusSnapshot = {
  maskedPhone?: string | null;
  services?: {
    calendar?: unknown;
    gmail?: unknown;
    jobs?: unknown;
    webetu?: unknown;
  };
  whatsappLinked?: boolean;
};

type JobScoutStatusSnapshot = {
  configured?: boolean;
  cvAvailable?: boolean;
  gmailConnected?: boolean;
  linked?: boolean;
  missingRequirements?: unknown;
  ready?: boolean;
};

type WebetuStatusSnapshot = {
  configured?: boolean;
  maskedPhone?: string | null;
  status?: unknown;
  whatsappLinked?: boolean;
};

export type DashboardConnection = {
  detail: string;
  label: string;
  state: ConnectionState;
};

export type DashboardService = {
  actionHref: string;
  actionLabel: string;
  details: string[];
  kind: StatusKind;
  name: string;
  ready: boolean;
  state: ServiceState;
  status: string;
  type: "job-scout" | "webetu";
};

export type DashboardCronRow = {
  icon: "utensils" | "briefcase" | "send";
  lastRun: string;
  schedule: string;
  service: string;
  status: string;
  task: string;
  type: string;
};

export type DashboardViewModel = {
  connections: {
    google: DashboardConnection;
    whatsapp: DashboardConnection;
  };
  cronRows: DashboardCronRow[];
  hasStatusError: boolean;
  hero: {
    copy: string;
    title: string;
  };
  lastDeliveryCopy: string;
  lastDeliveryLabel: string;
  nextRunCopy: string;
  nextRunLabel: string;
  services: DashboardService[];
};

export type DashboardModelInput = {
  account: DashboardSource<AccountStatusSnapshot>;
  jobScout: DashboardSource<JobScoutStatusSnapshot>;
  publicUserId: string;
  webetu: DashboardSource<WebetuStatusSnapshot>;
};

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

function isRegisteredService(value: unknown) {
  return value === "subscribed" || value === "connected";
}

function missingCopy(missing: unknown) {
  if (!Array.isArray(missing) || missing.length === 0) {
    return "All setup requirements are complete.";
  }
  return `Missing ${missing.map((item) => missingLabels[String(item)] || String(item)).join(", ")}.`;
}

function googleConnection(account: DashboardModelInput["account"]): DashboardConnection {
  if (!account.available || !account.data) {
    return {
      detail: "Google connection status could not be loaded.",
      label: "Google status unavailable",
      state: "unavailable",
    };
  }

  const gmailConnected = account.data.services?.gmail === "connected";
  const calendarConnected = account.data.services?.calendar === "connected";
  if (gmailConnected && calendarConnected) {
    return { detail: "Gmail + Calendar", label: "Google linked", state: "connected" };
  }
  if (gmailConnected || calendarConnected) {
    return {
      detail: gmailConnected ? "Gmail connected; Calendar not linked." : "Calendar connected; Gmail not linked.",
      label: "Google partially linked",
      state: "partial",
    };
  }
  return {
    detail: "Connect Gmail and Calendar in Settings.",
    label: "Google not linked",
    state: "disconnected",
  };
}

function whatsappConnection(account: DashboardModelInput["account"]): DashboardConnection {
  if (!account.available || !account.data) {
    return {
      detail: "WhatsApp connection status could not be loaded.",
      label: "WhatsApp status unavailable",
      state: "unavailable",
    };
  }
  if (account.data.whatsappLinked) {
    return {
      detail: account.data.maskedPhone || "Linked number",
      label: "WhatsApp linked",
      state: "connected",
    };
  }
  return {
    detail: "Connect a WhatsApp number in Settings.",
    label: "WhatsApp not linked",
    state: "disconnected",
  };
}

function jobScoutService(input: DashboardModelInput): DashboardService | null {
  const registered = isRegisteredService(input.account.data?.services?.jobs)
    || Boolean(input.jobScout.data?.configured);
  if (!registered) return null;

  const base = {
    actionHref: `/${input.publicUserId}/job-scout`,
    actionLabel: "Manage Job Scout",
    name: "Job Scout",
    type: "job-scout" as const,
  };
  if (!input.jobScout.available || !input.jobScout.data) {
    return {
      ...base,
      details: ["Service setup status could not be loaded."],
      kind: "error",
      ready: false,
      state: "unavailable",
      status: "Status unavailable",
    };
  }

  const status = input.jobScout.data;
  const ready = Boolean(status.ready);
  return {
    ...base,
    details: [
      status.cvAvailable ? "CV uploaded" : "CV missing",
      status.gmailConnected ? "Google connected" : "Google not linked",
      status.linked ? "WhatsApp linked" : "WhatsApp not linked",
      missingCopy(status.missingRequirements),
    ],
    kind: ready ? "complete" : "warning",
    ready,
    state: ready ? "ready" : "setup_needed",
    status: ready ? "Ready" : "Setup needed",
  };
}

function webetuService(input: DashboardModelInput): DashboardService | null {
  const statusValue = String(input.webetu.data?.status ?? "");
  const registered = isRegisteredService(input.account.data?.services?.webetu)
    || Boolean(input.webetu.data?.configured)
    || statusValue === "revoked";
  if (!registered) return null;

  const base = {
    actionHref: `/${input.publicUserId}/vault`,
    actionLabel: "Manage Webetu Reservations",
    name: "Webetu Reservations",
    type: "webetu" as const,
  };
  if (!input.webetu.available || !input.webetu.data) {
    return {
      ...base,
      details: ["Service setup status could not be loaded."],
      kind: "error",
      ready: false,
      state: "unavailable",
      status: "Status unavailable",
    };
  }

  const status = input.webetu.data;
  const whatsappLinked = status.whatsappLinked ?? input.account.data?.whatsappLinked ?? false;
  if (status.status === "revoked") {
    return {
      ...base,
      details: ["Credentials revoked", whatsappLinked ? "WhatsApp delivery linked" : "WhatsApp delivery not linked"],
      kind: "revoked",
      ready: false,
      state: "revoked",
      status: "Credentials revoked",
    };
  }

  const ready = Boolean(status.configured && whatsappLinked);
  return {
    ...base,
    details: [
      status.configured ? "Credentials saved" : "Credentials not saved",
      whatsappLinked ? "WhatsApp delivery linked" : "WhatsApp delivery not linked",
    ],
    kind: ready ? "complete" : "warning",
    ready,
    state: ready ? "ready" : "setup_needed",
    status: ready ? "Ready" : "Setup needed",
  };
}

function sampleCronRows(services: DashboardService[]): DashboardCronRow[] {
  const rows: DashboardCronRow[] = [];
  if (services.some((service) => service.type === "webetu" && service.ready)) {
    rows.push({
      icon: "utensils",
      lastRun: "7:45 AM",
      schedule: "Daily - 10:00 AM",
      service: "Webetu Reservations",
      status: "Active",
      task: "Reserve Meals",
      type: "Reservation",
    });
  }
  if (services.some((service) => service.type === "job-scout" && service.ready)) {
    rows.push({
      icon: "briefcase",
      lastRun: "9:15 AM",
      schedule: "Daily - 12:00 PM",
      service: "Job Applications",
      status: "Active",
      task: "Search & Apply Jobs",
      type: "Jobs",
    });
  }
  if (rows.length > 0) {
    const deliveryLastRun = rows.some((row) => row.icon === "briefcase") ? "9:15 AM" : "7:45 AM";
    rows.push({
      icon: "send",
      lastRun: deliveryLastRun,
      schedule: "After each task run",
      service: "WhatsApp",
      status: "Active",
      task: "Deliver Results",
      type: "Delivery",
    });
  }
  return rows;
}

export function buildDashboardViewModel(input: DashboardModelInput): DashboardViewModel {
  const services = [jobScoutService(input), webetuService(input)].filter(
    (service): service is DashboardService => Boolean(service),
  );
  const cronRows = sampleCronRows(services);
  const readyServices = services.filter((service) => service.ready);
  const hasStatusError = !input.account.available || !input.jobScout.available || !input.webetu.available;

  let hero: DashboardViewModel["hero"];
  if (readyServices.length > 0) {
    hero = {
      title: "Your AI agent is working for you.",
      copy: `Genaie Scout is handling ${readyServices.map((service) => service.name).join(" and ")}.`,
    };
  } else if (services.length > 0) {
    hero = {
      title: "Finish setup to start your AI agent.",
      copy: "Complete the remaining service requirements to begin scheduled work.",
    };
  } else if (hasStatusError) {
    hero = {
      title: "Your service overview is temporarily unavailable.",
      copy: "Refresh the page in a moment to check your current setup.",
    };
  } else {
    hero = {
      title: "Choose a service to get started.",
      copy: "Set up Job Scout or Webetu Reservations to begin scheduled work.",
    };
  }

  const nextService = services.find((service) => service.type === "webetu" && service.ready)
    ?? services.find((service) => service.type === "job-scout" && service.ready);
  const deliveryRow = cronRows.find((row) => row.icon === "send");

  return {
    connections: {
      google: googleConnection(input.account),
      whatsapp: whatsappConnection(input.account),
    },
    cronRows,
    hasStatusError,
    hero,
    lastDeliveryCopy: deliveryRow ? "Sample delivery" : "Nothing delivered yet",
    lastDeliveryLabel: deliveryRow?.lastRun ?? "No deliveries",
    nextRunCopy: nextService ? "Sample schedule" : "Nothing scheduled yet",
    nextRunLabel: nextService?.type === "webetu" ? "10:00 AM" : nextService ? "12:00 PM" : "No run scheduled",
    services,
  };
}
