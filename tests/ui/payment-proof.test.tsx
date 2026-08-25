import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { PaymentProofUpload } from "@/app/payment/payment-proof-upload";
import { saveCvDraft, type CvDraft } from "@/app/[publicUserId]/create-cv/cv-draft";

function draft(overrides: Partial<CvDraft> = {}): CvDraft {
  return {
    fullName: "Jordan Lee",
    email: "jordan@example.com",
    phone: "",
    location: "",
    summary: "",
    skills: "",
    experience: [],
    education: [],
    referees: [],
    ...overrides,
  };
}

// The component only reads response.ok / response.blob() / response.json(), so a
// plain stub avoids jsdom's Response<->Blob incompatibility.
function pdfResponse() {
  return {
    ok: true,
    status: 200,
    blob: async () => new Blob(["%PDF-1.4 fake"], { type: "application/pdf" }),
    json: async () => ({}),
  };
}

function errorResponse(status: number, error: string) {
  return {
    ok: false,
    status,
    blob: async () => new Blob([]),
    json: async () => ({ ok: false, error }),
  };
}

describe("PaymentProofUpload", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.sessionStorage.clear();
    fetchMock = vi.fn().mockResolvedValue(pdfResponse());
    vi.stubGlobal("fetch", fetchMock);
    // jsdom lacks object-URL helpers used to trigger the download.
    vi.stubGlobal("URL", Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:cv"),
      revokeObjectURL: vi.fn(),
    }));
    // Don't let the temporary <a download> actually navigate in jsdom.
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
    clickSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("renders a submit button for each method", () => {
    render(createElement(PaymentProofUpload, { method: "EcoCash" }));
    expect(screen.getByRole("button", { name: /send payment proof/i })).toBeInTheDocument();

    const { container } = render(createElement(PaymentProofUpload, { method: "Poste" }));
    expect(container.querySelector('input[type="file"]')).not.toBeNull();
  });

  it("posts the CV draft to /payment/download and triggers a PDF download", async () => {
    saveCvDraft(draft({ template: "classic" }));
    render(createElement(PaymentProofUpload, { method: "EcoCash" }));

    fireEvent.click(screen.getByRole("button", { name: /send payment proof/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/payment/download");
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("same-origin");
    expect(JSON.parse(String(init?.body))).toEqual({ cv: draft({ template: "classic" }), template: "classic" });

    await screen.findByText(/downloading/i);
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("shows an error and does not submit when no CV draft exists", async () => {
    render(createElement(PaymentProofUpload, { method: "Poste" }));

    fireEvent.click(screen.getByRole("button", { name: /send payment proof/i }));

    await screen.findByText(/build your cv first/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a server error without triggering a download", async () => {
    saveCvDraft(draft());
    fetchMock.mockResolvedValueOnce(errorResponse(400, "A CV is required to build your download."));
    render(createElement(PaymentProofUpload, { method: "EcoCash" }));

    fireEvent.click(screen.getByRole("button", { name: /send payment proof/i }));

    await screen.findByText(/a cv is required/i);
    expect(clickSpy).not.toHaveBeenCalled();
  });
});
