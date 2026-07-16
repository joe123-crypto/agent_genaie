import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { endDashboardSession } from "@/app/_components/dashboard-account-menu";
import { buildDashboardViewModel, type DashboardModelInput } from "@/app/_components/dashboard-model";
import { DashboardOverview } from "@/app/_components/dashboard-overview";
import { DashboardSettings } from "@/app/_components/dashboard-settings";
import { DashboardShell } from "@/app/_components/dashboard-shell";

vi.mock("next/image", () => ({
  default: ({ src, priority: _priority, ...props }: {
    src: string | { src: string };
    priority?: boolean;
    alt: string;
  }) => createElement("img", {
    ...props,
    src: typeof src === "string" ? src : src.src,
  }),
}));

const publicUserId = "usr_1234567890abcdef";

function readyInput(overrides: Partial<DashboardModelInput> = {}): DashboardModelInput {
  return {
    account: {
      available: true,
      data: {
        maskedPhone: "+213...0000",
        services: {
          calendar: "connected",
          gmail: "connected",
          jobs: "subscribed",
          webetu: "connected",
        },
        whatsappLinked: true,
      },
    },
    jobScout: {
      available: true,
      data: {
        configured: true,
        cvAvailable: true,
        gmailConnected: true,
        linked: true,
        missingRequirements: [],
        ready: true,
      },
    },
    publicUserId,
    telemetry: {
      available: true,
      data: { tasks: [] },
    },
    webetu: {
      available: true,
      data: {
        configured: true,
        status: "active",
        whatsappLinked: true,
      },
    },
    ...overrides,
  };
}

function dashboardModel(overrides: Partial<DashboardModelInput> = {}) {
  return buildDashboardViewModel(readyInput(overrides));
}

describe("signed-in dashboard UI", () => {
  afterEach(cleanup);

  it("renders the requested navigation and a working account menu trigger", () => {
    render(
      <DashboardShell active="overview" publicUserId={publicUserId} userLabel="Joseph">
        <div>Dashboard content</div>
      </DashboardShell>,
    );

    const nav = screen.getByRole("navigation", { name: /primary dashboard navigation/i });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "Overview",
      "Job Scout",
      "Webetu Reservations",
      "Settings",
    ]);
    expect(screen.getByRole("link", { name: /overview/i })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Genaie Scout")).toBeVisible();
    expect(screen.queryByRole("img", { name: /robot/i })).not.toBeInTheDocument();

    const accountButton = screen.getByRole("button", { name: /joseph/i });
    expect(accountButton).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(accountButton);
    expect(accountButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menuitem", { name: /privacy/i })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: /sign out/i })).toBeVisible();
  });

  it("shows connection status and no dummy cron rows when telemetry is empty", () => {
    render(<DashboardOverview {...dashboardModel()} />);

    expect(screen.getByRole("heading", { name: "Overview" })).toBeVisible();
    expect(screen.getByRole("img", { name: /robot assistant holding an envelope/i })).toHaveAttribute("src", "/Pasted image (2).png");
    expect(screen.getAllByText(/whatsapp linked/i).length).toBeGreaterThan(0);
    expect(screen.getByText("Google linked")).toBeVisible();
    expect(screen.getByText("Job Scout")).toBeVisible();
    expect(screen.getAllByText("Webetu Reservations").length).toBeGreaterThan(0);
    expect(screen.getAllByText("No live schedule reported yet").length).toBeGreaterThan(0);
    expect(screen.queryByText("Reserve Meals")).not.toBeInTheDocument();
    expect(screen.queryByText("Search & Apply Jobs")).not.toBeInTheDocument();
    expect(screen.queryByText("Sample schedule")).not.toBeInTheDocument();
    expect(screen.queryByText("Sample delivery")).not.toBeInTheDocument();
  });

  it("renders active cron rows and metrics from live telemetry", () => {
    render(
      <DashboardOverview
        {...dashboardModel({
          telemetry: {
            available: true,
            data: {
              tasks: [
                {
                  enabled: true,
                  lastRunAt: "2026-07-16T06:45:00.000Z",
                  lastRunStatus: "success",
                  lastRunSummary: "Meals reserved",
                  nextRunAt: "2026-07-17T09:00:00.000Z",
                  scheduleLabel: "Daily - 10:00 AM",
                  service: "webetu",
                  status: "active",
                  taskId: "reserve_meals",
                  timezone: "Africa/Algiers",
                  updatedAt: "2026-07-16T07:00:00.000Z",
                },
                {
                  enabled: true,
                  lastRunAt: "2026-07-16T08:15:00.000Z",
                  lastRunStatus: "success",
                  lastRunSummary: "Results delivered",
                  nextRunAt: null,
                  scheduleLabel: "After each task run",
                  service: "delivery",
                  status: "running",
                  taskId: "deliver_results",
                  timezone: "Africa/Algiers",
                  updatedAt: "2026-07-16T08:20:00.000Z",
                },
              ],
            },
          },
        })}
      />,
    );

    const metrics = screen.getByLabelText("Agent schedule metrics");
    expect(within(metrics).getByText("2")).toBeVisible();
    expect(within(metrics).getByText("10:00 AM")).toBeVisible();
    expect(within(metrics).getByText("9:15 AM")).toBeVisible();
    expect(screen.getByText("Reserve Meals")).toBeVisible();
    expect(screen.getByText("Deliver Results")).toBeVisible();
    expect(screen.getByText("Daily - 10:00 AM")).toBeVisible();
    expect(screen.getByText("Running")).toBeVisible();
  });

  it("reports partial Google access and keeps Webetu pending until WhatsApp is linked", () => {
    const model = dashboardModel({
      account: {
        available: true,
        data: {
          services: { calendar: "not_connected", gmail: "connected", webetu: "connected" },
          whatsappLinked: false,
        },
      },
      jobScout: { available: true, data: { configured: false } },
      webetu: {
        available: true,
        data: { configured: true, status: "active", whatsappLinked: false },
      },
    });

    expect(model.connections.google.state).toBe("partial");
    expect(model.connections.google.label).toBe("Google partially linked");
    expect(model.services).toEqual([
      expect.objectContaining({ name: "Webetu Reservations", ready: false, state: "setup_needed" }),
    ]);
    expect(model.cronRows).toEqual([]);
    expect(model.nextRunLabel).toBe("No run scheduled");
  });

  it("keeps revoked Webetu visible even after its service flag becomes not connected", () => {
    const model = dashboardModel({
      account: {
        available: true,
        data: { services: { webetu: "not_connected" }, whatsappLinked: true },
      },
      jobScout: { available: true, data: { configured: false } },
      webetu: {
        available: true,
        data: { configured: false, status: "revoked", whatsappLinked: true },
      },
    });

    expect(model.services).toEqual([
      expect.objectContaining({ name: "Webetu Reservations", state: "revoked", status: "Credentials revoked" }),
    ]);
  });

  it("only schedules rows from ready services and valid enabled telemetry", () => {
    const model = dashboardModel({
      webetu: { available: true, data: { configured: false, status: "not_saved" } },
      telemetry: {
        available: true,
        data: {
          tasks: [
            {
              enabled: true,
              lastRunAt: "2026-07-16T08:15:00.000Z",
              lastRunStatus: "success",
              lastRunSummary: "Applications checked",
              nextRunAt: "2026-07-17T11:00:00.000Z",
              scheduleLabel: "Daily - 12:00 PM",
              service: "job_scout",
              status: "active",
              taskId: "search_apply_jobs",
              timezone: "Africa/Algiers",
              updatedAt: "2026-07-16T08:20:00.000Z",
            },
            {
              enabled: true,
              lastRunAt: null,
              lastRunStatus: null,
              lastRunSummary: null,
              nextRunAt: "2026-07-17T09:00:00.000Z",
              scheduleLabel: "Daily - 10:00 AM",
              service: "webetu",
              status: "active",
              taskId: "reserve_meals",
              timezone: "Africa/Algiers",
              updatedAt: null,
            },
            {
              enabled: false,
              lastRunAt: null,
              lastRunStatus: null,
              lastRunSummary: null,
              nextRunAt: "2026-07-17T12:00:00.000Z",
              scheduleLabel: "Disabled task",
              service: "delivery",
              status: "disabled",
              taskId: "deliver_results",
              timezone: "Africa/Algiers",
              updatedAt: null,
            },
          ],
        },
      },
    });

    expect(model.cronRows.map((row) => row.task)).toEqual(["Search & Apply Jobs"]);
    expect(model.nextRunLabel).toBe("12:00 PM");
  });

  it("ignores unknown telemetry tasks", () => {
    const model = dashboardModel({
      telemetry: {
        available: true,
        data: {
          tasks: [
            {
              enabled: true,
              lastRunAt: null,
              lastRunStatus: null,
              lastRunSummary: null,
              nextRunAt: "2026-07-16T08:00:00.000Z",
              scheduleLabel: "Bad task",
              service: "webetu",
              status: "active",
              taskId: "unknown" as any,
              timezone: "Africa/Algiers",
              updatedAt: null,
            },
          ],
        },
      },
    });

    expect(model.cronRows).toEqual([]);
  });

  it("does not turn data-loading failures into disconnected states", () => {
    const model = dashboardModel({
      account: {
        available: true,
        data: { services: { jobs: "subscribed" }, whatsappLinked: false },
      },
      jobScout: { available: false, data: null },
      webetu: { available: false, data: null },
    });

    expect(model.hasStatusError).toBe(true);
    expect(model.services).toEqual([
      expect.objectContaining({ name: "Job Scout", state: "unavailable", status: "Status unavailable" }),
    ]);
  });

  it("links Settings cards to Google and WhatsApp management", () => {
    render(
      <DashboardSettings
        calendarConnected={false}
        gmailConnected
        publicUserId={publicUserId}
        whatsappLinked={false}
      />,
    );

    expect(screen.getByRole("heading", { name: "Settings" })).toBeVisible();
    expect(screen.getByRole("link", { name: /connect google/i })).toHaveAttribute("href", `/${publicUserId}/connect-gmail`);
    expect(screen.getByRole("link", { name: /whatsapp linking/i })).toHaveAttribute("href", `/${publicUserId}/whatsapp`);
    expect(screen.getByText("Gmail connected")).toBeVisible();
    expect(screen.getByText("WhatsApp not linked")).toBeVisible();
    expect(screen.getByText(/complete google and whatsapp linking/i)).toBeVisible();
  });

  it("shows unavailable Settings states without calling them disconnected", () => {
    render(
      <DashboardSettings
        calendarConnected={false}
        gmailConnected={false}
        publicUserId={publicUserId}
        statusAvailable={false}
        whatsappLinked={false}
      />,
    );

    expect(screen.getByText("Gmail status unavailable")).toBeVisible();
    expect(screen.getByText("Calendar status unavailable")).toBeVisible();
    expect(screen.getByText("WhatsApp status unavailable")).toBeVisible();
    expect(screen.queryByText("WhatsApp not linked")).not.toBeInTheDocument();
  });

  it("clears the server session before redirecting from sign out", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      if (String(input) === "/auth/session/logout") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ configured: false, missing: ["config"] }), { status: 200 });
    });
    const redirect = vi.fn();

    await endDashboardSession(fetcher, redirect);

    expect(fetcher).toHaveBeenNthCalledWith(1, "/auth/session/logout", expect.objectContaining({ method: "POST" }));
    expect(redirect).toHaveBeenCalledWith("/login");
  });
});
