import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";

// Covers the combined sign-in + Gmail-connect OAuth flow described in
// app/auth/google/signin/route.ts: the login page's Google button now starts
// that flow (POST /auth/google/signin -> redirect to the returned Google
// consent URL) instead of only driving the Firebase popup/redirect SDK.
//
// Kept as a sibling to tests/ui/login.test.tsx (rather than edited into it)
// because app/login/login-content.tsx is being changed concurrently to add
// this exact "Continue with Google" button; this file targets that contract
// without touching the existing Firebase-popup assertions.

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

describe("Combined Google sign-in + Gmail connect on the login page", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetAllMocks();
    window.sessionStorage.clear();
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

    fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ url: "https://accounts.google.com/o/oauth2/v2/auth?mock=1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it("renders a Continue with Google button once ready", async () => {
    render(createElement(LoginContent));
    const button = await screen.findByRole("button", { name: /continue with google/i });
    await waitFor(() => expect(button).toBeEnabled());
  });

  it("POSTs to /auth/google/signin when the button is clicked", async () => {
    render(createElement(LoginContent));
    const button = await screen.findByRole("button", { name: /continue with google/i });
    await waitFor(() => expect(button).toBeEnabled());

    fireEvent.click(button);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/auth/google/signin");
    expect(init?.method).toBe("POST");
  });
});
