"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import {
  getRedirectResult,
  sendSignInLinkToEmail,
  type Auth,
  type User,
} from "firebase/auth";
import { StatusNotice, type StatusKind } from "@/app/_components/status-ui";
import {
  AUTH_NEXT_STORAGE_KEY,
  AUTH_REDIRECT_PENDING_STORAGE_KEY,
  authErrorDetails,
  createAndVerifyServerSession,
  destinationForSession,
  safeNext,
} from "@/src/auth/login";
import {
  initializeFirebaseClient,
  loadFirebaseClientSettings,
  type FirebaseClientSettings,
} from "@/src/firebase/client";

type Phase =
  | "loading"
  | "ready"
  | "google"
  | "email"
  | "session"
  | "redirecting"
  | "success"
  | "error";

type Notice = { kind: StatusKind; message: string };

function readStoredRedirectAttempt() {
  try {
    const pending = window.sessionStorage.getItem(AUTH_REDIRECT_PENDING_STORAGE_KEY) === "1";
    const nextPath = pending
      ? safeNext(window.sessionStorage.getItem(AUTH_NEXT_STORAGE_KEY))
      : null;
    return { pending, nextPath };
  } catch {
    return { pending: false, nextPath: null };
  }
}

function clearStoredRedirectAttempt() {
  try {
    window.sessionStorage.removeItem(AUTH_REDIRECT_PENDING_STORAGE_KEY);
    window.sessionStorage.removeItem(AUTH_NEXT_STORAGE_KEY);
  } catch {
    // Browsers that disable storage must still be able to use popup sign-in.
  }
}

export function LoginContent() {
  const [auth, setAuth] = useState<Auth | null>(null);
  const [settings, setSettings] = useState<FirebaseClientSettings | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [notice, setNotice] = useState<Notice>({
    kind: "loading",
    message: "Preparing secure sign-in...",
  });
  const [email, setEmail] = useState("");
  const completionRef = useRef<Promise<void> | null>(null);
  const actionInProgressRef = useRef(false);
  const searchParams = useSearchParams();
  const nextParam = safeNext(searchParams.get("next"));
  const busy = !auth || !settings || ["loading", "google", "email", "session", "redirecting", "success"].includes(phase);

  const completeSession = useCallback((user: User, redirectNext?: string | null) => {
    if (completionRef.current) return completionRef.current;

    const task = (async () => {
      setPhase("session");
      setNotice({ kind: "loading", message: "Finishing sign-in..." });
      const idToken = await user.getIdToken(true);
      const session = await createAndVerifyServerSession(idToken, user.uid);
      setPhase("success");
      setNotice({ kind: "complete", message: "Signed in. Opening your account..." });
      clearStoredRedirectAttempt();
      window.location.assign(destinationForSession(session, redirectNext || nextParam));
    })()
      .catch((error: unknown) => {
        clearStoredRedirectAttempt();
        const details = authErrorDetails(error);
        setPhase("error");
        setNotice({ kind: "error", message: details.message });
      })
      .finally(() => {
        completionRef.current = null;
      });

    completionRef.current = task;
    return task;
  }, [nextParam]);

  useEffect(() => {
    let active = true;

    async function initialize() {
      try {
        const loadedSettings = await loadFirebaseClientSettings();
        const authInstance = initializeFirebaseClient(loadedSettings);
        if (!active) return;
        setSettings(loadedSettings);
        setAuth(authInstance);
        const redirectAttempt = readStoredRedirectAttempt();

        let redirectResult = null;
        let redirectError: unknown = null;
        try {
          redirectResult = await getRedirectResult(authInstance);
        } catch (error) {
          redirectError = error;
        }
        await authInstance.authStateReady();
        if (!active) return;

        const signedInUser = redirectResult?.user ?? authInstance.currentUser;
        if (signedInUser) {
          await completeSession(
            signedInUser,
            redirectAttempt.pending ? redirectAttempt.nextPath : undefined,
          );
          return;
        }
        if (redirectError) {
          clearStoredRedirectAttempt();
          const details = authErrorDetails(redirectError);
          setPhase("error");
          setNotice({ kind: "error", message: details.message });
          return;
        }
        if (redirectAttempt.pending) {
          clearStoredRedirectAttempt();
          setPhase("error");
          setNotice({
            kind: "error",
            message: "Google returned to the app, but sign-in could not be completed. Please try again or use a magic link.",
          });
          return;
        }
        clearStoredRedirectAttempt();
        setPhase("ready");
        setNotice({ kind: "info", message: "Choose a sign-in method." });
      } catch (error) {
        if (!active) return;
        const details = authErrorDetails(error);
        setPhase("error");
        setNotice({ kind: "error", message: details.message });
      }
    }

    void initialize();
    return () => {
      active = false;
    };
  }, [completeSession]);

  async function handleCombinedGoogleSignIn() {
    if (busy || actionInProgressRef.current) return;
    actionInProgressRef.current = true;
    setPhase("redirecting");
    setNotice({ kind: "loading", message: "Continuing to Google..." });

    try {
      const response = await fetch("/auth/google/signin", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ next: nextParam }),
      });
      // A non-JSON body (an error page, an empty 500) must not surface a raw
      // SyntaxError to the user in place of a readable message.
      const body = await response.json().catch(() => ({}) as { url?: string; error?: string });
      if (!response.ok || !body?.url) {
        throw new Error(body?.error || "Could not start Google sign-in.");
      }
      window.location.href = body.url;
    } catch (error) {
      setPhase("error");
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not start Google sign-in.",
      });
      actionInProgressRef.current = false;
    }
  }

  async function handleEmailSignIn() {
    if (!auth || !settings || busy || actionInProgressRef.current) return;
    actionInProgressRef.current = true;
    setPhase("email");
    setNotice({ kind: "loading", message: "Sending your secure sign-in link..." });
    try {
      const actionCodeSettings = {
        url: `${settings.emailLinkUrl}?next=${encodeURIComponent(nextParam)}`,
        handleCodeInApp: true,
      };
      await sendSignInLinkToEmail(auth, email.trim(), actionCodeSettings);
      window.localStorage.setItem("agentGenaieEmailForSignIn", email.trim());
      setPhase("ready");
      setNotice({ kind: "complete", message: `Sign-in link sent to ${email.trim()}.` });
    } catch (error) {
      const details = authErrorDetails(error);
      setPhase("error");
      setNotice({ kind: "error", message: details.message });
    } finally {
      actionInProgressRef.current = false;
    }
  }

  return (
    <main className="app-main app-main-center">
      <div className="auth-shell">
        <section className="auth-panel">
          <Image
            className="auth-logo"
            src="/logo.png"
            alt="Genaie"
            width={1045}
            height={283}
            priority
          />
          <p>Sign in to manage your services and credentials.</p>
          <StatusNotice kind={notice.kind} role="status" aria-live="polite">
            {notice.message}
          </StatusNotice>
          <button
            className="full-width"
            type="button"
            disabled={busy}
            onClick={() => void handleCombinedGoogleSignIn()}
          >
            {phase === "success"
              ? "Signed in"
              : phase === "redirecting"
              ? "Continuing to Google..."
              : "Continue with Google"}
          </button>
          <p className="auth-footer">
            Also lets Genaie send job applications from your Gmail. You can disconnect anytime.
          </p>
          <div className="divider"><span>or</span></div>
          <form
            className="auth-form"
            onSubmit={(event) => {
              event.preventDefault();
              void handleEmailSignIn();
            }}
          >
            <input
              type="email"
              placeholder="name@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={busy}
              required
            />
            <button className="full-width" type="submit" disabled={busy || !email.trim()}>
              {phase === "email" ? "Sending..." : "Send Magic Link"}
            </button>
          </form>
          <p className="auth-footer">
            Want to know how your personal information and Google permissions are used? See our{" "}
            <a href="/privacy-policy">Privacy &amp; Policy</a> page.
          </p>
        </section>
      </div>
    </main>
  );
}
