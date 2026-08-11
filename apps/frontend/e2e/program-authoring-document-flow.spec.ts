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
    const authorPage = await authSeedPage('admin-confirmed');

    await authorPage.goto('/programs/new');
    await authorPage.getByRole('radio', { name: '기본' }).check();
    await authorPage.getByRole('button', { name: '다음' }).click();
    await authorPage
      .getByLabel('프로그램명 *')
      .fill(PROGRAM_AUTHORING_E2E.programName);
    await authorPage
      .getByLabel('주관기관/학과 *')
      .fill('e2e:program-authoring:organizer');
    await authorPage
      .getByLabel('소개/설명 *')
      .fill('e2e:program-authoring:description');
    await authorPage.getByRole('button', { name: '다음' }).click();
    await authorPage
      .getByLabel('신청 시작 *')
      .fill(seoulLocalInput(schedule, -DAY_MS));
    await authorPage.getByLabel('신청 종료 *').fill(seoulLocalInput(schedule));
    await authorPage.getByLabel('운영 시작 *').fill(seoulLocalInput(schedule));
    await authorPage
      .getByLabel('운영 종료 *')
      .fill(seoulLocalInput(schedule, 10 * DAY_MS));
    await authorPage.getByLabel('최소').fill('1');
    await authorPage.getByLabel('최대').fill('1');
    await authorPage.getByRole('button', { name: '다음' }).click();
    await authorPage
      .getByLabel('마일스톤명 *')
      .fill(PROGRAM_AUTHORING_E2E.informationalMilestoneName);
    await authorPage
      .getByLabel('시작 *')
      .fill(seoulLocalInput(schedule, HOUR_MS));
    await authorPage
      .getByLabel('마감 *')
      .fill(seoulLocalInput(schedule, 2 * HOUR_MS));
    await authorPage.getByRole('button', { name: '마일스톤 추가' }).click();
    await authorPage
      .getByLabel('마일스톤명 *')
      .nth(1)
      .fill(PROGRAM_AUTHORING_E2E.requiredMilestoneName);
    await authorPage
      .getByLabel('시작 *')
      .nth(1)
      .fill(seoulLocalInput(schedule, 2 * HOUR_MS));
    await authorPage
      .getByLabel('마감 *')
      .nth(1)
      .fill(seoulLocalInput(schedule, 9 * HOUR_MS));
    await authorPage.getByText('파일 중심', { exact: true }).nth(1).click();
    await expect(
      authorPage
        .getByLabel(
          `${PROGRAM_AUTHORING_E2E.informationalMilestoneName} 요구서류`,
        )
        .getByText('안내용 마일스톤'),
    ).toBeVisible();
    await authorPage.getByRole('button', { name: '항목 추가' }).nth(1).click();
    await authorPage
      .getByLabel('요구서류명 *')
      .fill(PROGRAM_AUTHORING_E2E.requiredDocumentName);
    await authorPage.getByLabel('파일 제출').check();
    await authorPage.getByLabel('필수 제출로 지정합니다').check();
    await authorPage.getByLabel('양식 파일 (선택)').setInputFiles({
      name: 'template.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\ntemplate\n'),
    });
    await authorPage.getByRole('button', { name: '다음' }).click();
    await authorPage.getByLabel('GitHub 저장소 발급').check();
    await authorPage.getByLabel('제출 마감 알림').check();
    await authorPage.getByRole('button', { name: '다음' }).click();
    await expect(authorPage.getByText('받을 항목 없음 (안내용)')).toBeVisible();
    await expect(
      authorPage.getByText(PROGRAM_AUTHORING_E2E.requiredDocumentName),
    ).toBeVisible();
    await expect(authorPage.getByText('GitHub 저장소 발급')).toBeVisible();
    await authorPage.getByRole('button', { name: '프로그램 만들기' }).click();
    await authorPage.getByRole('button', { name: '생성 확정' }).click();
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
    // FILE 타입 서류는 파일 선택 즉시 업로드+제출이 한 번에 끝난다(별도 확인
    // 버튼이 없다 — milestone-document-list.tsx StudentDocumentRow의 유일한
    // 버튼은 "올리기"/"수정"이며 숨은 input을 열 뿐이다). '제출하기' 버튼을
    // 기다리면 영원히 풀리지 않으므로, 제출 완료는 submissions POST 응답으로
    // 확인한다(라벨은 분 단위 표시라 같은 분 내 재제출을 구분하지 못한다).
    const [firstSubmission] = await Promise.all([
      studentPage.waitForResponse(
        (response) =>
          response.url().includes('/submissions') &&
          response.request().method() === 'POST',
      ),
      studentPage.setInputFiles('input[type="file"]', {
        name: 'current-v1.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4\ncurrent-v1\n'),
      }),
    ]);
    expect(firstSubmission.ok()).toBe(true);
    const [secondSubmission] = await Promise.all([
      studentPage.waitForResponse(
        (response) =>
          response.url().includes('/submissions') &&
          response.request().method() === 'POST',
      ),
      studentPage.setInputFiles('input[type="file"]', {
        name: 'current-v2.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4\ncurrent-v2\n'),
      }),
    ]);
    expect(secondSubmission.ok()).toBe(true);

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
    // 봉투 2통 — 미제출 학생 리마인드 1 + 교직원 미제출 팀 요약 1(#886).
    // 이 시나리오의 교직원은 활성·수신 동의·알림 이메일을 모두 갖춰 수신 대상이다.
    expectCleanState(state, 2, 2, 2, 2);
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
