import { defineConfig, devices } from "@playwright/test"

// /aside 미리보기 스모크 전용 설정 — 백엔드가 필요 없으므로 프론트 서버만 기동한다.
// 3000/4000은 로컬 개발에서 이미 쓰이는 포트라 여분 포트(3100)를 쓴다.
// dev 서버가 아니라 프로덕션 빌드(next build && next start)로 기동해 실제 배포에
// 가까운 산출물을 검증한다.
const PORT = 3100
const BASE_URL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `pnpm exec next build && pnpm exec next start -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
