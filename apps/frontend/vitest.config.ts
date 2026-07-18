import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  esbuild: {
    jsx: "automatic",
  },
  test: {
    environment: "node",
    // e2e/는 Playwright 전용 스펙 — vitest 기본 제외 목록에 더해 함께 집지 않도록 제외한다.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
