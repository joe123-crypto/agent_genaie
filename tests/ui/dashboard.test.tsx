import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
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

const cronRows = [
  {
    icon: "utensils" as const,
    lastRun: "Today, 7:45 AM",
    schedule: "Daily - 10:00 AM",
    service: "Webetu Progress",
    status: "Active",
    task: "Reserve Meals",
    type: "Reservation",
  },
  {
    icon: "briefcase" as const,
    lastRun: "Today, 9:15 AM",
    schedule: "Daily - 12:00 PM",
    service: "Job Applications",
    status: "Active",
    task: "Search & Apply Jobs",
    type: "Jobs",
  },
  {
    icon: "send" as const,
    lastRun: "Today, 9:15 AM",
    schedule: "After each task run",
    service: "WhatsApp",
    status: "Active",
    task: "Deliver Results",
    type: "Delivery",
  },
];

describe("signed-in dashboard UI", () => {
  afterEach(cleanup);

  it("renders the shell navigation in the requested order with Overview active", () => {
    render(
      createElement(DashboardShell, {
        active: "overview",
        publicUserId: "usr_1234567890abcdef",
        userLabel: "Joseph",
        children: createElement("div", null, "Dashboard content"),
      }),
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
  });

  it("shows connection status, registered services, hero image, and dummy cron rows", () => {
    render(
      createElement(DashboardOverview, {
        connections: {
          googleCalendarConnected: true,
          googleGmailConnected: true,
          whatsappLinked: true,
          whatsappMaskedPhone: "+213 *** 4567",
        },
        cronRows,
        lastDeliveryLabel: "Today, 7:45 AM",
        nextRunLabel: "In 2h 15m",
        nextRunTime: "10:00 AM",
        services: [
          {
            actionHref: "/usr_1234567890abcdef/job-scout",
            actionLabel: "Manage Job Scout",
            details: ["CV uploaded", "Google connected", "WhatsApp linked", "All setup requirements are complete."],
            kind: "complete",
            name: "Job Scout",
            status: "Ready",
            type: "job-scout",
          },
          {
            actionHref: "/usr_1234567890abcdef/vault",
            actionLabel: "Manage Webetu Reservations",
            details: ["Credentials saved", "WhatsApp delivery linked"],
            kind: "complete",
            name: "Webetu Reservations",
            status: "Ready",
            type: "webetu",
          },
        ],
      }),
    );

    expect(screen.getByRole("heading", { name: "Overview" })).toBeVisible();
    expect(screen.getByRole("img", { name: /robot assistant holding an envelope/i })).toHaveAttribute("src", "/Pasted image (2).png");
    expect(screen.getAllByText(/whatsapp linked/i).length).toBeGreaterThan(0);
    expect(screen.getByText("Google linked")).toBeVisible();
    expect(screen.getByText("Job Scout")).toBeVisible();
    expect(screen.getByText("Webetu Reservations")).toBeVisible();
    expect(screen.getByText("Reserve Meals")).toBeVisible();
    expect(screen.getByText("Search & Apply Jobs")).toBeVisible();
    expect(screen.getByText("Deliver Results")).toBeVisible();
  });

  it("links Settings cards to Google and WhatsApp linking pages", () => {
    render(
      createElement(DashboardSettings, {
        calendarConnected: false,
        gmailConnected: true,
        publicUserId: "usr_1234567890abcdef",
        whatsappLinked: false,
      }),
    );

    expect(screen.getByRole("heading", { name: "Settings" })).toBeVisible();
    expect(screen.getByRole("link", { name: /connect google/i })).toHaveAttribute("href", "/usr_1234567890abcdef/connect-gmail");
    expect(screen.getByRole("link", { name: /whatsapp linking/i })).toHaveAttribute("href", "/usr_1234567890abcdef/whatsapp");
    expect(screen.getByText("Gmail connected")).toBeVisible();
    expect(screen.getByText("WhatsApp not linked")).toBeVisible();
  });
});
