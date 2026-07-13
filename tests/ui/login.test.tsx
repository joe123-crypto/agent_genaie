import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";

const mocks = vi.hoisted(() => ({
  authStateReady: vi.fn<() => Promise<void>>(),
  getRedirectResult: vi.fn(),
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn(),
  sendSignInLinkToEmail: vi.fn(),
  loadFirebaseClientSettings: vi.fn(),
  initializeFirebaseClient: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("firebase/auth", () => ({
  GoogleAuthProvider: class {
    addScope() {}
  },
  getRedirectResult: mocks.getRedirectResult,
  signInWithPopup: mocks.signInWithPopup,
  signInWithRedirect: mocks.signInWithRedirect,
  sendSignInLinkToEmail: mocks.sendSignInLinkToEmail,
}));

vi.mock("@/src/firebase/client", () => ({
  loadFirebaseClientSettings: mocks.loadFirebaseClientSettings,
  initializeFirebaseClient: mocks.initializeFirebaseClient,
}));

import { LoginContent } from "@/app/login/login-content";

const settings = {
  configured: true,
  missing: [],
  firebase: { apiKey: "key", authDomain: "app.example", projectId: "project", appId: "app" },
  emailLinkUrl: "https://app.example/auth/firebase/finish",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("Google login readiness and recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window.navigator, "userAgentData", {
      configurable: true,
      value: { mobile: false },
    });
    mocks.loadFirebaseClientSettings.mockResolvedValue(settings);
    mocks.getRedirectResult.mockResolvedValue(null);
    mocks.authStateReady.mockResolvedValue(undefined);
    mocks.initializeFirebaseClient.mockReturnValue({
      authStateReady: mocks.authStateReady,
      currentUser: null,
    });
  });

  afterEach(() => cleanup());

  it("keeps the Google button disabled until Firebase is fully ready", async () => {
    const ready = deferred<void>();
    mocks.authStateReady.mockReturnValue(ready.promise);
    render(createElement(LoginContent));

    const button = screen.getByRole("button", { name: /sign in with google/i });
    expect(button).toBeDisabled();
    await waitFor(() => expect(mocks.authStateReady).toHaveBeenCalledOnce());
    expect(button).toBeDisabled();

    ready.resolve(undefined);
    await waitFor(() => expect(button).toBeEnabled());
  });

  it("starts only one popup when the enabled button is clicked repeatedly", async () => {
    const popup = deferred<never>();
    mocks.signInWithPopup.mockReturnValue(popup.promise);
    render(createElement(LoginContent));
    const button = await screen.findByRole("button", { name: /sign in with google/i });
    await waitFor(() => expect(button).toBeEnabled());

    fireEvent.click(button);
    fireEvent.click(button);
    expect(mocks.signInWithPopup).toHaveBeenCalledOnce();
  });

  it("shows popup cancellation and switches the retry to same-tab redirect", async () => {
    mocks.signInWithPopup.mockRejectedValue({ code: "auth/popup-closed-by-user" });
    render(createElement(LoginContent));
    const button = await screen.findByRole("button", { name: /sign in with google/i });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);

    expect(await screen.findByText(/closed before it finished/i)).toBeVisible();
    expect(screen.getByRole("button", { name: /continue with google/i })).toBeEnabled();
  });

  it("uses redirect directly on mobile", async () => {
    Object.defineProperty(window.navigator, "userAgentData", {
      configurable: true,
      value: { mobile: true },
    });
    mocks.signInWithRedirect.mockReturnValue(new Promise(() => {}));
    render(createElement(LoginContent));
    const button = await screen.findByRole("button", { name: /sign in with google/i });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);

    await waitFor(() => expect(mocks.signInWithRedirect).toHaveBeenCalledOnce());
    expect(mocks.signInWithPopup).not.toHaveBeenCalled();
  });

  it("resumes server-session creation for a user returned by Firebase", async () => {
    const token = deferred<string>();
    const getIdToken = vi.fn(() => token.promise);
    mocks.getRedirectResult.mockResolvedValue({ user: { uid: "uid-1", getIdToken } });
    render(createElement(LoginContent));

    expect(await screen.findByText(/finishing sign-in/i)).toBeVisible();
    expect(getIdToken).toHaveBeenCalledWith(true);
    expect(screen.getByRole("button", { name: /signing in/i })).toBeDisabled();
  });
});
