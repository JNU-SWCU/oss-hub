import path from 'node:path';
import { defaultExclude, defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'node',
    // Playwright 스펙(`*.spec.ts`)은 브라우저와 스택이 필요하므로 vitest가 집지 않는다.
    // 반면 `e2e/support/**`의 헬퍼 자체 테스트(`*.test.ts`)는 버릴 것이 없는 순수 판정이라
    // 여기서 돌려야 빠르고 결정적이다 — 반대편 경계는 `playwright.config.ts`의 `testIgnore`가 진다.
    exclude: [...defaultExclude, 'e2e/**/*.spec.ts'],
  },
});
