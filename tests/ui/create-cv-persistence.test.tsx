import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createElement } from "react";

// Coverage for session persistence on the create-CV form: with `persistDraft`
// on, edits are mirrored into the sessionStorage draft on every change and
// restored on mount, so a reload or a trip to another page and back resumes
// where the user left off. The draft store (key "genaie:cv-draft") is shared
// with the interview/deferred handoffs.
import { CreateCvForm } from "@/app/[publicUserId]/create-cv/create-cv-form";

const DRAFT_KEY = "genaie:cv-draft";

describe("create-CV form session persistence", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
  });

  it("mirrors edits into the sessionStorage draft as the user types", () => {
    render(
      createElement(CreateCvForm, {
        jobScoutPath: "/",
        saveMode: "deferred",
        persistDraft: true,
      }),
    );

    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "Jordan Lee" },
    });
    fireEvent.change(screen.getByLabelText(/Skills/), {
      target: { value: "React, TypeScript" },
    });

    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    expect(raw).toBeTruthy();
    const draft = JSON.parse(raw as string);
    expect(draft.fullName).toBe("Jordan Lee");
    expect(draft.skills).toBe("React, TypeScript");
  });

  it("restores the saved draft on a fresh mount (simulating a reload)", () => {
    const { unmount } = render(
      createElement(CreateCvForm, {
        jobScoutPath: "/",
        saveMode: "deferred",
        persistDraft: true,
      }),
    );

    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "Jordan Lee" },
    });
    expect(window.sessionStorage.getItem(DRAFT_KEY)).toContain("Jordan Lee");

    // Reload: tear the component down and mount it again from scratch.
    unmount();
    render(
      createElement(CreateCvForm, {
        jobScoutPath: "/",
        saveMode: "deferred",
        persistDraft: true,
      }),
    );

    // A restored draft with a name leads with the preview and tucks the fields
    // away, so open the details panel before asserting the field was restored.
    fireEvent.click(screen.getByRole("button", { name: /edit details/i }));
    expect(screen.getByDisplayValue("Jordan Lee")).toBeInTheDocument();
  });

  it("does not write the draft when persistDraft is off", () => {
    render(
      createElement(CreateCvForm, {
        jobScoutPath: "/",
        saveMode: "deferred",
      }),
    );

    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "Jordan Lee" },
    });

    expect(window.sessionStorage.getItem(DRAFT_KEY)).toBeNull();
  });
});
