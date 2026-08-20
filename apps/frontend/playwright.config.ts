import { defineConfig, devices } from '@playwright/test';

import { e2eEnvironment } from './e2e/environment';

export default defineConfig({
  testDir: './e2e',
  outputDir:
    process.env.E2E_OUTPUT_DIR ??
    process.env.E2E_ARTIFACT_DIR ??
    '.omo/artifacts/program-authoring-and-document-flow/12-e2e/playwright',
  fullyParallel: false,
  forbidOnly: true,
  preserveOutput: 'always',
  // ⚠ 여기를 올리기 전에 읽을 것. lifecycle 스펙의 flake 대응으로 retries: 1을 시도했다가
  // 실측으로 되돌렸다(2026-08-07). Playwright는 재시도 때 webServer를 재기동하지 않아
  // DB가 앞 시도의 변경을 그대로 안고 간다. describe.serial 그룹은 1번부터 다시 도는데,
  // 1번은 목록 검색·페이지네이션만 보고 PENDING을 소비하지 않지만, 뒤 테스트가
  // 가입 신청 승인·반려로 시드를 바꾼다. 재시도는 앞 시도의 DB를 안고 1번부터
  // 다시 도므로 남은 대기 건수·역할이 어긋나 45초 timeout으로 죽는다. 결과는
  // 세 가지로 전부 나빴다:
  //   - 실패는 그대로다 — 재시도해도 `1 failed`, 그리고 나머지는 여전히 "did not run"이다.
  //     (재시도를 넣는 명분이 "죽으면 나머지가 안 돈다"였는데 그게 해결되지 않는다)
  //   - 로그 맨 아래에 남는 마지막 오류가 목록 단언 타임아웃으로 바뀌어, 진짜 원인인
  //     404를 덮는다. 다음 조사자를 엉뚱한 곳으로 보낸다.
  //   - CI 시간만 45초 늘어난다.
  // 재시도가 의미를 가지려면 시도 사이에 시드를 되돌리는 설계가 먼저다.
  retries: 0,
  workers: 1,
  reporter: [['list']],
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: e2eEnvironment.baseUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chrome',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
      },
    },
  ],
  webServer: {
    command: 'bash e2e/run-stack.sh',
    url: e2eEnvironment.baseUrl,
    // 기본값 'ignore'는 next dev의 `GET ... 404` 요청 로그를 통째로 버린다.
    // 브라우저가 URL 없이 남기는 콘솔 오류를 서버 쪽에서 맞춰 볼 유일한 창구다.
    stdout: 'pipe',
    timeout: 180_000,
    reuseExistingServer: false,
    gracefulShutdown: {
      signal: 'SIGTERM',
      timeout: 10_000,
    },
  },
});
