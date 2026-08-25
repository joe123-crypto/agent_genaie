"use client";

import { useRef, useState } from "react";
import { ImageUp } from "lucide-react";
import { StatusNotice, type StatusKind } from "@/app/_components/status-ui";
import { loadCvDraft } from "@/app/[publicUserId]/create-cv/cv-draft";

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024;

type PaymentProofUploadProps = {
  method: string;
};

export function PaymentProofUpload({ method }: PaymentProofUploadProps) {
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: StatusKind; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setFileName(file?.name ?? null);
  }

  async function submitProof(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    // Owner decision: the CV downloads directly from the draft — no payment
    // proof, no admin approval, no verification. A screenshot is optional; the
    // button just builds and downloads the CV PDF.
    const draft = loadCvDraft();
    if (!draft || !draft.fullName.trim()) {
      setNotice({
        kind: "error",
        message: "Please build your CV first, then come back to download it.",
      });
      return;
    }

    setBusy(true);
    setNotice({ kind: "loading", message: "Preparing your CV download..." });
    try {
      const response = await fetch("/payment/download", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cv: draft, template: draft.template }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `Request failed with ${response.status}`);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "cv.pdf";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      setNotice({ kind: "complete", message: "Your CV is downloading now." });
      setFileName(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not download your CV.";
      setNotice({ kind: "error", message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="payment-proof" onSubmit={submitProof}>
      <label>
        <span className="payment-proof-label">Payment proof</span>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={handleFileChange}
          disabled={busy}
        />
        <span className="file-note">{fileName || "PNG, JPEG, or WebP, max 5 MB."}</span>
      </label>
      <div className="actions">
        <button type="submit" disabled={busy}>
          <ImageUp aria-hidden="true" />
          {busy ? "Sending..." : "Send payment proof"}
        </button>
      </div>
      {notice ? <StatusNotice kind={notice.kind}>{notice.message}</StatusNotice> : null}
    </form>
  );
}
