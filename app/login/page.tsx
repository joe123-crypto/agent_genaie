"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";

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

  if (error) return <div style={{ color: "red", padding: "2rem" }}>{error}</div>;
  if (!config) return <div style={{ padding: "2rem" }}>Loading...</div>;

  return (
    <div style={styles.container}>
      <div style={styles.panel}>
        <h1 style={styles.title}>Agent Genaie</h1>
        <p style={styles.subtitle}>Sign in to manage your services and credentials.</p>
        <button
          style={styles.googleBtn}
          onClick={() => (window as any).__handleGoogleSignIn?.()}
        >
          Sign in with Google
        </button>
        <div style={styles.divider}>
          <span style={styles.dividerText}>or</span>
        </div>
        <form
          style={styles.emailForm}
          onSubmit={(e) => {
            e.preventDefault();
            (window as any).__handleEmailSignIn?.(email);
          }}
        >
          <input
            style={styles.input}
            type="email"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <button type="submit" style={styles.emailBtn}>
            Send Magic Link
          </button>
        </form>
        <p style={styles.footer}>
          Want to know how your personal information and Google permissions are
          used? See our{" "}
          <a href="/privacy-policy" style={styles.footerLink}>
            Privacy &amp; Policy
          </a>{" "}
          page.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div style={{ padding: "2rem" }}>Loading...</div>}>
      <LoginContent />
    </Suspense>
  );
}

const styles = {
  container: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    minHeight: "100vh",
    padding: "20px",
  },
  panel: {
    background: "var(--panel)",
    padding: "40px",
    borderRadius: "16px",
    boxShadow: "var(--shadow)",
    maxWidth: "400px",
    width: "100%",
    textAlign: "center" as const,
  },
  title: {
    margin: "0 0 10px 0",
    fontSize: "24px",
    fontWeight: "600",
  },
  subtitle: {
    margin: "0 0 30px 0",
    color: "var(--muted)",
    fontSize: "14px",
  },
  googleBtn: {
    width: "100%",
    padding: "12px",
    background: "#fff",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    fontSize: "15px",
    fontWeight: "500",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "10px",
    marginBottom: "20px",
    transition: "background 0.2s",
  },
  divider: {
    position: "relative" as const,
    textAlign: "center" as const,
    margin: "20px 0",
  },
  dividerText: {
    background: "var(--panel)",
    padding: "0 10px",
    color: "var(--muted)",
    fontSize: "13px",
    position: "relative" as const,
    zIndex: 1,
  },
  emailForm: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "10px",
  },
  input: {
    padding: "12px",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    fontSize: "15px",
    width: "100%",
    boxSizing: "border-box" as const,
  },
  emailBtn: {
    padding: "12px",
    background: "var(--text)",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    fontSize: "15px",
    fontWeight: "500",
    cursor: "pointer",
    transition: "opacity 0.2s",
  },
  footer: {
    margin: "24px 0 0 0",
    color: "var(--muted)",
    fontSize: "12px",
    lineHeight: 1.5,
  },
  footerLink: {
    color: "var(--blue)",
    textDecoration: "underline",
  },
};
