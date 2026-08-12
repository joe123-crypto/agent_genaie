"use client";

import { useEffect, useRef, useState } from "react";
import { GoogleAuthProvider, signInWithCredential } from "firebase/auth";
import { StatusNotice, type StatusKind } from "@/app/_components/status-ui";
import {
  authErrorDetails,
  createAndVerifyServerSession,
  destinationForSession,
  safeNext,
} from "@/src/auth/login";
import { initializeFirebaseClient, loadFirebaseClientSettings } from "@/src/firebase/client";

type PendingGrant = {
  googleIdToken: string;
  gmailGranted: boolean;
  next: string;
};

function finishErrorMessage(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  if (code === "auth/account-exists-with-different-credential") {
    return "An account already exists with this email address using a different sign-in method. Sign in the way you did originally, then connect Google from your account.";
  }
  if (code === "auth/invalid-credential") {
    return "Firebase rejected this Google sign-in. The app's Google OAuth client ID is most likely not whitelisted in the Firebase Console under Authentication -> Sign-in method -> Google -> \"Whitelist client IDs from external projects\".";
  }
  return authErrorDetails(error).message;
}

async function readPendingGrant(): Promise<PendingGrant> {
  const response = await fetch("/auth/google/finish/token", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
  });
  const body = (await response.json().catch(() => ({}))) as Partial<PendingGrant> & { error?: string };
  if (!response.ok || !body.googleIdToken) {
    throw new Error(body.error || "This sign-in attempt expired. Please sign in again.");
  }
  return {
    googleIdToken: body.googleIdToken,
    gmailGranted: Boolean(body.gmailGranted),
    next: body.next || "/",
  };
}

export default function GoogleFinishPage() {
  const completingRef = useRef(false);
  const [notice, setNotice] = useState<{ kind: StatusKind; message: string }>({
    kind: "loading",
    message: "Finishing Google sign-in...",
  });

  useEffect(() => {
    let active = true;

    async function finish() {
      // The pending record is one-shot at every hop, so a StrictMode double-invoke
      // would consume it and fail the second pass.
      if (completingRef.current) return;
      completingRef.current = true;
      try {
        const grant = await readPendingGrant();
        const settings = await loadFirebaseClientSettings();
        const authInstance = initializeFirebaseClient(settings);
        const result = await signInWithCredential(
          authInstance,
          GoogleAuthProvider.credential(grant.googleIdToken)
        );
        const idToken = await result.user.getIdToken(true);
        const session = await createAndVerifyServerSession(idToken, result.user.uid);

        if (grant.gmailGranted) {
          setNotice({ kind: "loading", message: "Connecting your Gmail account..." });
          // A failed claim must not strand a signed-in user: Gmail can be connected
          // later from the dashboard.
          await fetch("/auth/google/claim", {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
          }).catch(() => undefined);
        }

        if (!active) return;
        setNotice({ kind: "complete", message: "Signed in. Opening your account..." });
        window.location.assign(destinationForSession(session, safeNext(grant.next)));
      } catch (error) {
        if (!active) return;
        setNotice({ kind: "error", message: finishErrorMessage(error) });
      }
    }

    void finish();
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="app-main app-main-center">
      <section className="panel panel-narrow">
        <a className="toplink" href="/login">Back to sign in</a>
        <h1>Finish sign in</h1>
        <p>The app is completing your Google sign-in and Gmail connection.</p>
        <StatusNotice kind={notice.kind} role="status" aria-live="polite" variant="block">
          {notice.message}
        </StatusNotice>
      </section>
    </main>
  );
}
