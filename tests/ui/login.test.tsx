import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";

// The login page's Google button starts the combined sign-in + Gmail-connect
// consent (POST /auth/google/signin -> navigate to the returned Google URL).
// The Firebase popup/redirect SDK path is no longer offered as a button, but
// the redirect-result recovery on mount is still exercised here: users who were
// mid-flight on a previous redirect sign-in must still land correctly.

const mocks = vi.hoisted(() => ({
  authStateReady: vi.fn<() => Promise<void>>(),
  getRedirectResult: vi.fn(),
  sendSignInLinkToEmail: vi.fn(),
  loadFirebaseClientSettings: vi.fn(),
  initializeFirebaseClient: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("firebase/auth", () => ({
  getRedirectResult: mocks.getRedirectResult,
  sendSignInLinkToEmail: mocks.sendSignInLinkToEmail,
}));

vi.mock("@/src/firebase/client", () => ({
  loadFirebaseClientSettings: mocks.loadFirebaseClientSettings,
  initializeFirebaseClient: mocks.initializeFirebaseClient,
}));

import { LoginContent } from "@/app/login/login-content";
import {
  AUTH_NEXT_STORAGE_KEY,
  AUTH_REDIRECT_PENDING_STORAGE_KEY,
} from "@/src/auth/login";

const settings = {
  configured: true,
  missing: [],
  firebase: { apiKey: "key", authDomain: "app.example", projectId: "project", appId: "app" },
  emailLinkUrl: "https://app.example/auth/firebase/finish",
};

const CONSENT_URL = "https://accounts.google.com/o/oauth2/v2/auth?mock=1";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Google login readiness and recovery", () => {
  const originalLocation = window.location;
  const INITIAL_HREF = originalLocation.href;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetAllMocks();
    window.sessionStorage.clear();
    mocks.loadFirebaseClientSettings.mockResolvedValue(settings);
    mocks.getRedirectResult.mockResolvedValue(null);
    mocks.authStateReady.mockResolvedValue(undefined);
    mocks.initializeFirebaseClient.mockReturnValue({
      authStateReady: mocks.authStateReady,
      currentUser: null,
    });

    // jsdom refuses real navigation, so the component's `window.location.href =`
    // is captured on a stand-in instead. It has to stay a complete location-like
    // object because next/image resolves the logo URL against it.
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: {
        href: INITIAL_HREF,
        origin: originalLocation.origin,
        protocol: originalLocation.protocol,
        host: originalLocation.host,
        hostname: originalLocation.hostname,
        port: originalLocation.port,
        pathname: originalLocation.pathname,
        search: "",
        hash: "",
        assign: vi.fn(),
        replace: vi.fn(),
        reload: vi.fn(),
        toString: () => INITIAL_HREF,
      },
    });

    fetchMock = vi.fn().mockResolvedValue(jsonResponse({ url: CONSENT_URL }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
    vi.unstubAllGlobals();
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
  });

  it("keeps the Google button disabled until Firebase is fully ready", async () => {
    const ready = deferred<void>();
    mocks.authStateReady.mockReturnValue(ready.promise);
    render(createElement(LoginContent));

    const button = screen.getByRole("button", { name: /continue with google/i });
    expect(button).toBeDisabled();
    await waitFor(() => expect(mocks.authStateReady).toHaveBeenCalledOnce());
    expect(button).toBeDisabled();

    ready.resolve(undefined);
    await waitFor(() => expect(button).toBeEnabled());
  });

  it("states that continuing also grants Gmail send access", async () => {
    render(createElement(LoginContent));
    await screen.findByRole("button", { name: /continue with google/i });
    expect(screen.getByText(/send job applications from your gmail/i)).toBeVisible();
  });

  it("sends the user to the Google consent URL returned by the server", async () => {
    render(createElement(LoginContent));
    const button = await screen.findByRole("button", { name: /continue with google/i });
    await waitFor(() => expect(button).toBeEnabled());

    fireEvent.click(button);

    await waitFor(() => expect(window.location.href).toBe(CONSENT_URL));
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/auth/google/signin");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ next: "/" });
  });

  it("starts only one sign-in request when the button is clicked repeatedly", async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    render(createElement(LoginContent));
    const button = await screen.findByRole("button", { name: /continue with google/i });
    await waitFor(() => expect(button).toBeEnabled());

    fireEvent.click(button);
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("surfaces the server's error when the sign-in start fails", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "Missing required environment: GOOGLE_CLIENT_ID" }, 500));
    render(createElement(LoginContent));
    const button = await screen.findByRole("button", { name: /continue with google/i });
    await waitFor(() => expect(button).toBeEnabled());

    fireEvent.click(button);

    expect(await screen.findByText(/missing required environment/i)).toBeVisible();
    expect(window.location.href).toBe(INITIAL_HREF);
  });

  it("stays readable when the sign-in start returns a non-JSON body", async () => {
    fetchMock.mockResolvedValue(
      new Response("<html>502 Bad Gateway</html>", {
        status: 502,
        headers: { "content-type": "text/html" },
      }),
    );
    render(createElement(LoginContent));
    const button = await screen.findByRole("button", { name: /continue with google/i });
    await waitFor(() => expect(button).toBeEnabled());

    fireEvent.click(button);

    expect(await screen.findByText(/could not start google sign-in/i)).toBeVisible();
  });

  it("shows an error instead of silently resetting after an empty redirect return", async () => {
    window.sessionStorage.setItem(AUTH_REDIRECT_PENDING_STORAGE_KEY, "1");
    window.sessionStorage.setItem(AUTH_NEXT_STORAGE_KEY, "/vault");
    render(createElement(LoginContent));

    expect(await screen.findByText(/google returned to the app, but sign-in could not be completed/i)).toBeVisible();
    expect(window.sessionStorage.getItem(AUTH_REDIRECT_PENDING_STORAGE_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(AUTH_NEXT_STORAGE_KEY)).toBeNull();
  });

  it("resumes server-session creation for a user returned by Firebase", async () => {
    const token = deferred<string>();
    const getIdToken = vi.fn(() => token.promise);
    mocks.getRedirectResult.mockResolvedValue({ user: { uid: "uid-1", getIdToken } });
    render(createElement(LoginContent));

    expect(await screen.findByText(/finishing sign-in/i)).toBeVisible();
    expect(getIdToken).toHaveBeenCalledWith(true);
    expect(screen.getByRole("button", { name: /continue with google/i })).toBeDisabled();
  });
});
