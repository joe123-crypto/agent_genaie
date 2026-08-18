import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";

// Regression coverage for the interview -> create-cv form handoff. The bug: the
// public interview page baked `?from=interview` into `formPath`, and the
// interview's completion effect appended it a second time, producing
// `/create-cv?from=interview&from=interview`. The App Router parses the repeated
// key as an array, so `query.from === "interview"` was false and the form never
// hydrated the CV draft — it came up completely empty.
const mocks = vi.hoisted(() => ({
  cookieValue: { current: undefined as string | undefined },
  cvInterviewProps: { current: null as Record<string, unknown> | null },
  createCvFormProps: { current: null as Record<string, unknown> | null },
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: () => (mocks.cookieValue.current ? { value: mocks.cookieValue.current } : undefined),
  })),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
}));

vi.mock("@/src/security/session", () => ({
  verifyFirebaseSessionCookie: vi.fn(),
}));

vi.mock("@/src/domains/users", () => ({
  getSignedInAccountStatus: vi.fn(),
  syncUserToCentralData: vi.fn(),
}));

vi.mock("@/app/[publicUserId]/create-cv/interview/cv-interview", () => ({
  CvInterview: (props: Record<string, unknown>) => {
    mocks.cvInterviewProps.current = props;
    return createElement("div", { "data-testid": "cv-interview" });
  },
}));

vi.mock("@/app/[publicUserId]/create-cv/create-cv-form", () => ({
  CreateCvForm: (props: Record<string, unknown>) => {
    mocks.createCvFormProps.current = props;
    return createElement("div", { "data-testid": "create-cv-form" });
  },
}));

import PublicCreateCvInterviewPage from "@/app/create-cv/interview/page";
import PublicCreateCvPage from "@/app/create-cv/page";

describe("interview -> create-cv handoff (anonymous path)", () => {
  beforeEach(() => {
    // Signed out: the anonymous landing path skips the auth/redirect block.
    mocks.cookieValue.current = undefined;
    mocks.cvInterviewProps.current = null;
    mocks.createCvFormProps.current = null;
  });

  afterEach(cleanup);

  it("passes a formPath WITHOUT a pre-baked from=interview so the effect adds it exactly once", async () => {
    const page = await PublicCreateCvInterviewPage();
    render(page);

    // The completion effect appends `?from=interview` itself; baking it in here
    // is what produced the duplicated param and the empty form.
    expect(mocks.cvInterviewProps.current?.formPath).toBe("/create-cv");
  });

  it("hydrates the draft when from=interview arrives as a plain string", async () => {
    const page = await PublicCreateCvPage({
      searchParams: Promise.resolve({ from: "interview" }),
    });
    render(page);

    expect(mocks.createCvFormProps.current?.hydrateDraft).toBe(true);
  });

  it("still hydrates when from=interview arrives as a repeated (array) query param", async () => {
    const page = await PublicCreateCvPage({
      // A duplicated key parses to an array in the App Router.
      searchParams: Promise.resolve({ from: ["interview", "interview"] }),
    });
    render(page);

    expect(mocks.createCvFormProps.current?.hydrateDraft).toBe(true);
  });

  it("does not hydrate on a direct visit with no from param", async () => {
    const page = await PublicCreateCvPage({
      searchParams: Promise.resolve({}),
    });
    render(page);

    expect(mocks.createCvFormProps.current?.hydrateDraft).toBe(false);
  });
});
