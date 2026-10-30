import { expect, test } from './admin-session.fixture';
import {
  fixtureProgramId,
  originHeaders,
  submitProgramApplication,
} from './support/program-authoring-ui';

for (const width of [1440, 390]) {
  test(`팀 화면에서 초대를 수락하면 팀을 즉시 읽는다 ${width}px`, async ({
    authSeedPage,
    programAuthoringActorPage,
  }, testInfo) => {
    test.setTimeout(120_000);
    const control = await authSeedPage('admin-confirmed');
    await fixtureProgramId(control);
    const now = Date.now();
    const response = await control.request.post('/api/v1/programs', {
      headers: originHeaders(),
      data: {
        name: `합성 팀 갱신 ${width}`,
        organizer: '합성 기관',
        trackType: 'EXTRACURRICULAR',
        applicationStartAt: new Date(now - 86_400_000).toISOString(),
        applicationEndAt: new Date(now + 86_400_000).toISOString(),
        endAt: new Date(now + 7 * 86_400_000).toISOString(),
        teamMinSize: 1,
        teamMaxSize: 3,
        description: '합성 팀 갱신 검증',
      },
    });
    expect(response.status()).toBe(201);
    const body: unknown = await response.json();
    if (
      typeof body !== 'object' ||
      body === null ||
      !('id' in body) ||
      typeof body.id !== 'string'
    )
      throw new Error('Missing program id');
    const programId = body.id;
    const leader = await programAuthoringActorPage('student');
    await submitProgramApplication(leader, programId);
    await leader.goto(`/programs/${programId}/team`);
    await leader
      .getByRole('button', { name: '팀원 초대', exact: true })
      .click();
    const dialog = leader.getByRole('dialog', { name: '팀원 초대' });
    await dialog
      .getByLabel('이름 또는 GitHub 아이디로 검색')
      .fill('e2e-program-authoring-foreign-student');
    await dialog
      .getByRole('option')
      .filter({ hasText: 'E2E Foreign Student' })
      .getByRole('button', { name: '초대', exact: true })
      .click();
    await expect(dialog.getByText('초대 대기', { exact: true })).toBeVisible();
    const invitee = await programAuthoringActorPage('foreignStudent');
    await invitee.setViewportSize({ width, height: 844 });
    await invitee.goto(`/programs/${programId}/team`);
    await expect(
      invitee.getByText('아직 이 프로그램에서 속한 팀이 없습니다'),
    ).toBeVisible();
    await invitee.screenshot({
      path: testInfo.outputPath('no-team.png'),
      fullPage: true,
    });
    const originalUrl = invitee.url();
    const membershipReads: string[] = [];
    invitee.on('request', (request) => {
      if (
        new URL(request.url()).pathname ===
        `/api/v1/programs/${programId}/teams/me`
      )
        membershipReads.push(request.method());
    });
    await invitee
      .getByRole('button', { name: '팀 초대 알림', exact: true })
      .click();
    const acceptance = invitee.waitForResponse(
      (response) =>
        response.url().includes('/accept') &&
        response.request().method() === 'POST',
    );
    await invitee
      .getByRole('button', { name: '합성 신청 팀 팀 초대 수락', exact: true })
      .click();
    expect((await acceptance).status()).toBe(200);
    await expect(
      invitee.getByRole('heading', { name: '합성 신청 팀', exact: true }),
    ).toBeVisible();
    expect(invitee.url()).toBe(originalUrl);
    expect(membershipReads.length).toBeGreaterThan(0);
    await invitee.screenshot({
      path: testInfo.outputPath('accepted-team.png'),
      fullPage: true,
    });
    expect(
      await (
        await invitee.request.get(`/api/v1/programs/${programId}/teams/me`)
      ).json(),
    ).toMatchObject({
      membership: 'MEMBER',
      team: { name: '합성 신청 팀', memberCount: 2 },
    });
  });
}
