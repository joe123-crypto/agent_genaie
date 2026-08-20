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

function pngFile(name = "receipt.png") {
  return new File(["fake-image-bytes"], name, { type: "image/png" });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("PaymentProofUpload", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.sessionStorage.clear();
    fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it("renders a file input and submit button for each method", () => {
    render(createElement(PaymentProofUpload, { method: "EcoCash" }));
    expect(screen.getByRole("button", { name: /send payment proof/i })).toBeInTheDocument();

    const { container } = render(createElement(PaymentProofUpload, { method: "Poste" }));
    expect(container.querySelector('input[type="file"]')).not.toBeNull();
  });

  it("posts the screenshot, method, and CV draft to /payment/proof", async () => {
    saveCvDraft(draft());
    const { container } = render(createElement(PaymentProofUpload, { method: "EcoCash" }));

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pngFile()] } });

    fireEvent.click(screen.getByRole("button", { name: /send payment proof/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/payment/proof");
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("same-origin");

    const body = init?.body as FormData;
    expect(body.get("method")).toBe("EcoCash");
    expect(body.get("screenshot")).toBeInstanceOf(File);
    expect(JSON.parse(String(body.get("cv")))).toEqual(draft());

    await screen.findByText(/proof received/i);
  });

  it("shows an error and does not submit when no CV draft exists", async () => {
    render(createElement(PaymentProofUpload, { method: "Poste" }));

    fireEvent.click(screen.getByRole("button", { name: /send payment proof/i }));

    await screen.findByText(/build your cv first/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an oversized file client-side without calling fetch", async () => {
    saveCvDraft(draft());
    const { container } = render(createElement(PaymentProofUpload, { method: "EcoCash" }));

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const big = pngFile("big.png");
    Object.defineProperty(big, "size", { value: 6 * 1024 * 1024 });
    fireEvent.change(input, { target: { files: [big] } });

    fireEvent.click(screen.getByRole("button", { name: /send payment proof/i }));

    await screen.findByText(/too large/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
