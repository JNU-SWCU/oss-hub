import { describe, expect, it } from "vitest";
import { apiPath } from "./api-client";

describe("apiPath", () => {
  it("슬래시 유무와 무관하게 /api/v1 경로를 만든다", () => {
    expect(apiPath("auth/github")).toBe("/api/v1/auth/github");
    expect(apiPath("/auth/github")).toBe("/api/v1/auth/github");
  });
});
