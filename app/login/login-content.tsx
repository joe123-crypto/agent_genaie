"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  GoogleAuthProvider,
  getRedirectResult,
  sendSignInLinkToEmail,
  signInWithPopup,
  signInWithRedirect,
  type Auth,
  type User,
} from "firebase/auth";
import { StatusNotice, type StatusKind } from "@/app/_components/status-ui";
import {
  AUTH_NEXT_STORAGE_KEY,
  authErrorDetails,
  createAndVerifyServerSession,
  destinationForSession,
  isMobileBrowser,
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

export function LoginContent() {
  const [auth, setAuth] = useState<Auth | null>(null);
  const [settings, setSettings] = useState<FirebaseClientSettings | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [notice, setNotice] = useState<Notice>({
    kind: "loading",
    message: "Preparing secure sign-in...",
  });
  const [email, setEmail] = useState("");
  const [forceRedirect, setForceRedirect] = useState(false);
  const completionRef = useRef<Promise<void> | null>(null);
  const actionInProgressRef = useRef(false);
  const searchParams = useSearchParams();
  const nextParam = safeNext(searchParams.get("next"));
  const busy = !auth || !settings || ["loading", "google", "email", "session", "redirecting", "success"].includes(phase);

  const completeSession = useCallback((user: User) => {
    if (completionRef.current) return completionRef.current;

    const task = (async () => {
      setPhase("session");
      setNotice({ kind: "loading", message: "Finishing sign-in..." });
      const idToken = await user.getIdToken(true);
      const session = await createAndVerifyServerSession(idToken, user.uid);
      setPhase("success");
      setNotice({ kind: "complete", message: "Signed in. Opening your account..." });
      const storedNext = window.sessionStorage.getItem(AUTH_NEXT_STORAGE_KEY);
      window.sessionStorage.removeItem(AUTH_NEXT_STORAGE_KEY);
      window.location.assign(destinationForSession(session, storedNext || nextParam));
    })()
      .catch((error: unknown) => {
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
          await completeSession(signedInUser);
          return;
        }
        if (redirectError) {
          const details = authErrorDetails(redirectError);
          setForceRedirect(details.retryWithRedirect);
          setPhase("error");
          setNotice({ kind: "error", message: details.message });
          return;
        }
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

  async function handleGoogleSignIn() {
    if (!auth || busy || actionInProgressRef.current) return;
    actionInProgressRef.current = true;
    setPhase("google");
    setNotice({ kind: "loading", message: "Opening Google sign-in..." });

    const provider = new GoogleAuthProvider();
    provider.addScope("email");
    const useRedirect = forceRedirect || isMobileBrowser(window.navigator);

    try {
      if (useRedirect) {
        window.sessionStorage.setItem(AUTH_NEXT_STORAGE_KEY, nextParam);
        setPhase("redirecting");
        setNotice({ kind: "loading", message: "Continuing to Google..." });
        await signInWithRedirect(auth, provider);
        return;
      }
      const result = await signInWithPopup(auth, provider);
      await completeSession(result.user);
    } catch (error) {
      const details = authErrorDetails(error);
      setForceRedirect(details.retryWithRedirect);
      setPhase("error");
      setNotice({ kind: "error", message: details.message });
    } finally {
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
          <h1>Agent Genaie</h1>
          <p>Sign in to manage your services and credentials.</p>
          <StatusNotice kind={notice.kind} role="status" aria-live="polite">
            {notice.message}
          </StatusNotice>
          <button
            className="secondary full-width"
            type="button"
            disabled={busy}
            onClick={() => void handleGoogleSignIn()}
          >
            {phase === "success"
              ? "Signed in"
              : phase === "google" || phase === "redirecting" || phase === "session"
              ? "Signing in..."
              : forceRedirect
                ? "Continue with Google"
                : "Sign in with Google"}
          </button>
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
