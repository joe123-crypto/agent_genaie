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

    const draft = loadCvDraft();
    if (!draft || !draft.fullName.trim()) {
      setNotice({
        kind: "error",
        message: "Please build your CV first, then come back to send your payment proof.",
      });
      return;
    }

    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setNotice({ kind: "error", message: "Choose a screenshot of your payment first." });
      return;
    }
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setNotice({ kind: "error", message: "Please upload a PNG, JPEG, or WebP screenshot." });
      return;
    }
    if (file.size > MAX_BYTES) {
      setNotice({ kind: "error", message: "That screenshot is too large — the limit is 5 MB." });
      return;
    }

    setBusy(true);
    setNotice({ kind: "loading", message: "Sending your payment proof..." });
    try {
      const form = new FormData();
      form.append("method", method);
      form.append("cv", JSON.stringify(draft));
      form.append("screenshot", file);

      const response = await fetch("/payment/proof", {
        method: "POST",
        credentials: "same-origin",
        body: form,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || `Request failed with ${response.status}`);
      }

      setNotice({
        kind: "complete",
        message: "Proof received — we'll email you once your payment is approved.",
      });
      setFileName(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not send your payment proof.";
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
