"use client";

import { useEffect } from "react";
import { StatusNotice } from "@/app/_components/status-ui";

export default function ScopedRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Dashboard route error", { digest: error.digest, message: error.message });
  }, [error]);

  return (
    <main className="app-main app-main-center">
      <div className="shell shell-narrow">
        <StatusNotice kind="error" variant="block">
          Something went wrong loading this page. Please try again — if it keeps
          happening, request a fresh link from WhatsApp or contact support.
        </StatusNotice>
        <div className="actions">
          <button type="button" onClick={() => reset()}>Try again</button>
          <a className="button secondary" href="/">Go home</a>
        </div>
        {error.digest ? (
          <p className="meta"><span>Reference: {error.digest}</span></p>
        ) : null}
      </div>
    </main>
  );
}
