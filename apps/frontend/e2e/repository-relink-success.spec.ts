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
import { parseStaffRepositoryEvidence } from '../src/features/programs/staff-repository-evidence';

test.use({ timezoneId: 'Asia/Seoul' });

const replacementUrl = 'https://github.com/external-owner/relinked-public';

test('팀장이 우리 팀 화면에서 저장소를 변경하면 재조회와 교직원 변경 이력에 반영된다', async ({
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
  await student.goto(`/programs/${encodeURIComponent(programId)}/my-team`);
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
  const detailPath = `${apiRoot}/teams/${encodeURIComponent(teamId)}`;
  const detailResponse = await staff.request.get(detailPath);
  await expectApiStatus(detailResponse, 200);
  const evidence = parseStaffRepositoryEvidence(await detailResponse.json());
  expect(evidence.repositoryContributions?.repositoryUrl).toBe(replacementUrl);
  expect(evidence.repositoryContributions?.repositoryId).toBe(
    newFacts.currentRepositoryId,
  );
  expect(evidence.repositoryContributions?.members).toEqual([
    expect.objectContaining({
      githubId: '8100002',
      commitCount: 7,
      pullRequestCount: 2,
      releaseCount: 1,
      hasObservations: true,
    }),
  ]);
  expect(evidence.repositoryContributions?.unmatchedContributors).toEqual([
    {
      githubId: '8199999',
      commitCount: 5,
      pullRequestCount: 1,
      releaseCount: 0,
    },
  ]);
  expect(evidence.repositoryUrlHistory.items).toHaveLength(1);
  const [change] = evidence.repositoryUrlHistory.items;
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
  const history = staff.getByRole('region', {
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
  const activity = staff.getByRole('region', {
    name: '현재 저장소 활동',
    exact: true,
  });
  await expect(
    activity
      .getByRole('list', { name: '팀원별 활동' })
      .getByText('커밋 7 · PR 2 · 릴리스 1', { exact: true }),
  ).toBeVisible();
  await expect(
    activity.getByText('GitHub ID 8199999 · 커밋 5 · PR 1 · 릴리스 0', {
      exact: true,
    }),
  ).toBeVisible();
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
        evidence,
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
