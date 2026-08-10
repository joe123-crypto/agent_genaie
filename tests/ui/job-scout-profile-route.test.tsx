import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getJobScoutCvFileRef: vi.fn(),
  getJobScoutStatusForUser: vi.fn(),
  saveJobScoutCv: vi.fn(),
  saveJobScoutProfile: vi.fn(),
  syncUserToCentralData: vi.fn(),
  updateSignedInDisplayName: vi.fn(),
  verifyFirebaseRequest: vi.fn(),
}));

vi.mock("@/src/security/session", () => ({
  verifyFirebaseRequest: mocks.verifyFirebaseRequest,
}));

vi.mock("@/src/domains/users", () => ({
  syncUserToCentralData: mocks.syncUserToCentralData,
  updateSignedInDisplayName: mocks.updateSignedInDisplayName,
}));

vi.mock("@/src/domains/job-scout", () => ({
  getJobScoutCvFileRef: mocks.getJobScoutCvFileRef,
  getJobScoutStatusForUser: mocks.getJobScoutStatusForUser,
  saveJobScoutCv: mocks.saveJobScoutCv,
  saveJobScoutProfile: mocks.saveJobScoutProfile,
}));

import { POST } from "@/app/job-scout/profile/route";

function requestWithAutoApply(autoApply: boolean) {
  const form = new FormData();
  form.set("displayName", "Fresh User");
  form.set("targetRole", "Software Engineer");
  form.set("targetLocation", "Algiers");
  form.set("country", "dz");
  form.set("profileConfirmed", "on");
  form.set("safetyAcknowledged", "on");
  if (autoApply) form.set("autoApply", "on");
  return new Request("https://www.genaie.site/job-scout/profile", {
    method: "POST",
    body: form,
  });
}

describe("Job Scout profile route", () => {
  beforeEach(() => {
    mocks.verifyFirebaseRequest.mockResolvedValue({ uid: "fresh-user" });
    mocks.getJobScoutCvFileRef.mockResolvedValue("fresh-user/cv/base/cv.html");
    mocks.getJobScoutStatusForUser.mockResolvedValue({ ready: true });
    mocks.saveJobScoutProfile.mockResolvedValue({ ok: true });
  });

  it("persists automatic applications as disabled when the checkbox is left off", async () => {
    const response = await POST(requestWithAutoApply(false) as never);

    expect(response.status).toBe(200);
    expect(mocks.saveJobScoutProfile).toHaveBeenCalledWith(expect.objectContaining({
      preferences: expect.objectContaining({ autoApply: false }),
    }));
  });

  it("only enables automatic applications after an explicit checkbox selection", async () => {
    const response = await POST(requestWithAutoApply(true) as never);

    expect(response.status).toBe(200);
    expect(mocks.saveJobScoutProfile).toHaveBeenCalledWith(expect.objectContaining({
      preferences: expect.objectContaining({ autoApply: true }),
    }));
  });

  it("saves the profile even when no CV is on file or uploaded", async () => {
    mocks.getJobScoutCvFileRef.mockResolvedValue(null);

    const response = await POST(requestWithAutoApply(false) as never);

    expect(response.status).toBe(200);
    expect(mocks.saveJobScoutProfile).toHaveBeenCalledWith(expect.objectContaining({
      preferences: expect.objectContaining({ targetRoles: ["Software Engineer"] }),
    }));
  });
});
