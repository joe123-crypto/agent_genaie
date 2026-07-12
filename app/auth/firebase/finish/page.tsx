"use client";

import { useEffect, useRef } from "react";

export default function FirebaseFinishPage() {
  const statusRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const scriptEl = document.createElement("script");
    scriptEl.type = "module";
    scriptEl.text = `
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, isSignInWithEmailLink, signInWithEmailLink } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const form = document.querySelector("[data-email-form]");
const emailInput = document.querySelector("[data-email]");
const submitButton = document.querySelector("[data-submit]");
const statusEl = document.querySelector("[data-status]");
const emailStorageKey = "agentGenaieEmailForSignIn";
let auth;

const params = new URLSearchParams(window.location.search);
function safeNext(value) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "";
}
const nextPath = safeNext(params.get("next"));
function destinationForSession(session) {
  const publicUserId = session && session.publicUserId;
  if (!publicUserId) return nextPath || "/";
  if (session && session.onboardingRequired) return "/" + publicUserId + "/onboarding";
  if (!nextPath || nextPath === "/") return "/" + publicUserId;
  const genericScopedMatch = nextPath.match(/^\\/(connect-gmail|vault)\\/?(\?.*)?$/);
  if (genericScopedMatch) {
    return "/" + publicUserId + "/" + genericScopedMatch[1] + (genericScopedMatch[2] || "");
  }
  return nextPath;
}

async function createSession(user) {
  const idToken = await user.getIdToken(true);
  const response = await fetch("/auth/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken })
  });
  const body = await response.json().catch(function() { return {}; });
  if (!response.ok) throw new Error(body.error || "Could not create server session.");
  return body;
}

function setStatus(message, tone) {
  statusEl.textContent = message;
  statusEl.dataset.tone = tone || "info";
  statusEl.hidden = false;
}
function setBusy(value) {
  submitButton.disabled = value;
  emailInput.disabled = value;
}

async function finish(email) {
  setBusy(true);
  try {
    const result = await signInWithEmailLink(auth, email, window.location.href);
    const session = await createSession(result.user);
    window.localStorage.removeItem(emailStorageKey);
    setStatus("Signed in. Opening app.", "success");
    window.location.assign(destinationForSession(session));
  } catch (err) {
    setStatus(err.message || "Could not finish sign-in.", "error");
  } finally {
    setBusy(false);
  }
}

async function start() {
  const response = await fetch("/config/firebase");
  const settings = await response.json();
  if (!settings.configured) {
    setStatus("Firebase email login is not configured yet. Missing: " + settings.missing.join(", "), "error");
    return;
  }
  const app = initializeApp(settings.firebase);
  auth = getAuth(app);
  if (!isSignInWithEmailLink(auth, window.location.href)) {
    setStatus("This sign-in link is not valid for this app.", "error");
    return;
  }
  const storedEmail = window.localStorage.getItem(emailStorageKey);
  if (storedEmail) {
    await finish(storedEmail);
    return;
  }
  form.hidden = false;
  setStatus("Confirm the same email address used to request the link.");
  form.addEventListener("submit", async function(event) {
    event.preventDefault();
    const email = emailInput.value.trim();
    if (!email) { setStatus("Enter your email address.", "error"); return; }
    await finish(email);
  });
}

start().catch(function(err) {
  setStatus(err.message || "Could not load Firebase settings.", "error");
});
`;
    document.body.appendChild(scriptEl);
    return () => { scriptEl.remove(); };
  }, []);

  return (
    <>
      <main className="app-main app-main-center">
        <section className="panel panel-narrow">
          <a className="toplink" href="/login">Back to sign in</a>
          <h1>Finish sign in</h1>
          <p>The app is completing your email-link sign-in.</p>
          <form className="form-stack" data-email-form hidden ref={formRef}>
            <label className="field" htmlFor="email">Confirm email address</label>
            <input id="email" data-email type="email" autoComplete="email" required ref={emailRef} />
            <div className="actions actions-spaced">
              <button data-submit type="submit" ref={submitRef}>Finish sign in</button>
            </div>
          </form>
          <div className="status" data-status ref={statusRef}>Checking sign-in link...</div>
        </section>
      </main>
    </>
  );
}
