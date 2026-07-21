import type { StatusKind } from "@/app/_components/status-ui";

export type ConnectionState = "connected" | "partial" | "disconnected" | "unavailable";
export type ServiceState = "ready" | "processing" | "setup_needed" | "revoked" | "unavailable";
export type DashboardTaskId = "reserve_meals" | "search_apply_jobs" | "deliver_results";
export type DashboardTaskService = "webetu" | "job_scout" | "delivery";
export type DashboardTaskStatus = "active" | "running" | "paused" | "failed" | "disabled";

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
  cvUploaded?: boolean;
  cvConversionStatus?: unknown;
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

export type DashboardTelemetryTask = {
  enabled: boolean;
  lastRunAt: string | null;
  lastRunStatus: "success" | "partial" | "failed" | "skipped" | "action_required" | null;
  lastRunSummary: string | null;
  nextRunAt: string | null;
  scheduleLabel: string | null;
  service: DashboardTaskService;
  status: DashboardTaskStatus;
  taskId: DashboardTaskId;
  timezone: string | null;
  updatedAt: string | null;
};

export type DashboardTelemetrySnapshot = {
  tasks: DashboardTelemetryTask[];
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
  lastRunAt: string | null;
  schedule: string;
  service: string;
  status: string;
  statusKind: "live" | "partial" | "error";
  task: string;
  taskId: DashboardTaskId;
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
  telemetryAvailable: boolean;
  whatsappSuggestionHref: string | null;
};

export type DashboardModelInput = {
  account: DashboardSource<AccountStatusSnapshot>;
  jobScout: DashboardSource<JobScoutStatusSnapshot>;
  publicUserId: string;
  telemetry?: DashboardSource<DashboardTelemetrySnapshot>;
  webetu: DashboardSource<WebetuStatusSnapshot>;
};

const missingLabels: Record<string, string> = {
  phone_link: "WhatsApp link",
  gmail_connection: "Google connection",
  sender_email: "sender email",
  cv: "CV",
  cv_conversion: "CV conversion",
  target_roles: "target role",
  locations: "target location",
  profile_confirmation: "profile confirmation",
  safety_acknowledgement: "terms acknowledgement",
};

const taskMeta: Record<DashboardTaskId, {
  icon: DashboardCronRow["icon"];
  service: string;
  task: string;
  type: string;
}> = {
  reserve_meals: {
    icon: "utensils",
    service: "Webetu Reservations",
    task: "Reserve Meals",
    type: "Reservation",
  },
  search_apply_jobs: {
    icon: "briefcase",
    service: "Job Applications",
    task: "Search & Apply Jobs",
    type: "Jobs",
  },
  deliver_results: {
    icon: "send",
    service: "WhatsApp",
    task: "Deliver Results",
    type: "Delivery",
  },
};

function isRegisteredService(value: unknown) {
  return value === "subscribed" || value === "connected";
}

function missingCopy(missing: unknown, conversionPending = false) {
  const requirements = Array.isArray(missing)
    ? missing.filter((item) => String(item) !== "cv_conversion")
    : [];
  if (conversionPending && requirements.length === 0) {
    return "Your uploaded PDF is being processed. No action is needed.";
  }
  if (requirements.length === 0) {
    return "All setup requirements are complete.";
  }
  return `Missing ${requirements.map((item) => missingLabels[String(item)] || String(item)).join(", ")}.`;
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
  const conversionPending = status.cvConversionStatus === "pending" || Boolean(status.cvUploaded && !status.cvAvailable);
  return {
    ...base,
    details: [
      status.cvAvailable
        ? "CV ready"
        : conversionPending
          ? "CV processing"
          : "CV missing",
      status.gmailConnected ? "Google connected" : "Google not linked",
      status.linked ? "WhatsApp updates on" : "WhatsApp updates off (optional)",
      missingCopy(status.missingRequirements, conversionPending),
    ],
    kind: ready ? "complete" : "warning",
    ready,
    state: ready ? "ready" : conversionPending ? "processing" : "setup_needed",
    status: ready ? "Ready" : conversionPending ? "Processing CV" : "Setup needed",
  };
}

// Webetu is hidden from the dashboard (pending extraction into its own project).
// Exported so its status logic stays covered by tests until the extraction.
export function webetuService(input: DashboardModelInput): DashboardService | null {
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

function formatDateTimeLabel(value: string | null, timezone?: string | null) {
  if (!value) return "Not reported";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not reported";
  const options: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
  };
  if (timezone) options.timeZone = timezone;
  try {
    return new Intl.DateTimeFormat("en-US", options).format(date);
  } catch {
    delete options.timeZone;
    return new Intl.DateTimeFormat("en-US", options).format(date);
  }
}

function taskStatusLabel(status: DashboardTaskStatus) {
  if (status === "running") return "Running";
  if (status === "paused") return "Paused";
  if (status === "failed") return "Failed";
  if (status === "disabled") return "Disabled";
  return "Active";
}

function taskStatusKind(status: DashboardTaskStatus): DashboardCronRow["statusKind"] {
  if (status === "failed") return "error";
  if (status === "paused") return "partial";
  return "live";
}

function serviceIsReadyForTask(taskId: DashboardTaskId, services: DashboardService[]) {
  if (taskId === "reserve_meals") {
    return services.some((service) => service.type === "webetu" && service.ready);
  }
  if (taskId === "search_apply_jobs") {
    return services.some((service) => service.type === "job-scout" && service.ready);
  }
  return services.some((service) => service.ready);
}

function telemetryCronRows(
  telemetry: DashboardSource<DashboardTelemetrySnapshot> | undefined,
  services: DashboardService[],
): DashboardCronRow[] {
  if (!telemetry?.available || !telemetry.data) return [];
  return telemetry.data.tasks
    .filter((task) => Boolean(taskMeta[task.taskId]))
    .filter((task) => task.enabled && task.status !== "disabled")
    .filter((task) => serviceIsReadyForTask(task.taskId, services))
    .sort((a, b) => {
      const aNext = a.nextRunAt ? new Date(a.nextRunAt).getTime() : Number.POSITIVE_INFINITY;
      const bNext = b.nextRunAt ? new Date(b.nextRunAt).getTime() : Number.POSITIVE_INFINITY;
      return aNext - bNext || a.taskId.localeCompare(b.taskId);
    })
    .map((task) => {
      const meta = taskMeta[task.taskId];
      return {
        ...meta,
        lastRun: formatDateTimeLabel(task.lastRunAt, task.timezone),
        lastRunAt: task.lastRunAt,
        schedule: task.scheduleLabel || "Schedule not reported",
        status: taskStatusLabel(task.status),
        statusKind: taskStatusKind(task.status),
        taskId: task.taskId,
      };
    });
}

function earliestNextRun(rows: DashboardCronRow[], telemetry: DashboardTelemetrySnapshot | null | undefined) {
  const rowIds = new Set(rows.map((row) => row.taskId));
  return (telemetry?.tasks ?? [])
    .filter((task) => rowIds.has(task.taskId) && task.nextRunAt)
    .sort((a, b) => new Date(a.nextRunAt as string).getTime() - new Date(b.nextRunAt as string).getTime())[0] ?? null;
}

function latestDeliveryRun(telemetry: DashboardTelemetrySnapshot | null | undefined) {
  return (telemetry?.tasks ?? [])
    .filter((task) => task.taskId === "deliver_results" && task.lastRunAt)
    .sort((a, b) => new Date(b.lastRunAt as string).getTime() - new Date(a.lastRunAt as string).getTime())[0] ?? null;
}

export function buildDashboardViewModel(input: DashboardModelInput): DashboardViewModel {
  const services = [jobScoutService(input)].filter(
    (service): service is DashboardService => Boolean(service),
  );
  const cronRows = telemetryCronRows(input.telemetry, services);
  const readyServices = services.filter((service) => service.ready);
  const telemetryAvailable = input.telemetry?.available ?? true;
  const hasStatusError = !input.account.available || !input.jobScout.available || !telemetryAvailable;

  let hero: DashboardViewModel["hero"];
  if (readyServices.length > 0) {
    hero = {
      title: "Your AI agent is working for you.",
      copy: `Genaie is handling ${readyServices.map((service) => service.name).join(" and ")}.`,
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
      copy: "Set up Job Scout to begin scheduled work.",
    };
  }

  const nextRunTask = earliestNextRun(cronRows, input.telemetry?.data);
  const deliveryTask = latestDeliveryRun(input.telemetry?.data);

  return {
    connections: {
      google: googleConnection(input.account),
      whatsapp: whatsappConnection(input.account),
    },
    cronRows,
    hasStatusError,
    hero,
    lastDeliveryCopy: deliveryTask?.lastRunSummary || (deliveryTask ? "Last agent delivery" : "Nothing delivered yet"),
    lastDeliveryLabel: formatDateTimeLabel(deliveryTask?.lastRunAt ?? null, deliveryTask?.timezone).replace("Not reported", "No deliveries"),
    nextRunCopy: nextRunTask ? "Live agent schedule" : readyServices.length > 0 ? "No live schedule reported yet" : "Nothing scheduled yet",
    nextRunLabel: formatDateTimeLabel(nextRunTask?.nextRunAt ?? null, nextRunTask?.timezone).replace("Not reported", "No run scheduled"),
    services,
    telemetryAvailable,
    whatsappSuggestionHref:
      input.account.available && input.account.data && !input.account.data.whatsappLinked
        ? `/${input.publicUserId}/whatsapp`
        : null,
  };
}
