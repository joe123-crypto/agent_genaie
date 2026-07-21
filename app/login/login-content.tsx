"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
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
  AUTH_REDIRECT_PENDING_STORAGE_KEY,
  authErrorDetails,
  canUseRedirectSignIn,
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

function storeRedirectAttempt(nextPath: string) {
  try {
    window.sessionStorage.setItem(AUTH_REDIRECT_PENDING_STORAGE_KEY, "1");
    window.sessionStorage.setItem(AUTH_NEXT_STORAGE_KEY, nextPath);
    return true;
  } catch {
    return false;
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

function redirectIsReady(settings: FirebaseClientSettings) {
  try {
    return canUseRedirectSignIn(
      settings.firebase.authDomain,
      window.location.host,
      window.sessionStorage,
    );
  } catch {
    return false;
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
  const [forceRedirect, setForceRedirect] = useState(false);
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
          setForceRedirect(details.retryWithRedirect && redirectIsReady(loadedSettings));
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

  async function handleGoogleSignIn() {
    if (!auth || busy || actionInProgressRef.current) return;
    actionInProgressRef.current = true;
    setPhase("google");
    setNotice({ kind: "loading", message: "Opening Google sign-in..." });

    const provider = new GoogleAuthProvider();
    provider.addScope("email");
    const redirectReady = settings ? redirectIsReady(settings) : false;
    const useRedirect = redirectReady && (forceRedirect || isMobileBrowser(window.navigator));

    try {
      if (useRedirect) {
        if (!storeRedirectAttempt(nextParam)) {
          throw new Error("This browser cannot preserve Google redirect state. Please use the Google pop-up or a magic link.");
        }
        setPhase("redirecting");
        setNotice({ kind: "loading", message: "Continuing to Google..." });
        await signInWithRedirect(auth, provider);
        return;
      }
      const result = await signInWithPopup(auth, provider);
      await completeSession(result.user);
    } catch (error) {
      if (useRedirect) clearStoredRedirectAttempt();
      const details = authErrorDetails(error);
      setForceRedirect(details.retryWithRedirect && redirectReady);
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
