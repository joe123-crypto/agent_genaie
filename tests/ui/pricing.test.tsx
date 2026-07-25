import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  getSignedInAccountStatus: vi.fn(),
  syncUserToCentralData: vi.fn(),
  verifyFirebaseSessionCookie: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: mocks.cookies,
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => { throw new Error(`redirect:${url}`); }),
}));

vi.mock("@/src/security/session", () => ({
  verifyFirebaseSessionCookie: mocks.verifyFirebaseSessionCookie,
}));

vi.mock("@/src/domains/users", () => {
  const normalizeUserPlan = (value: unknown) => {
    const plan = String(value ?? "").trim().toLowerCase();
    return plan === "free" || plan === "pro" || plan === "ultra" ? plan : null;
  };
  return {
    getSignedInAccountStatus: mocks.getSignedInAccountStatus,
    normalizeUserPlan,
    syncUserToCentralData: mocks.syncUserToCentralData,
  };
});

import PricingPage from "@/app/pricing/page";

describe("Pricing page", () => {
  beforeEach(() => {
    mocks.cookies.mockResolvedValue({ get: () => undefined });
    mocks.verifyFirebaseSessionCookie.mockReset();
    mocks.getSignedInAccountStatus.mockReset();
    mocks.syncUserToCentralData.mockReset();
    mocks.syncUserToCentralData.mockResolvedValue({});
  });

  afterEach(cleanup);

  it("renders marketing pricing for logged-out visitors", async () => {
    const page = await PricingPage({ searchParams: Promise.resolve({}) });
    render(page);

    expect(screen.getByRole("heading", { name: "Pricing" })).toBeVisible();
    expect(screen.getByRole("heading", { name: /free plan/i })).toBeVisible();
    expect(screen.getByText("$5/month")).toBeVisible();
    expect(screen.getByRole("link", { name: /start free/i })).toHaveAttribute("href", "/login");
  });

  it("renders selectable plan forms for signed-in users without a plan", async () => {
    mocks.cookies.mockResolvedValue({ get: () => ({ value: "session" }) });
    mocks.verifyFirebaseSessionCookie.mockResolvedValue({ uid: "fresh-user" });
    mocks.getSignedInAccountStatus.mockResolvedValue({
      publicUserId: "usr_1234567890abcdef",
      plan: null,
    });

    const page = await PricingPage({
      searchParams: Promise.resolve({ next: "/usr_1234567890abcdef/onboarding" }),
    });
    render(page);

    const freeCard = screen.getByRole("heading", { name: /free plan/i }).closest("article");
    expect(freeCard).not.toBeNull();
    expect(within(freeCard as HTMLElement).getByRole("button", { name: /select free plan/i })).toBeVisible();
    expect(screen.getByDisplayValue("free")).toHaveAttribute("name", "plan");
    expect(screen.getAllByDisplayValue("/usr_1234567890abcdef/onboarding")).toHaveLength(3);
  });

  it("marks the current plan for signed-in users", async () => {
    mocks.cookies.mockResolvedValue({ get: () => ({ value: "session" }) });
    mocks.verifyFirebaseSessionCookie.mockResolvedValue({ uid: "pro-user" });
    mocks.getSignedInAccountStatus.mockResolvedValue({
      publicUserId: "usr_1234567890abcdef",
      plan: "pro",
    });

    const page = await PricingPage({
      searchParams: Promise.resolve({ next: "/usr_1234567890abcdef" }),
    });
    render(page);

    expect(screen.getByRole("button", { name: /continue with this plan/i })).toBeVisible();
  });
});
