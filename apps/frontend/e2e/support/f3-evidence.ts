import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page, TestInfo } from '@playwright/test';

/**
 * F3 브라우저 커버리지 증거의 보관 자리.
 *
 * 기존 시각 증거(`member-access-visual.ts`)는 뷰포트별 파일 여러 장을 `task-9/visual`에
 * 쌓지만, F3 커버리지 요약은 시나리오 하나에 파일 하나를 이름 그대로 요구한다 —
 * 요약 JSON이 그 이름을 그대로 참조하므로 접미사를 붙이면 참조가 끊긴다.
 *
 * 기본값은 이 체크아웃의 `.omo`다. 증거를 여러 worktree가 한데 모아야 할 때만
 * `E2E_F3_EVIDENCE_DIR`로 공유 위치를 가리킨다 — 경로를 소스에 박아 두면 다른
 * 체크아웃에서 돌린 실행이 남의 증거를 덮어쓴다.
 */
const F3_EVIDENCE_DIRECTORY = path.resolve(
  process.env.E2E_F3_EVIDENCE_DIR ??
    path.join(
      process.cwd(),
      '../../.omo/evidence/jwt-auth-signup-refactor/final',
    ),
);

/**
 * `f3-<scenario>.png` 한 장을 최종 증거 폴더에 남기고 리포트에도 붙인다.
 *
 * 파일로도 남기고 첨부도 하는 이유는 소비자가 둘이기 때문이다 — 요약 JSON은 경로로
 * 읽고, 실패한 실행을 다시 보는 사람은 리포트에서 바로 연다.
 */
export async function captureF3Evidence(
  page: Page,
  testInfo: TestInfo,
  scenario: string,
): Promise<void> {
  await mkdir(F3_EVIDENCE_DIRECTORY, { recursive: true });
  const name = `f3-${scenario}.png`;
  const screenshot = await page.screenshot({ fullPage: true });
  await writeFile(path.join(F3_EVIDENCE_DIRECTORY, name), screenshot);
  await testInfo.attach(name, { body: screenshot, contentType: 'image/png' });
}
