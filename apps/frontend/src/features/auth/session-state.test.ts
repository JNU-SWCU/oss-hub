import { describe, expect, it } from "vitest";
import { applyLogoutFailure, applyLogoutSuccess, LOGOUT_ERROR_MESSAGE } from "./session-state";
import type { AuthSessionState } from "./session-state";

const authenticated: AuthSessionState = {
  me: { login: "synthetic-login", name: null, avatarUrl: null },
  logoutError: null,
};

describe("logout session state", () => {
  it("failed logout preserves authenticated UI and exposes retryable error", () => {
    expect(applyLogoutFailure(authenticated)).toEqual({
      me: authenticated.me,
      logoutError: LOGOUT_ERROR_MESSAGE,
    });
  });

  it("successful logout clears authenticated UI", () => {
    expect(applyLogoutSuccess(authenticated, { isAuthenticated: false })).toEqual({
      me: null,
      logoutError: null,
    });
  });
});
