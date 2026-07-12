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
      <style dangerouslySetInnerHTML={{ __html: `
        :root{color-scheme:light}
        *{box-sizing:border-box}
        body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f6f7f9;color:#15171a}
        main{min-height:100vh;display:grid;place-items:center;padding:24px}
        section{width:min(560px,100%);background:#fff;border:1px solid #d8dee7;border-radius:8px;padding:26px;box-shadow:0 18px 45px rgba(22,28,36,.11)}
        h1{margin:0 0 8px;font-size:2rem;line-height:1.08;letter-spacing:0}
        p{margin:0 0 18px;color:#5f6875;font-size:1rem;line-height:1.55}
        label{display:block;margin:0 0 8px;font-weight:750;color:#303846}
        input{width:100%;min-height:46px;border:1px solid #b9c3d1;border-radius:7px;padding:0 12px;font:inherit;background:#fff;color:#15171a}
        input:focus{outline:3px solid rgba(47,116,208,.18);border-color:#2f74d0}
        .actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:18px}
        button,a.button{display:inline-flex;min-height:44px;align-items:center;justify-content:center;border:0;border-radius:7px;background:#2f74d0;color:#fff;font:inherit;font-weight:750;text-decoration:none;padding:0 16px;cursor:pointer}
        button.secondary,a.secondary{background:#eef2f7;color:#263142;border:1px solid #cbd5e1}
        button:disabled{opacity:.55;cursor:not-allowed}
        button:focus-visible,a.button:focus-visible,input:focus-visible{outline:3px solid rgba(47,116,208,.28);outline-offset:2px}
        button:hover:not(:disabled),a.button:hover{filter:brightness(.94)}
        [hidden]{display:none!important}
        .status{margin-top:18px;padding:12px 14px;border-radius:7px;border:1px solid #cbd5e1;background:#f8fafc;color:#303846;line-height:1.45}
        .status[data-tone="success"]{border-color:#7fc9a2;background:#eefaf3;color:#11603a}
        .status[data-tone="error"]{border-color:#f1a7a1;background:#fff1f0;color:#9f2419}
        .toplink{display:inline-flex;margin-bottom:18px;color:#2f74d0;text-decoration:none;font-weight:750}
      `}} />
      <main>
        <section>
          <a className="toplink" href="/login">Back to sign in</a>
          <h1>Finish sign in</h1>
          <p>The app is completing your email-link sign-in.</p>
          <form data-email-form hidden ref={formRef}>
            <label htmlFor="email">Confirm email address</label>
            <input id="email" data-email type="email" autoComplete="email" required ref={emailRef} />
            <div className="actions">
              <button data-submit type="submit" ref={submitRef}>Finish sign in</button>
            </div>
          </form>
          <div className="status" data-status ref={statusRef}>Checking sign-in link...</div>
        </section>
      </main>
    </>
  );
}
