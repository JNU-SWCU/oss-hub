import type { Response } from '@playwright/test';

import { expect, test } from './admin-session.fixture';
import { installBrowserAudit } from './support/browser-audit';
import {
  fixtureProgramId,
  resetProgramAuthoringControl,
} from './support/program-authoring-ui';

/**
 * 신청도 팀도 없는 학생이 프로그램 화면을 열어도 4xx 응답과 콘솔 오류가 없어야 한다
 * (QA174 / #1303).
 *
 * 전에는 「내 신청」·「내 팀」 조회가 없을 때 404(`APP_001`·`TEAM_010`)로 답했다. 화면은
 * 멀쩡했지만 콘솔에 4xx가 쌓였고, 콘솔 오류를 기준 삼는 이 감사기가 그 404를 허용
 * 목록에 올려 두는 바람에 **이 화면들에서는 어떤 404도 잡히지 않았다**. 허용 목록을
 * 지우고 그 자리를 이 스펙으로 대신한다 — 진짜 요청으로 판정한다. 가로채면 검증
 * 대상 자체가 사라진다.
 */
test('신청도 팀도 없는 학생의 프로그램 화면에는 4xx와 콘솔 오류가 없다', async ({
  authSeedPage,
  programAuthoringActorPage,
}) => {
  test.setTimeout(180_000);
  const control = await authSeedPage('admin-confirmed');
  await resetProgramAuthoringControl(control);
  const programId = await fixtureProgramId(control);

  // 이 학생은 어느 프로그램에도 신청·팀이 없다.
  const student = await programAuthoringActorPage('student');
  const audit = installBrowserAudit(student);

  // 두 조회를 실제로 불렀는지까지 센다 — 아무것도 부르지 않아 초록인 것과, 불렀는데
  // 4xx가 없는 것은 다른 사실이다.
  const meResponses: { readonly path: string; readonly status: number }[] = [];
  student.on('response', (response: Response) => {
    const path = new URL(response.url()).pathname;
    if (/\/(applications|teams)\/me$/.test(path)) {
      meResponses.push({ path, status: response.status() });
    }
  });

  // 시드 id에는 `:`가 들어가 요청 경로에서는 인코딩된 채로 보인다.
  const encoded = encodeURIComponent(programId);
  const scoped = `/programs/${encoded}`;
  for (const route of [scoped, `${scoped}/apply`, `${scoped}/my-team`]) {
    await student.goto(route);
    await student.waitForLoadState('networkidle');
  }

  audit.assertClean();
  expect(meResponses.map((response) => response.path).sort()).toEqual(
    expect.arrayContaining([
      `/api/v1/programs/${encoded}/applications/me`,
      `/api/v1/programs/${encoded}/teams/me`,
    ]),
  );
  expect(meResponses.filter((response) => response.status >= 400)).toHaveLength(
    0,
  );
});
