import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { buildDashboardViewModel, type DashboardModelInput } from "@/app/_components/dashboard-model";
import { DashboardOverview } from "@/app/_components/dashboard-overview";

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

function readyDashboard(overrides: Partial<DashboardModelInput> = {}) {
  return buildDashboardViewModel({
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
  });
}

describe("dashboard live telemetry model", () => {
  afterEach(cleanup);

  it("does not render dummy schedule rows when telemetry is empty", () => {
    render(<DashboardOverview {...readyDashboard()} />);

    expect(screen.getAllByText("No live schedule reported yet").length).toBeGreaterThan(0);
    expect(screen.queryByText("Reserve Meals")).not.toBeInTheDocument();
    expect(screen.queryByText("Search & Apply Jobs")).not.toBeInTheDocument();
    expect(screen.queryByText("Sample schedule")).not.toBeInTheDocument();
    expect(screen.queryByText("Sample delivery")).not.toBeInTheDocument();
  });

  it("renders active cron rows and metrics from live telemetry", () => {
    render(
      <DashboardOverview
        {...readyDashboard({
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

  it("ignores unknown and disabled telemetry tasks", () => {
    const model = readyDashboard({
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
            {
              enabled: false,
              lastRunAt: null,
              lastRunStatus: null,
              lastRunSummary: null,
              nextRunAt: "2026-07-16T09:00:00.000Z",
              scheduleLabel: "Disabled task",
              service: "job_scout",
              status: "disabled",
              taskId: "search_apply_jobs",
              timezone: "Africa/Algiers",
              updatedAt: null,
            },
          ],
        },
      },
    });

    expect(model.cronRows).toEqual([]);
    expect(model.nextRunLabel).toBe("No run scheduled");
  });
});
