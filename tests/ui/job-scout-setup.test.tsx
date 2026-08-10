import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getJobScoutStatusForUser: vi.fn(),
  getSignedInAccountStatus: vi.fn(),
  resolvePublicUser: vi.fn(),
  syncUserToCentralData: vi.fn(),
  verifyFirebaseSessionCookie: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: () => ({ value: "session" }) })),
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => { throw new Error("notFound"); }),
  redirect: vi.fn((url: string) => { throw new Error(`redirect:${url}`); }),
}));

vi.mock("@/src/security/session", () => ({
  verifyFirebaseSessionCookie: mocks.verifyFirebaseSessionCookie,
}));

vi.mock("@/src/domains/users", () => ({
  getSignedInAccountStatus: mocks.getSignedInAccountStatus,
  resolvePublicUser: mocks.resolvePublicUser,
  syncUserToCentralData: mocks.syncUserToCentralData,
}));

vi.mock("@/src/domains/job-scout", () => ({
  getJobScoutStatusForUser: mocks.getJobScoutStatusForUser,
}));

import JobScoutSetupPage from "@/app/[publicUserId]/job-scout/page";

const publicUserId = "usr_1234567890abcdef";

async function renderPage(configured: boolean, autoApply: boolean) {
  mocks.getJobScoutStatusForUser.mockResolvedValue({
    configured,
    preferences: {
      autoApply,
      country: "dz",
      locations: [],
      targetRoles: [],
    },
  });
  const page = await JobScoutSetupPage({
    params: Promise.resolve({ publicUserId }),
    searchParams: Promise.resolve({ onboarding: "1" }),
  });
  render(page);
  // In onboarding mode the automatic-applications checkbox lives on the review
  // step, which starts with the `hidden` attribute until the wizard script
  // advances to it, so include hidden elements when querying.
  return screen.getByRole("checkbox", {
    name: /automatically submit suitable applications/i,
    hidden: true,
  });
}

describe("Job Scout setup automatic applications", () => {
  beforeEach(() => {
    mocks.verifyFirebaseSessionCookie.mockResolvedValue({
      uid: "fresh-user",
      email: "fresh@example.com",
      name: "Fresh User",
    });
    mocks.resolvePublicUser.mockResolvedValue({
      id: "fresh-user",
      profile: { email: "fresh@example.com", displayName: "Fresh User" },
    });
    mocks.getSignedInAccountStatus.mockResolvedValue({ plan: "free", whatsappLinked: false });
  });

  afterEach(cleanup);

  it("defaults automatic applications off for a new profile", async () => {
    expect(await renderPage(false, true)).not.toBeChecked();
  });

  it("preserves the saved choice for an existing profile", async () => {
    expect(await renderPage(true, true)).toBeChecked();
  });

  it("consolidates role, location and country and drops the CV screen and heading", async () => {
    mocks.getJobScoutStatusForUser.mockResolvedValue({
      configured: false,
      preferences: { autoApply: false, country: "dz", locations: [], targetRoles: [] },
    });
    const page = await JobScoutSetupPage({
      params: Promise.resolve({ publicUserId }),
      searchParams: Promise.resolve({ onboarding: "1" }),
    });
    const { container } = render(page);

    // No CV upload and no "Job Scout Setup" heading in the onboarding wizard.
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(screen.queryByRole("heading", { name: /job scout setup/i })).toBeNull();

    // Role, location and country all live on the first (visible) step.
    expect(screen.getByRole("textbox", { name: /target role/i })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /target location/i })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /country code/i })).toBeInTheDocument();
  });
});
