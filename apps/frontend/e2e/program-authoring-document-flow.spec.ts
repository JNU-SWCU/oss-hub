import { expect, test } from './admin-session.fixture';
import {
  downloadedArtifact,
  expectApiStatus,
  expectCleanState,
  parseDeadlinePreview,
  PROGRAM_AUTHORING_E2E,
  seoulLocalInput,
  toStateCounts,
  writeArtifact,
} from './support/program-authoring-flow';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// PROGRAM_AUTHORING_E2E.seoulNow(=신청 종료·운영 시작 시각)를 앵커로 삼아
// 나머지 일정을 모두 상대 오프셋으로 도출한다(절대 캘린더 날짜 금지).
const schedule = PROGRAM_AUTHORING_E2E.seoulNow;
import { zipEntry, zipManifest } from './support/program-authoring-zip';
import {
  adoptProgramGraph,
  assertAdoptedProgramId,
  originHeaders,
  programIdFromDetailUrl,
  resetProgramAuthoringControl,
  selectScheduleRange,
  submitProgramApplication,
} from './support/program-authoring-ui';

const controlPath = '/api/v1/_e2e/program-authoring';

test.describe('프로그램 작성과 제출물 dry-run', () => {
  test.use({ timezoneId: 'Asia/Seoul' });

  test('교직원이 완전한 작성 그래프를 확정하고 학생 제출물 수합까지 검증한다', async ({
    authSeedPage,
    programAuthoringActorPage,
  }) => {
    // 작성 그래프 확정 → 신청 2건 → 승인 → 서류 제출·재제출 → 마감 다이제스트 →
    // 수합 다운로드까지 전 구간을 실제 스택에서 검증하는 전용 시나리오라 기본
    // 45s 예산으로는 원천적으로 부족하다(run 5에서 45000ms 초과로 실패 확인).
    test.setTimeout(300_000);
    const controlPage = await authSeedPage('admin-confirmed');
    await resetProgramAuthoringControl(controlPage);
    const authorPage = await authSeedPage('staff-revocable');

    await authorPage.goto('/programs/new');
    await authorPage.getByRole('radio', { name: '기본' }).check();
    await authorPage.getByRole('button', { name: '저장하고 계속' }).click();
    await authorPage
      .getByLabel('프로그램명 *')
      .fill(PROGRAM_AUTHORING_E2E.programName);
    await authorPage
      .getByLabel('주관기관/학과 *')
      .fill('e2e:program-authoring:organizer');
    await authorPage
      .getByLabel('소개/설명 *')
      .fill('e2e:program-authoring:description');
    await authorPage.getByRole('button', { name: '저장하고 계속' }).click();
    await selectScheduleRange(authorPage, {
      rangeButtonName: /1\. 신청 기간/,
      rangeLabel: '신청 기간',
      startAt: seoulLocalInput(schedule, -DAY_MS),
      endAt: seoulLocalInput(schedule),
    });
    await authorPage.setViewportSize({ width: 375, height: 900 });
    const calendarScroller = authorPage.getByTestId(
      'program-schedule-calendar-scroll',
    );
    await expect(
      authorPage.getByText('달력을 좌우로 밀어 전체 날짜를 볼 수 있습니다.'),
    ).toBeVisible();
    await expect
      .poll(() =>
        calendarScroller.evaluate(
          (element) => element.scrollWidth > element.clientWidth,
        ),
      )
      .toBe(true);
    const rightmostDate = calendarScroller
      .locator('[data-calendar-date]')
      .last();
    await rightmostDate.scrollIntoViewIfNeeded();
    const rightmostDateBox = await rightmostDate.boundingBox();
    expect(rightmostDateBox).not.toBeNull();
    expect(
      (rightmostDateBox?.x ?? -1) + (rightmostDateBox?.width ?? 0),
    ).toBeLessThanOrEqual(375);
    await authorPage.setViewportSize({ width: 1280, height: 900 });
    await selectScheduleRange(authorPage, {
      rangeButtonName: /2\. 운영 기간/,
      rangeLabel: '운영 기간',
      startAt: seoulLocalInput(schedule),
      endAt: seoulLocalInput(schedule, 10 * DAY_MS),
    });
    await authorPage.getByLabel('최소').fill('1');
    await authorPage.getByLabel('최대').fill('1');
    await authorPage.getByRole('button', { name: /3\. 마일스톤 1/ }).click();
    await authorPage
      .getByLabel('마일스톤 1 이름 *')
      .fill(PROGRAM_AUTHORING_E2E.informationalMilestoneName);
    await selectScheduleRange(authorPage, {
      rangeButtonName: /3\. e2e:program-authoring:information-milestone/,
      rangeLabel: PROGRAM_AUTHORING_E2E.informationalMilestoneName,
      startAt: seoulLocalInput(schedule, HOUR_MS),
      endAt: seoulLocalInput(schedule, 2 * HOUR_MS),
    });
    await authorPage.getByRole('button', { name: '마일스톤 추가' }).click();
    await authorPage
      .getByLabel('마일스톤 2 이름 *')
      .fill(PROGRAM_AUTHORING_E2E.requiredMilestoneName);
    await selectScheduleRange(authorPage, {
      rangeButtonName: /4\. e2e:program-authoring:required-milestone/,
      rangeLabel: PROGRAM_AUTHORING_E2E.requiredMilestoneName,
      startAt: seoulLocalInput(schedule, 2 * HOUR_MS),
      endAt: seoulLocalInput(schedule, 9 * HOUR_MS),
    });
    await authorPage.getByRole('button', { name: '저장하고 계속' }).click();
    await authorPage.getByLabel('필수 제출로 지정합니다').first().uncheck();
    await authorPage
      .getByLabel('제출 항목 이름 *')
      .first()
      .fill(PROGRAM_AUTHORING_E2E.informationalDocumentName);
    await authorPage
      .getByLabel('제출 항목 이름 *')
      .nth(1)
      .fill(PROGRAM_AUTHORING_E2E.requiredDocumentName);
    await authorPage
      .getByLabel('참고 자료·양식 (선택)')
      .nth(1)
      .setInputFiles({
        name: 'template.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4\ntemplate\n'),
      });
    await authorPage.getByRole('button', { name: '저장하고 계속' }).click();
    await authorPage.getByLabel('GitHub 저장소 발급').check();
    await authorPage.getByLabel('제출 마감 알림').check();
    await authorPage.getByRole('button', { name: '저장하고 계속' }).click();
    await expect(authorPage.getByText(/내용이나 파일로 제출 가능/)).toHaveCount(
      2,
    );
    await expect(
      authorPage.getByText(PROGRAM_AUTHORING_E2E.requiredDocumentName),
    ).toBeVisible();
    await expect(
      authorPage.getByText(PROGRAM_AUTHORING_E2E.informationalDocumentName),
    ).toBeVisible();
    await expect(authorPage.getByText('GitHub 저장소 발급')).toBeVisible();
    await authorPage.getByRole('button', { name: '프로그램 만들기' }).click();
    const [creationResponse] = await Promise.all([
      authorPage.waitForResponse(
        (response) =>
          response.url().includes('/api/v1/program-authoring/programs') &&
          response.request().method() === 'POST',
      ),
      authorPage.getByRole('button', { name: '생성 확정' }).click(),
    ]);
    expect(creationResponse.ok()).toBe(true);
    await expect(authorPage).toHaveURL(
      (url) => programIdFromDetailUrl(url.href) !== null,
    );
    const programId = programIdFromDetailUrl(authorPage.url());
    if (programId === null) {
      throw new Error(
        'Authoring success URL must contain a Program detail ID.',
      );
    }
    const graph = await adoptProgramGraph(authorPage, programId);
    assertAdoptedProgramId(graph, programId);
    const staffPage = await programAuthoringActorPage('staff');
    const studentPage = await programAuthoringActorPage('student');
    const foreignStudentPage =
      await programAuthoringActorPage('foreignStudent');

    await submitProgramApplication(studentPage, programId, 'new');
    await expectApiStatus(
      await controlPage.request.post(`${controlPath}/approve-and-run`),
      201,
    );
    const beforeSubmissionResponse = await staffPage.request.post(
      `/api/v1/programs/${encodeURIComponent(programId)}/deadline-digest/preview`,
      { headers: originHeaders() },
    );
    await expectApiStatus(beforeSubmissionResponse, 201);
    expect(
      parseDeadlinePreview(await beforeSubmissionResponse.json()),
    ).toMatchObject({
      applicationCount: 1,
      milestoneCount: 1,
      recipientCount: 1,
    });

    await studentPage.goto(`/programs/${encodeURIComponent(programId)}`);
    const template = await downloadedArtifact(studentPage, '양식');
    const requiredDocumentRow = studentPage
      .getByTestId('milestone-document-row')
      .filter({ hasText: PROGRAM_AUTHORING_E2E.requiredDocumentName });
    await requiredDocumentRow.getByRole('button', { name: '올리기' }).click();
    await requiredDocumentRow
      .getByLabel('내용 (선택)')
      .fill('e2e:program-authoring:revision-1-text-only');
    const [firstSubmission] = await Promise.all([
      studentPage.waitForResponse(
        (response) =>
          response.url().includes('/submissions') &&
          response.request().method() === 'POST',
      ),
      requiredDocumentRow
        .getByRole('button', { name: '제출', exact: true })
        .click(),
    ]);
    expect(firstSubmission.ok()).toBe(true);
    await expect(
      requiredDocumentRow.getByText(
        'e2e:program-authoring:revision-1-text-only',
      ),
    ).toBeVisible();
    await expect(
      requiredDocumentRow.getByText('첫 제출 · 1차 제출본'),
    ).toBeVisible();
    await requiredDocumentRow.getByRole('button', { name: '수정' }).click();
    await requiredDocumentRow
      .getByLabel('내용 (선택)')
      .fill('e2e:program-authoring:revision-2-text-and-file');
    await requiredDocumentRow
      .getByLabel(
        `${PROGRAM_AUTHORING_E2E.requiredDocumentName} 제출 파일 선택`,
      )
      .setInputFiles({
        name: 'current-v2.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4\ncurrent-v2\n'),
      });
    const [secondSubmission] = await Promise.all([
      studentPage.waitForResponse(
        (response) =>
          response.url().includes('/submissions') &&
          response.request().method() === 'POST',
      ),
      requiredDocumentRow
        .getByRole('button', { name: '제출', exact: true })
        .click(),
    ]);
    expect(secondSubmission.ok()).toBe(true);
    await expect(
      requiredDocumentRow.getByText(
        'e2e:program-authoring:revision-1-text-only',
      ),
    ).toBeVisible();
    await expect(
      requiredDocumentRow.getByText(
        'e2e:program-authoring:revision-2-text-and-file',
      ),
    ).toBeVisible();
    await expect(
      requiredDocumentRow.getByText('첫 제출 · 1차 제출본'),
    ).toBeVisible();
    await expect(
      requiredDocumentRow.getByText('다시 제출 · 2차 제출본'),
    ).toBeVisible();
    await expect(requiredDocumentRow.getByText('current-v2.pdf')).toBeVisible();
    const studentHistory = requiredDocumentRow
      .locator('section')
      .filter({ hasText: '제출·검토 이력' });
    const studentHistoryEntries = studentHistory.locator('ol > li');
    await expect(studentHistoryEntries).toHaveCount(2);
    await expect(studentHistoryEntries.nth(0)).toContainText(
      'e2e:program-authoring:revision-1-text-only',
    );
    await expect(studentHistoryEntries.nth(0)).not.toContainText(
      'current-v2.pdf',
    );
    await expect(studentHistoryEntries.nth(1)).toContainText(
      'e2e:program-authoring:revision-2-text-and-file',
    );
    await expect(studentHistoryEntries.nth(1)).toContainText('current-v2.pdf');

    const afterSubmissionResponse = await staffPage.request.post(
      `/api/v1/programs/${encodeURIComponent(programId)}/deadline-digest/preview`,
      { headers: originHeaders() },
    );
    await expectApiStatus(afterSubmissionResponse, 201);
    expect(
      parseDeadlinePreview(await afterSubmissionResponse.json()),
    ).toMatchObject({
      applicationCount: 0,
      milestoneCount: 1,
      recipientCount: 0,
    });
    await submitProgramApplication(foreignStudentPage, programId, 'own');

    const previewResponse = await staffPage.request.post(
      `/api/v1/programs/${encodeURIComponent(programId)}/deadline-digest/preview`,
      { headers: originHeaders() },
    );
    await expectApiStatus(previewResponse, 201);
    const preview = parseDeadlinePreview(await previewResponse.json());
    await expectApiStatus(
      await staffPage.request.post(
        `/api/v1/programs/${encodeURIComponent(programId)}/deadline-digest/send`,
        {
          // send DTO는 previewedAt/previewVersion만 화이트리스트한다(전역
          // ValidationPipe가 forbidNonWhitelisted) — preview 객체 전체를
          // 그대로 넘기면 applicationCount 등 나머지 필드가 400 SYS_003으로
          // 걸린다.
          data: {
            previewedAt: preview.previewedAt,
            previewVersion: preview.previewVersion,
          },
          headers: originHeaders(),
        },
      ),
      201,
    );

    await staffPage.goto(
      `/programs/${encodeURIComponent(programId)}/milestones/${encodeURIComponent(graph.milestoneId)}/documents`,
    );
    // 접근성 이름 '팀별 서류 수합 표'는 스크롤 region 래퍼(scrollRegionLabel,
    // milestone-document-collection-view.tsx)에 붙는다 — table 자체에는 이름이
    // 없어 region을 거쳐 내부 table을 찾는다.
    await expect(
      staffPage
        .getByRole('region', { name: '팀별 서류 수합 표' })
        .getByRole('table'),
    ).toBeVisible();
    // 이 시나리오의 유일한 팀(학생 본인)이 이미 필수 서류를 제출했으니 미제출은
    // 0팀이다 — 제출 반영이 화면에 실제로 도달했는지를 이 수로 확인한다.
    await expect(
      staffPage.getByRole('button', { name: /필수 서류 미제출 0팀/ }),
    ).toBeVisible();
    await staffPage
      .getByRole('button', {
        name: new RegExp(`${PROGRAM_AUTHORING_E2E.requiredDocumentName} 검토`),
      })
      .click();
    const reviewPanel = staffPage.getByTestId(
      'milestone-document-review-panel',
    );
    const staffHistory = reviewPanel
      .locator('section')
      .filter({ hasText: '제출·검토 이력' });
    await expect(reviewPanel).toBeVisible();
    await expect(
      staffHistory.getByText('e2e:program-authoring:revision-1-text-only'),
    ).toBeVisible();
    await expect(
      staffHistory.getByText('e2e:program-authoring:revision-2-text-and-file'),
    ).toBeVisible();
    await expect(staffHistory.getByText('첫 제출 · 1차 제출본')).toBeVisible();
    await expect(
      staffHistory.getByText('다시 제출 · 2차 제출본'),
    ).toBeVisible();
    await expect(staffHistory.getByText('current-v2.pdf')).toBeVisible();
    const staffHistoryEntries = staffHistory.locator('ol > li');
    await expect(staffHistoryEntries).toHaveCount(2);
    await expect(staffHistoryEntries.nth(0)).toContainText(
      'e2e:program-authoring:revision-1-text-only',
    );
    await expect(staffHistoryEntries.nth(0)).not.toContainText(
      'current-v2.pdf',
    );
    await expect(staffHistoryEntries.nth(1)).toContainText(
      'e2e:program-authoring:revision-2-text-and-file',
    );
    await expect(staffHistoryEntries.nth(1)).toContainText('current-v2.pdf');
    const individual = await downloadedArtifact(
      staffPage,
      /개별 파일 내려받기/,
    );
    expect(individual.sha256).not.toBe(template.sha256);
    const documentArchive = await downloadedArtifact(
      staffPage,
      `${PROGRAM_AUTHORING_E2E.requiredDocumentName} 서류별 내려받기(ZIP)`,
    );
    const fullArchive = await downloadedArtifact(
      staffPage,
      '마일스톤 전체 내려받기(ZIP)',
    );
    const fullManifest = zipManifest(fullArchive.bytes);
    const documentManifest = zipManifest(documentArchive.bytes);
    // zipManifest(program-authoring-zip.ts)는 경로를 sort()해 반환하므로
    // ASCII 'e2e-…' 팀 폴더가 한글 '제출현황.csv'보다 앞선다 — 실제 ZIP의
    // 물리적 첫 엔트리가 CSV라는 속성은 백엔드 유닛 테스트
    // (milestone-document-archive.service.spec.ts)가 이미 검증하므로, 여기서는
    // CSV가 포함되어 있는지만 확인한다.
    expect(fullManifest).toContain('제출현황.csv');
    expect(documentManifest).toContain('제출현황.csv');
    const currentPath = fullManifest.find((path) =>
      path.endsWith(`/${individual.name}`),
    );
    if (currentPath === undefined)
      throw new Error('Full archive must retain the current file path.');
    expect(zipEntry(fullArchive.bytes, currentPath).bytes).toEqual(
      individual.bytes,
    );
    // 이 시나리오의 유일한 팀은 이미 필수 서류를 제출했으므로 CSV에는 '미제출'이
    // 아니라 그 팀의 제출 판정("검토 대기")이 담긴다.
    expect(
      zipEntry(fullArchive.bytes, '제출현황.csv').bytes.toString('utf8'),
    ).toContain('검토 대기');

    const stateResponse = await controlPage.request.get(
      `${controlPath}/state/${encodeURIComponent(programId)}`,
    );
    await expectApiStatus(stateResponse, 200);
    const state = toStateCounts(await stateResponse.json());
    // 봉투 3통 — approve-and-run 때 첫 학생 리마인드 1통, 뒤의 수동 발송에서
    // 외부 학생 리마인드 1통 + 교직원 미제출 팀 요약 1통(#886)이다.
    // 이 시나리오의 교직원은 활성·수신 동의·알림 이메일을 모두 갖춰 수신 대상이다.
    // 상태 집계의 documents는 프로그램 전체를 센다. 안내용 마일스톤의 제출 항목이
    // 빠지면 이 값이 1이 되어 전체 작성 그래프 증명이 실패한다. graph의 한 필수
    // 마일스톤 식별자는 아래 수합·다운로드 검증에서 계속 사용한다.
    expectCleanState(state, 2, 2, 2, 3, 2);
    expect(state.storageContentHashes).toContain(template.sha256);
    expect(state.storageContentHashes).toContain(individual.sha256);
    await writeArtifact('sql-counts.json', { graph, ...state });
    await writeArtifact('downloads.json', {
      template: artifactSummary(template),
      individual: artifactSummary(individual),
      documentManifest,
      fullManifest,
    });
    await writeArtifact('mail-summary.json', {
      envelopeCount: state.dryRunEnvelopes,
      hashes: state.mailContentHashes,
    });
  });
});

function artifactSummary(artifact: {
  readonly name: string;
  readonly sha256: string;
  readonly size: number;
}) {
  return { name: artifact.name, sha256: artifact.sha256, size: artifact.size };
}
