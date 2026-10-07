import type { Response } from '@playwright/test';

import { expect, test } from './admin-session.fixture';
import { installBrowserAudit } from './support/browser-audit';
import {
  fixtureProgramId,
  resetProgramAuthoringControl,
} from './support/program-authoring-ui';

test('신청도 팀도 없는 학생의 프로그램 화면에는 4xx와 콘솔 오류가 없다', async ({
  authSeedPage,
  programAuthoringActorPage,
}) => {
  test.setTimeout(180_000);
  const control = await authSeedPage('admin-confirmed');
  await resetProgramAuthoringControl(control);
  const programId = await fixtureProgramId(control);

  const student = await programAuthoringActorPage('student');
  const audit = installBrowserAudit(student);

  const meResponses: { readonly path: string; readonly status: number }[] = [];
  student.on('response', (response: Response) => {
    const path = new URL(response.url()).pathname;
    if (/\/(applications|teams)\/me$/.test(path)) {
      meResponses.push({ path, status: response.status() });
    }
  });

  const encoded = encodeURIComponent(programId);
  const scoped = `/programs/${encoded}`;
  for (const route of [scoped, `${scoped}/apply`, `${scoped}/team`]) {
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
