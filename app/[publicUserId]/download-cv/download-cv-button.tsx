"use client";

import { useState } from "react";
import { StatusNotice } from "@/app/_components/status-ui";

// Downloads the CV PDF from the server route. We fetch rather than navigate so a
// worker outage surfaces as an inline message instead of a broken PDF tab.
export function DownloadCvButton({ href }: { href: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(href, { method: "GET", credentials: "same-origin" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const base = body.error || "Could not generate your CV PDF.";
        // Only invite a retry for server-side failures; 4xx (not approved, not
        // signed in) won't change on retry, so we don't tell the user to try again.
        setError(response.status >= 500 ? `${base} Please try again.` : base);
        return;
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
    } catch {
      // fetch itself threw (network/offline) — retrying may help.
      setError("Could not download your CV. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="actions actions-spaced">
        <button type="button" onClick={download} disabled={busy}>
          {busy ? "Preparing PDF…" : "Download PDF"}
        </button>
      </div>
      {error ? (
        <StatusNotice kind="error" variant="block" role="alert">
          {error}
        </StatusNotice>
      ) : null}
    </>
  );
}
