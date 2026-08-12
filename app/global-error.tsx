"use client";

import { useEffect } from "react";
// global-error replaces the root layout, so it must pull in the global styles and
// render its own <html>/<body>.
import "./globals.css";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the digest so a "server-side exception" shown to the user can be
    // matched to a real stack trace in the server logs.
    console.error("Unhandled application error", { digest: error.digest, message: error.message });
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main
          role="alert"
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "2rem",
            textAlign: "center",
          }}
        >
          <div style={{ maxWidth: "32rem" }}>
            <h1 style={{ fontSize: "1.5rem", marginBottom: "0.75rem" }}>Something went wrong</h1>
            <p style={{ marginBottom: "1.5rem", lineHeight: 1.5 }}>
              We hit an unexpected error while loading this page. Please try again — if it
              keeps happening, request a fresh link from WhatsApp or contact support.
            </p>
            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
              <button type="button" onClick={() => reset()} style={{ padding: "0.6rem 1.2rem" }}>
                Try again
              </button>
              <a href="/" style={{ padding: "0.6rem 1.2rem" }}>
                Go home
              </a>
            </div>
            {error.digest ? (
              <p style={{ marginTop: "1.25rem", fontSize: "0.8rem", opacity: 0.6 }}>
                Reference: {error.digest}
              </p>
            ) : null}
          </div>
        </main>
      </body>
    </html>
  );
}
