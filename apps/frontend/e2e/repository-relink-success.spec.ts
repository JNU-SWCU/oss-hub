import { writeFile } from 'node:fs/promises';
import {
  applicationTeamId,
  capture,
  captureRegion,
  RelinkEvidenceError,
  seedRepositoryEvidence,
} from './support/repository-relink-evidence';
import { expect, test } from './admin-session.fixture';
import { expectApiStatus } from './support/program-authoring-flow';
import {
  fixtureProgramId,
  PROGRAM_AUTHORING_CONTROL_PATH,
  resetProgramAuthoringControl,
} from './support/program-authoring-ui';
import { parseRepositoryUrlState } from '../src/features/programs/repository-url-api';
import {
  parseRepositoryHistory,
  parseTeamActivity,
} from '../src/features/programs/team-activity-api';

test.use({ timezoneId: 'Asia/Seoul' });

const replacementUrl = 'https://github.com/external-owner/relinked-public';

test('팀장이 우리 팀 화면에서 저장소를 변경하면 학생·교직원이 같은 그래프와 변경 이력을 본다', async ({
  authSeedPage,
  programAuthoringActorPage,
}, testInfo) => {
  // Given: approval and provisioning use the real isolated application and database.
  const control = await authSeedPage('admin-confirmed');
  await resetProgramAuthoringControl(control);
  const programId = await fixtureProgramId(control);
  const apiRoot = `/api/v1/programs/${encodeURIComponent(programId)}`;
  await expectApiStatus(
    await control.request.post(
      `${PROGRAM_AUTHORING_CONTROL_PATH}/applications`,
      {
        data: { mode: 'NEW' },
      },
    ),
    201,
  );
  await expectApiStatus(
    await control.request.post(
      `${PROGRAM_AUTHORING_CONTROL_PATH}/approve-and-run`,
    ),
    201,
  );
  const student = await programAuthoringActorPage('student');
  const oldFacts = await seedRepositoryEvidence(control);
  const applicationResponse = await student.request.get(
    `${apiRoot}/applications/me`,
  );
  await expectApiStatus(applicationResponse, 200);
  const teamId = applicationTeamId(await applicationResponse.json());
  const repositoryPath = `${apiRoot}/applications/me/repository-url`;
  const beforeResponse = await student.request.get(repositoryPath);
  await expectApiStatus(beforeResponse, 200);
  const before = parseRepositoryUrlState(await beforeResponse.json());
  expect(before.canEditRepositoryUrl).toBe(true);
  expect(before.repositoryUrl).toMatch(/^https:\/\/github\.com\/e2e-org\//);
  await student.goto(`/programs/${encodeURIComponent(programId)}/team`);
  await student.setViewportSize({ width: 1440, height: 900 });
  await expect(student.getByRole('radio', { name: /저장소/ })).toHaveCount(0);
  const editor = student.getByRole('region', {
    name: '프로젝트 저장소',
    exact: true,
  });
  await expect(
    editor.getByRole('button', { name: '저장소 URL 수정' }),
  ).toBeEnabled();
  await student.waitForLoadState('networkidle');
  await capture(student, testInfo, 'team-repository-desktop');
  await captureRegion(
    student.locator('main'),
    testInfo,
    'team-repository-element',
  );
  await captureRegion(editor, testInfo, 'team-repository-compact');
  await student.setViewportSize({ width: 390, height: 844 });
  await expect(editor.getByRole('link')).toBeVisible();
  expect(
    await student.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await capture(student, testInfo, 'team-repository-mobile');
  await editor.getByRole('button', { name: '저장소 URL 수정' }).click();
  await expect(
    editor.getByText('저장소 변경 안내', { exact: true }),
  ).toHaveCount(0);
  await expect(
    editor.getByText(/주소는 교직원이 확인할 수 있습니다/),
  ).toHaveCount(0);
  await editor.getByRole('button', { name: '취소', exact: true }).click();
  await expect(editor.getByLabel('새 저장소 URL')).toHaveCount(0);
  await editor.getByRole('button', { name: '저장소 URL 수정' }).click();
  await editor.getByLabel('새 저장소 URL').fill(replacementUrl);
  await expect(editor.getByLabel('변경 사유')).toHaveCount(0);
  await capture(student, testInfo, '01-student-warning');
  await captureRegion(editor, testInfo, 'team-repository-editing-mobile');
  expect(
    await student.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  // When: the student confirms the change through the real PATCH endpoint.
  const changeStartedAt = Date.now();
  const [savedResponse] = await Promise.all([
    student.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === repositoryPath &&
        response.request().method() === 'PATCH',
    ),
    editor
      .getByRole('button', { name: '저장소 변경 저장', exact: true })
      .click(),
  ]);
  expect(savedResponse.status()).toBe(200);
  expect(savedResponse.request().postDataJSON()).toEqual({
    repositoryUrl: replacementUrl,
  });
  const changeFinishedAt = Date.now();
  expect(parseRepositoryUrlState(await savedResponse.json())).toEqual({
    repositoryUrl: replacementUrl,
    canEditRepositoryUrl: true,
  });

  // Then: persistence and staff history agree with the confirmed student action.
  await expect(
    editor.getByRole('link', { name: replacementUrl, exact: true }),
  ).toBeVisible();
  await expect(editor.getByRole('status')).toHaveText(
    '저장소 변경을 저장했습니다.',
  );
  await student.reload();
  await expect(
    editor.getByRole('link', { name: replacementUrl, exact: true }),
  ).toBeVisible();
  const reloadResponse = await student.request.get(repositoryPath);
  await expectApiStatus(reloadResponse, 200);
  expect(
    parseRepositoryUrlState(await reloadResponse.json()).repositoryUrl,
  ).toBe(replacementUrl);
  await capture(student, testInfo, '02-student-reloaded');
  const newFacts = await seedRepositoryEvidence(control);
  expect(newFacts.currentRepositoryId).not.toBe(oldFacts.currentRepositoryId);
  expect(
    newFacts.facts.filter(
      (fact) => fact.repositoryId === oldFacts.currentRepositoryId,
    ),
  ).toEqual(oldFacts.facts);

  const staff = await programAuthoringActorPage('staff');
  const teamRoot = `${apiRoot}/teams/${encodeURIComponent(teamId)}`;
  // 학생과 교직원은 같은 조회로 같은 시계열을 본다(#1133). 역할은 편집 권한만 가른다.
  const [studentActivityResponse, staffActivityResponse] = await Promise.all([
    student.request.get(`${teamRoot}/activity`),
    staff.request.get(`${teamRoot}/activity`),
  ]);
  await expectApiStatus(studentActivityResponse, 200);
  await expectApiStatus(staffActivityResponse, 200);
  const studentActivity = parseTeamActivity(
    await studentActivityResponse.json(),
  );
  const staffActivity = parseTeamActivity(await staffActivityResponse.json());
  expect({
    ...staffActivity,
    canEditRepositoryUrl: studentActivity.canEditRepositoryUrl,
  }).toEqual(studentActivity);
  expect(staffActivity.repository).toEqual({
    id: newFacts.currentRepositoryId,
    url: replacementUrl,
  });
  expect(staffActivity.status).toBe('COLLECTED');
  // 팀원만 그린다 — 연결되지 않은 외부 기여자(8199999)는 사람 수를 늘리지 않는다.
  expect(staffActivity.members).toEqual([
    expect.objectContaining({
      githubLogin: 'e2e-program-authoring-student',
      totals: { commitCount: 7, pullRequestCount: 2, issueCount: 0 },
    }),
  ]);
  const historyResponse = await staff.request.get(
    `${teamRoot}/repository-url-history`,
  );
  await expectApiStatus(historyResponse, 200);
  const repositoryUrlHistory = parseRepositoryHistory(
    await historyResponse.json(),
  );
  expect(repositoryUrlHistory.items).toHaveLength(1);
  const [change] = repositoryUrlHistory.items;
  if (change === undefined)
    throw new RelinkEvidenceError('Missing change history.');
  expect(change).toMatchObject({
    previousRepositoryUrl: before.repositoryUrl,
    newRepositoryUrl: replacementUrl,
    actorGithubLogin: 'e2e-program-authoring-student',
  });
  expect(change).not.toHaveProperty('reason');
  expect(Date.parse(change.occurredAt)).toBeGreaterThanOrEqual(changeStartedAt);
  expect(Date.parse(change.occurredAt)).toBeLessThanOrEqual(changeFinishedAt);
  await staff.goto(
    `/programs/${encodeURIComponent(programId)}/teams/${encodeURIComponent(teamId)}`,
  );
  const activity = staff.getByRole('region', { name: '팀 활동', exact: true });
  await expect(activity.getByRole('list', { name: '팀원' })).toContainText(
    '@e2e-program-authoring-student',
  );
  // 숫자는 초점을 줄 때만 보인다.
  const readout = activity.locator('[data-slot="team-activity-readout"]');
  await expect(readout).toHaveCount(0);
  await activity.getByRole('group', { name: /팀 활동 그래프/ }).focus();
  await expect(readout).toContainText('팀 합계');
  await activity
    .getByRole('button', { name: '저장소 URL 변경 이력', exact: true })
    .click();
  const history = activity.getByRole('region', {
    name: '저장소 URL 변경 이력',
    exact: true,
  });
  await expect(history.getByText('변경 사유', { exact: true })).toHaveCount(0);
  await expect(
    history.getByText(`@${change.actorGithubLogin}`, { exact: true }),
  ).toBeVisible();
  await expect(
    history.getByText(change.newRepositoryUrl, { exact: true }),
  ).toBeVisible();
  if (before.repositoryUrl === null)
    throw new RelinkEvidenceError('Missing original repository.');
  await expect(
    history.getByText(before.repositoryUrl, { exact: true }),
  ).toBeVisible();
  await expect(history.locator('time')).toHaveAttribute(
    'datetime',
    change.occurredAt,
  );
  await expect(history.locator('time')).not.toBeEmpty();
  await capture(staff, testInfo, '03-staff-desktop-viewport');
  await captureRegion(activity, testInfo, '04-staff-activity-desktop');
  await captureRegion(history, testInfo, '05-staff-history-desktop');
  await staff.setViewportSize({ width: 390, height: 844 });
  await expect(
    history.getByText(change.newRepositoryUrl, { exact: true }),
  ).toBeVisible();
  await capture(staff, testInfo, '06-staff-mobile-viewport');
  await captureRegion(activity, testInfo, '07-staff-activity-mobile');
  await captureRegion(history, testInfo, '08-staff-history-mobile');
  const evidencePath = testInfo.outputPath(
    'repository-relink-api-evidence.json',
  );
  await writeFile(
    evidencePath,
    JSON.stringify(
      {
        before,
        after: replacementUrl,
        studentActivity,
        staffActivity,
        repositoryUrlHistory,
        oldFacts,
        newFacts,
        contributionSource:
          'synthetic observations in isolated database; external GitHub API fake',
      },
      null,
      2,
    ),
  );
  await testInfo.attach('repository-relink-api-evidence', {
    path: evidencePath,
    contentType: 'application/json',
  });
});
