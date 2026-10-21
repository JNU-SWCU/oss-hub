import { expect, test } from './admin-session.fixture';
import {
  fixtureProgramId,
  resetProgramAuthoringControl,
  PROGRAM_AUTHORING_CONTROL_PATH,
} from './support/program-authoring-ui';

for (const width of [1440, 390]) {
  test(`파일 교체와 실패 후 재시도는 현재 파일만 사용한다 ${width}px`, async ({
    authSeedPage,
    programAuthoringActorPage,
  }, testInfo) => {
    test.setTimeout(120_000);
    const control = await authSeedPage('admin-confirmed');
    await resetProgramAuthoringControl(control);
    const programId = await fixtureProgramId(control);
    expect(
      (
        await control.request.post(
          `${PROGRAM_AUTHORING_CONTROL_PATH}/applications`,
          { data: { mode: 'NEW' } },
        )
      ).status(),
    ).toBe(201);
    expect(
      (
        await control.request.post(
          `${PROGRAM_AUTHORING_CONTROL_PATH}/approve-and-run`,
        )
      ).status(),
    ).toBe(201);
    const student = await programAuthoringActorPage('student', {
      status: 503,
      pathname: '/api/v1/submissions',
    });
    await student.setViewportSize({ width, height: 844 });
    const uploadedBodies: string[] = [];
    let creates = 0;
    await student.route('**/api/v1/submission-files', async (route) => {
      uploadedBodies.push(route.request().postDataBuffer()?.toString() ?? '');
      await route.continue();
    });
    await student.route('**/api/v1/submissions', async (route) => {
      creates += 1;
      if (creates <= 2) {
        await route.fulfill({
          status: 503,
          json: {
            type: 'about:blank',
            title: 'Unavailable',
            status: 503,
            detail: '합성 제출 실패',
            code: 'TST_001',
            instance: '/api/v1/submissions',
          },
        });
      } else await route.continue();
    });
    const milestoneId = 'e2e:program-authoring:milestone';
    await student.goto(
      `/programs/${encodeURIComponent(programId)}/documents?milestoneId=${encodeURIComponent(milestoneId)}`,
    );
    const fileInput = student.locator('#submission-file');
    await expect(fileInput).toBeVisible();
    const fileA = {
      name: 'a.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\nfile-A\n'),
    };
    const fileB = {
      name: 'b.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\nfile-B\n'),
    };
    await fileInput.setInputFiles(fileA);
    await student
      .getByRole('button', { name: '선택 취소', exact: true })
      .click();
    await student
      .getByRole('button', { name: '제출하기', exact: true })
      .click();
    await expect(
      student.getByText('제출할 파일을 선택해 주세요.'),
    ).toBeVisible();
    expect(uploadedBodies).toHaveLength(0);
    await fileInput.setInputFiles(fileA);
    await fileInput.setInputFiles(fileB);
    await student
      .getByRole('button', { name: '제출하기', exact: true })
      .click();
    await expect(
      student.getByText('합성 제출 실패', { exact: true }),
    ).toBeVisible();
    expect(uploadedBodies).toHaveLength(1);
    expect(uploadedBodies[0]).toContain('filename="b.pdf"');
    expect(uploadedBodies[0]).toContain('file-B');
    await student.screenshot({
      path: testInfo.outputPath('create-failed-b.png'),
      fullPage: true,
    });
    const retry = student.waitForResponse(
      (response) =>
        response.url().endsWith('/submissions') &&
        response.request().method() === 'POST',
    );
    await student
      .getByRole('button', { name: '제출하기', exact: true })
      .click();
    expect((await retry).status()).toBe(503);
    expect(uploadedBodies).toHaveLength(1);
    await fileInput.setInputFiles(fileA);
    await student
      .getByRole('button', { name: '제출하기', exact: true })
      .click();
    await expect(student.getByText('제출을 완료했습니다')).toBeVisible();
    expect(uploadedBodies).toHaveLength(2);
    expect(uploadedBodies[1]).toContain('filename="a.pdf"');
    expect(creates).toBe(3);
    await student.screenshot({
      path: testInfo.outputPath('submitted-a.png'),
      fullPage: true,
    });
  });
}
