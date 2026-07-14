import { apiClient, apiPath } from "@/lib/api-client";
import type { LogoutResult, Me } from "./types";

/** OAuth 진입은 fetch가 아니라 브라우저 이동(<a href>)이어야 한다. */
export const githubLoginPath = apiPath("auth/github");

export function fetchMe(): Promise<Me> {
  return apiClient<Me>("auth/me");
}

export function logout(): Promise<LogoutResult> {
  return apiClient<LogoutResult>("auth/logout", { method: "POST" });
}
