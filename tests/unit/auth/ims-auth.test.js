import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// We test ims-auth.js by importing its exports. localStorage is mocked via
// vitest's built-in jsdom environment (configured globally in vitest.config.ts).

// Mock the ims-config module since it reads window.location at import time
vi.mock("../../../public/scripts/auth/ims-config.js", () => ({
  IMS_CLIENT_ID: "test-client",
  IMS_SCOPES: "openid,AdobeID",
  IMS_ADOBE_ONLY: false,
  getIMSEnvironment: () => "prod",
  getIMSBaseURL: () => "https://ims-na1.adobelogin.com",
  getRedirectURI: () => "http://localhost:3000/ims/callback",
  STORAGE_KEY: "aso_ims_auth",
  PKCE_VERIFIER_KEY: "aso_pkce_verifier",
}));

const { storeAuthState, loadAuthState, clearAuthState, isAuthenticated, getAccessToken } =
  await import("../../../public/scripts/auth/ims-auth.js");

const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const STORAGE_KEY = "aso_ims_auth";

function makeAuthState(overrides = {}) {
  return {
    accessToken: "test-token",
    refreshToken: "refresh-token",
    expiresAt: Date.now() + 60 * 60 * 1000, // 1 hour from now
    loginTime: Date.now(),
    profile: { email: "user@adobe.com" },
    imsOrgId: "org123",
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

// ─── storeAuthState ───────────────────────────────────────────────────────────

describe("storeAuthState", () => {
  it("writes auth state to localStorage", () => {
    storeAuthState(makeAuthState());
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw);
    expect(parsed.accessToken).toBe("test-token");
  });

  it("preserves existing loginTime on refresh (does not reset 24h clock)", () => {
    const originalLoginTime = Date.now() - 2 * 60 * 60 * 1000; // 2h ago
    storeAuthState(makeAuthState({ loginTime: originalLoginTime }));

    // Simulate a token refresh: store new state without loginTime
    const { loginTime: _, ...stateWithoutLoginTime } = makeAuthState();
    storeAuthState({ ...stateWithoutLoginTime, accessToken: "new-token" });

    const stored = loadAuthState();
    expect(stored.loginTime).toBe(originalLoginTime); // preserved
    expect(stored.accessToken).toBe("new-token");
  });

  it("stamps loginTime when no existing state", () => {
    const before = Date.now();
    storeAuthState({ accessToken: "tok", refreshToken: null, expiresAt: Date.now() + 1000 });
    const stored = loadAuthState();
    expect(stored.loginTime).toBeGreaterThanOrEqual(before);
    expect(stored.loginTime).toBeLessThanOrEqual(Date.now());
  });
});

// ─── loadAuthState ────────────────────────────────────────────────────────────

describe("loadAuthState", () => {
  it("returns null when nothing stored", () => {
    expect(loadAuthState()).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    localStorage.setItem(STORAGE_KEY, "not-json");
    expect(loadAuthState()).toBeNull();
  });
});

// ─── clearAuthState ───────────────────────────────────────────────────────────

describe("clearAuthState", () => {
  it("removes auth state from localStorage", () => {
    storeAuthState(makeAuthState());
    clearAuthState();
    expect(loadAuthState()).toBeNull();
  });
});

// ─── isAuthenticated ──────────────────────────────────────────────────────────

describe("isAuthenticated", () => {
  it("returns false when no stored token", () => {
    expect(isAuthenticated()).toBe(false);
  });

  it("returns true for a fresh, non-expired token", () => {
    storeAuthState(makeAuthState());
    expect(isAuthenticated()).toBe(true);
  });

  it("returns false when token is expired", () => {
    storeAuthState(makeAuthState({ expiresAt: Date.now() - 1000 }));
    expect(isAuthenticated()).toBe(false);
  });

  it("returns false when session is older than 24 hours", () => {
    storeAuthState(makeAuthState({
      loginTime: Date.now() - SESSION_MAX_AGE_MS - 1000,
      expiresAt: Date.now() + 60 * 60 * 1000, // token itself is valid
    }));
    expect(isAuthenticated()).toBe(false);
  });

  it("returns true when session is exactly at 24h boundary", () => {
    storeAuthState(makeAuthState({
      loginTime: Date.now() - SESSION_MAX_AGE_MS + 5000, // 5s before expiry
      expiresAt: Date.now() + 60 * 60 * 1000,
    }));
    expect(isAuthenticated()).toBe(true);
  });
});

// ─── getAccessToken ───────────────────────────────────────────────────────────

describe("getAccessToken", () => {
  it("returns null when not authenticated", () => {
    expect(getAccessToken()).toBeNull();
  });

  it("returns the token when authenticated", () => {
    storeAuthState(makeAuthState({ accessToken: "my-access-token" }));
    expect(getAccessToken()).toBe("my-access-token");
  });

  it("returns null for an expired token", () => {
    storeAuthState(makeAuthState({ expiresAt: Date.now() - 1000 }));
    expect(getAccessToken()).toBeNull();
  });

  it("returns null when session exceeds 24 hours", () => {
    storeAuthState(makeAuthState({
      loginTime: Date.now() - SESSION_MAX_AGE_MS - 1000,
      expiresAt: Date.now() + 60 * 60 * 1000,
    }));
    expect(getAccessToken()).toBeNull();
  });

  it("treats missing loginTime as fresh (backwards compatibility)", () => {
    const state = makeAuthState();
    delete state.loginTime;
    storeAuthState(state);
    // Override directly so loginTime is truly absent
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, loginTime: undefined }));
    expect(getAccessToken()).toBe("test-token");
  });
});
