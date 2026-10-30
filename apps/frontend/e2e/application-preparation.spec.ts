import type { Page } from '@playwright/test';
import { expect, test } from './admin-session.fixture';
import {
  fixtureProgramId,
  originHeaders,
} from './support/program-authoring-ui';

async function officialTeam(page: Page, programId: string): Promise<unknown> {
  const response = await page.request.get(
    `/api/v1/programs/${programId}/teams/me`,
  );
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { readonly team: unknown };
  return body.team;
}

for (const width of [390, 1440]) {
  test(`신청 준비에서 초대 수락 후 최종 제출까지 ${width}px`, async ({
    authSeedPage,
    programAuthoringActorPage,
  }, testInfo) => {
    test.setTimeout(120_000);
    const control = await authSeedPage('admin-confirmed');
    await fixtureProgramId(control);
    const now = Date.now();
    const program = await control.request.post('/api/v1/programs', {
      headers: originHeaders(),
      data: {
        name: `신청 준비 브라우저 검증 ${width}`,
        organizer: '합성 검증 기관',
        trackType: 'EXTRACURRICULAR',
        applicationStartAt: new Date(now - 86_400_000).toISOString(),
        applicationEndAt: new Date(now + 86_400_000).toISOString(),
        endAt: new Date(now + 7 * 86_400_000).toISOString(),
        teamMinSize: 2,
        teamMaxSize: 3,
        description: '최종 제출 전 팀원 초대를 검증하는 합성 프로그램입니다.',
      },
    });
    expect(program.status()).toBe(201);
    const body: unknown = await program.json();
    if (
      typeof body !== 'object' ||
      body === null ||
      !('id' in body) ||
      typeof body.id !== 'string'
    ) {
      throw new Error('Created program must include an id.');
    }
    const programId = body.id;
    const leader = await programAuthoringActorPage('student');
    const invitee = await programAuthoringActorPage('foreignStudent');
    await leader.setViewportSize({ width, height: 900 });
    await invitee.setViewportSize({ width, height: 900 });
    await leader.goto(`/programs/${programId}/apply`);
    const teamName = `최종 제출 전 준비 ${width}`;
    await leader.getByLabel('팀 이름').fill(teamName);
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
    await dialog.getByRole('button', { name: '닫기', exact: true }).click();
    expect(await officialTeam(leader, programId)).toBeNull();
    await leader.reload();
    await expect(
      leader.getByRole('button', { name: '신청 준비 삭제' }),
    ).toBeVisible();
    expect(await officialTeam(leader, programId)).toBeNull();
    await leader.screenshot({
      path: testInfo.outputPath(`preparation-${width}.png`),
      fullPage: true,
    });

    await invitee.goto('/programs');
    await invitee
      .getByRole('button', { name: '팀 초대 알림', exact: true })
      .click();
    const accept = invitee.getByRole('button', {
      name: `${teamName} 팀 초대 수락`,
      exact: true,
    });
    await expect(accept).toBeVisible();
    await invitee.screenshot({
      path: testInfo.outputPath(`invitation-${width}.png`),
      fullPage: true,
    });
    await accept.click();
    await expect(invitee).toHaveURL(
      new RegExp(`/programs/${programId}/apply$`),
    );
    await expect(
      invitee.getByRole('button', { name: '신청 준비 나가기' }),
    ).toBeVisible();
    expect(await officialTeam(invitee, programId)).toBeNull();
    await leader.reload();
    await expect(
      leader
        .getByRole('list', { name: '팀 구성원과 초대' })
        .getByRole('listitem')
        .filter({ hasText: 'E2E Foreign Student' }),
    ).toBeVisible();
    await leader.getByLabel(/개인정보 수집·이용 동의/).check();
    await leader.screenshot({
      path: testInfo.outputPath(`accepted-preparation-${width}.png`),
      fullPage: true,
    });
    await leader
      .getByRole('button', { name: '신청 제출', exact: true })
      .click();
    await leader
      .getByRole('button', { name: '신청서 제출', exact: true })
      .click();
    await expect(leader.getByText('신청이 접수되었습니다')).toBeVisible();
    const team = await officialTeam(leader, programId);
    expect(team).toMatchObject({
      name: teamName,
      memberCount: 2,
      hasApplication: true,
    });
    expect(await officialTeam(invitee, programId)).toMatchObject({
      name: teamName,
      memberCount: 2,
      hasApplication: true,
    });
    const preparation = await leader.request.get(
      `/api/v1/application-preparations/programs/${programId}/me`,
    );
    expect(preparation.status()).toBe(200);
    expect(await preparation.text()).toBe('');
    await leader.screenshot({
      path: testInfo.outputPath(`submitted-${width}.png`),
      fullPage: true,
    });
  });
}
