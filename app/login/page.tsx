"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { StatusNotice } from "@/app/_components/status-ui";

function LoginContent() {
  const [config, setConfig] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const searchParams = useSearchParams();
  // Only allow same-origin paths to prevent open redirects and javascript: URLs
  const rawNext = searchParams.get("next") || "/";
  const nextParam = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  useEffect(() => {
    fetch("/config/firebase")
      .then((res) => res.json())
      .then(setConfig)
      .catch((err) => setError("Failed to load Firebase configuration."));
  }, []);

  useEffect(() => {
    if (!config?.configured) return;

    // Load Firebase script dynamically to avoid SSR issues
    const script = document.createElement("script");
    script.type = "module";
    script.text = `
      import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
      import { getAuth, signInWithPopup, GoogleAuthProvider, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

      const app = initializeApp(${JSON.stringify(config.firebase)});
      const auth = getAuth(app);
      window.__firebaseAuth = auth;
      window.__GoogleAuthProvider = GoogleAuthProvider;
      window.__signInWithPopup = signInWithPopup;
      window.__sendSignInLinkToEmail = sendSignInLinkToEmail;

      const provider = new GoogleAuthProvider();
      provider.addScope("email");

      function destinationForSession(session) {
        if (session && session.onboardingRequired && session.publicUserId) {
          return "/" + session.publicUserId + "/onboarding";
        }
        return ${JSON.stringify(nextParam)};
      }

      window.__handleGoogleSignIn = async () => {
        try {
          const result = await signInWithPopup(auth, provider);
          const idToken = await result.user.getIdToken(true);
          const response = await fetch("/auth/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ idToken })
          });
          const data = await response.json().catch(function() { return {}; });
          if (response.ok) {
            window.location.href = destinationForSession(data);
          } else {
            alert("Session error: " + (data.error || "Unknown"));
            auth.signOut();
          }
        } catch (error) {
          console.error("Google Sign-In Error:", error);
          if (error.code !== "auth/popup-closed-by-user") {
            alert("Sign in failed: " + error.message);
          }
        }
      };

      window.__handleEmailSignIn = async (email) => {
        const actionCodeSettings = {
          url: ${JSON.stringify(config.emailLinkUrl)} + "?next=" + encodeURIComponent(${JSON.stringify(nextParam)}),
          handleCodeInApp: true
        };
        try {
          await sendSignInLinkToEmail(auth, email, actionCodeSettings);
          window.localStorage.setItem('agentGenaieEmailForSignIn', email);
          alert("Sign-in link sent to " + email);
        } catch (error) {
          console.error("Email Sign-In Error:", error);
          alert("Failed to send sign-in link: " + error.message);
        }
      };
    `;
    document.body.appendChild(script);

    return () => {
      document.body.removeChild(script);
    };
  }, [config, nextParam]);

  if (error) return <main className="app-main app-main-center"><StatusNotice kind="error" variant="block">{error}</StatusNotice></main>;
  if (!config) return <main className="app-main app-main-center"><StatusNotice kind="loading" variant="block">Loading...</StatusNotice></main>;

  return (
    <main className="app-main app-main-center">
      <div className="auth-shell">
        <section className="auth-panel">
          <h1>Agent Genaie</h1>
          <p>Sign in to manage your services and credentials.</p>
          <button
            className="secondary full-width"
            onClick={() => (window as any).__handleGoogleSignIn?.()}
          >
            Sign in with Google
          </button>
          <div className="divider">
            <span>or</span>
          </div>
          <form
            className="auth-form"
            onSubmit={(e) => {
              e.preventDefault();
              (window as any).__handleEmailSignIn?.(email);
            }}
          >
            <input
              type="email"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <button className="full-width" type="submit">
              Send Magic Link
            </button>
          </form>
          <p className="auth-footer">
            Want to know how your personal information and Google permissions are
            used? See our{" "}
            <a href="/privacy-policy">
              Privacy &amp; Policy
            </a>{" "}
            page.
          </p>
        </section>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="app-main app-main-center"><StatusNotice kind="loading" variant="block">Loading...</StatusNotice></main>}>
      <LoginContent />
    </Suspense>
  );
}
