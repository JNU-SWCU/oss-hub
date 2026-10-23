import { readFile, writeFile } from 'node:fs/promises';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { expect, test } from './admin-session.fixture';
import { chooseMutation, openDetail } from './support/admin-access-actions';
import { installBrowserAudit } from './support/browser-audit';
import {
  captureBothViewports,
  captureEvidenceRegion,
  capturePhase,
  EVIDENCE_VIEWPORTS,
  type CapturePhase,
} from './support/evidence-capture';
import {
  fixtureProgramId,
  originHeaders,
  PROGRAM_AUTHORING_CONTROL_PATH,
  resetProgramAuthoringControl,
  submitProgramApplication,
} from './support/program-authoring-ui';
import { seedId } from './support/session-cookie';

const PHASE: CapturePhase = capturePhase('FRONTEND_QUICKWINS_CAPTURE_PHASE');
const PREFIX = 'ticketless-frontend-quickwins';
const SIDEBAR_FOOT =
  '[data-slot="app-sidebar-foot"], [data-slot="program-scope-sidebar-foot"]';
const MILESTONE_ID = 'e2e:program-authoring:milestone';
const DOCUMENT_ID = 'e2e:program-authoring:document';
const MILESTONE_PATH = `/api/v1/milestones/${encodeURIComponent(MILESTONE_ID)}`;
const GRACE_PATH = `${MILESTONE_PATH}/documents/${encodeURIComponent(DOCUMENT_ID)}/grace`;
const ROLE_PATH = '/api/v1/onboarding/role';
const DELETE_TITLE = '마일스톤을 되돌릴 수 없이 삭제할까요?';
const DELETE_REFUSAL = '제출물이 있는 마일스톤은 삭제할 수 없습니다.';
const EXTERNAL_REDIRECT = '//external.example/landing';
const RANKING_ITEM = {
  rank: 1,
  displayName: 'synthetic-1',
  githubLogin: 'synthetic-1',
  name: '=1+1',
  department: 'synthetic-department',
  commitCount: 1,
  pullRequestCount: 2,
  issueCount: 3,
  repositoryCount: 4,
  starCount: 5,
  total: 15,
};

test.use({ timezoneId: 'Asia/Seoul' });

function idOf(value: unknown): string {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('id' in value) ||
    typeof value.id !== 'string' ||
    value.id === ''
  )
    throw new Error('Missing id');
  return value.id;
}

function dialogPanel(page: Page, title: string): Locator {
  return PHASE === 'before'
    ? page
        .locator('[role="dialog"][aria-modal="true"]')
        .filter({ hasText: title })
        .locator(':scope > div')
        .first()
    : page.locator('[data-slot="dialog-shell"]').filter({ hasText: title });
}

async function capture(
  page: Page,
  testInfo: TestInfo,
  name: string,
  target: Locator,
): Promise<void> {
  await page.addStyleTag({
    content: 'nextjs-portal { display: none !important; }',
  });
  await captureBothViewports({
    page,
    testInfo,
    phase: PHASE,
    prefix: PREFIX,
    name,
    target,
    masks: [page.locator(SIDEBAR_FOOT)],
  });
  await page.setViewportSize(EVIDENCE_VIEWPORTS[0]);
}

async function captureLowHeight(
  page: Page,
  testInfo: TestInfo,
  name: string,
  title: string,
  panel: Locator,
): Promise<void> {
  await captureEvidenceRegion({
    page,
    testInfo,
    phase: PHASE,
    prefix: PREFIX,
    name: `screen-${name}-low`,
    viewport: { ...EVIDENCE_VIEWPORTS[1], height: 440 },
    target:
      PHASE === 'before'
        ? page
            .locator('[role="dialog"][aria-modal="true"]')
            .filter({ hasText: title })
        : page.locator('[data-slot="dialog-overlay"]'),
    masks: [page.locator(SIDEBAR_FOOT)],
  });
  await record(testInfo, `${name}-low`, {
    buttons: await panel.getByRole('button').evaluateAll((buttons) =>
      buttons.map((button) => {
        const { top, bottom } = button.getBoundingClientRect();
        return {
          name: button.textContent?.trim() ?? '',
          inView: top >= 0 && bottom <= window.innerHeight,
        };
      }),
    ),
  });
  await page.setViewportSize(EVIDENCE_VIEWPORTS[0]);
}

async function record(
  testInfo: TestInfo,
  name: string,
  value: unknown,
): Promise<void> {
  await writeFile(
    testInfo.outputPath(`${PREFIX}-${PHASE}-${name}.json`),
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

async function focusedLabel(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || active === document.body)
      return null;
    return (
      active.getAttribute('aria-label') ??
      active.textContent?.trim() ??
      active.tagName
    );
  });
}

async function antiPatterns(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const hidden = (element: Element): boolean => {
      for (
        let node: Element | null = element;
        node;
        node = node.parentElement
      ) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden')
          return true;
      }
      return false;
    };
    const visibleText = (element: Element): string => {
      const clone = element.cloneNode(true);
      if (!(clone instanceof Element)) return '';
      clone
        .querySelectorAll('.sr-only,[aria-hidden="true"]')
        .forEach((node) => node.remove());
      return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
    };
    const out: string[] = [];
    const seen = new Map<string, number>();
    document
      .querySelectorAll('dd,dt,button,h1,h2,h3,p,span,li')
      .forEach((element) => {
        if (
          element.closest('tbody') !== null ||
          element.querySelector('dd,button,p,li') !== null
        )
          return;
        if (hidden(element)) return;
        const text = visibleText(element);
        if (text.length < 4) return;
        seen.set(text, (seen.get(text) ?? 0) + 1);
      });
    for (const [text, count] of seen)
      if (count > 1) out.push(`AP-1 중복 사실 — 「${text}」 ${count}회`);
    document.querySelectorAll('p,li,caption,figcaption').forEach((element) => {
      const text = visibleText(element);
      const counts = new Map<string, number>();
      for (const digits of text.match(/\d+/g) ?? [])
        counts.set(digits, (counts.get(digits) ?? 0) + 1);
      for (const [digits, count] of counts)
        if (count >= 3)
          out.push(`AP-8 수 반복 — 「${text}」가 ${digits}을 ${count}번`);
    });
    document
      .querySelectorAll('[role="group"],[role="tablist"]')
      .forEach((group) => {
        const options = Array.from(
          group.querySelectorAll('[aria-pressed],[aria-selected],[role="tab"]'),
        );
        for (const option of options) {
          const on =
            option.getAttribute('aria-pressed') === 'true' ||
            option.getAttribute('aria-selected') === 'true';
          if (on && /선택됨|선택|활성|현재/.test(visibleText(option)))
            out.push(`AP-4 상태 과잉표시 — 「${visibleText(option)}」`);
        }
        const numbers = options.map(
          (option) => /\d+/.exec(visibleText(option))?.[0],
        );
        if (
          options.length > 1 &&
          numbers.every((value) => value !== undefined && value === numbers[0])
        )
          out.push(
            `AP-7 무력한 컨트롤 — 선택지 ${options.length}개가 전부 ${numbers[0] ?? ''}`,
          );
      });
    return out.length > 0
      ? out
      : ['자동 점검 4종 통과 (중복 문구·상태 과잉표시·무력한 컨트롤·수 반복)'];
  });
}

test('초대 취소 버튼이 아이콘을 보여 준다', async ({
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
      name: '합성 빠른수정 초대',
      organizer: '합성 기관',
      trackType: 'EXTRACURRICULAR',
      applicationStartAt: new Date(now - 86_400_000).toISOString(),
      applicationEndAt: new Date(now + 86_400_000).toISOString(),
      endAt: new Date(now + 7 * 86_400_000).toISOString(),
      teamMinSize: 1,
      teamMaxSize: 3,
      description: '합성 초대 취소 아이콘 검증',
    },
  });
  expect(response.status()).toBe(201);
  const created: unknown = await response.json();
  const programId = idOf(created);
  const leader = await programAuthoringActorPage('student');
  await submitProgramApplication(leader, programId);
  await leader.goto(`/programs/${programId}/team`);
  await leader.getByRole('button', { name: '팀원 초대', exact: true }).click();
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
  const team = await leader.request.get(
    `/api/v1/programs/${encodeURIComponent(programId)}/teams/me`,
  );
  expect(team.status()).toBe(200);
  const teamBody: unknown = await team.json();
  const teamId = idOf(teamBody);

  const audit = installBrowserAudit(control);
  await control.goto(
    `/programs/${encodeURIComponent(programId)}/teams/${encodeURIComponent(teamId)}`,
  );
  const roster = control.locator('ul[aria-label="팀 구성원과 초대"]');
  const cancel = roster.getByRole('button', {
    name: 'E2E Foreign Student 초대 취소',
    exact: true,
  });
  await expect(cancel).toBeVisible();
  const icon = cancel.locator('svg');
  if (PHASE === 'before') await expect(icon).toBeHidden();
  else await expect(icon).toBeVisible();
  await capture(control, testInfo, 'element-invite-cancel', roster);
  await capture(
    control,
    testInfo,
    'screen-invite-cancel',
    control.locator('body'),
  );
  await record(testInfo, 'invite-cancel', {
    iconVisible: await icon.isVisible(),
    antiPatterns: await antiPatterns(control),
  });
  await cancel.click();
  await expect(cancel).toBeHidden();
  audit.assertClean();
});

test('유예 기한 저장이 서버 오류로 실패하면 화면 문구로 알린다', async ({
  authSeedPage,
  programAuthoringActorPage,
}, testInfo) => {
  const control = await authSeedPage('admin-confirmed');
  await resetProgramAuthoringControl(control);
  const programId = await fixtureProgramId(control);
  const page = await programAuthoringActorPage('staff', {
    status: 502,
    pathname: GRACE_PATH,
  });
  await page.route(
    (url) => url.pathname === GRACE_PATH,
    async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      await route.fulfill({
        status: 502,
        contentType: 'text/html; charset=utf-8',
        body: '<!doctype html><title>502</title><p>Bad Gateway</p>',
      });
    },
  );
  const audit = installBrowserAudit(page);
  await page.goto(`/programs/${encodeURIComponent(programId)}`);
  const row = page
    .getByTestId('milestone-document-row')
    .filter({ hasText: DOCUMENT_ID });
  await row
    .getByRole('button', { name: `${DOCUMENT_ID} 유예 기한 설정`, exact: true })
    .click();
  await row
    .getByLabel(`${DOCUMENT_ID} 유예 기한 (한국 시간)`, { exact: true })
    .fill('2026-12-31T18:00');
  await row
    .getByRole('button', { name: '유예 기한 저장', exact: true })
    .click();
  await expect(row.locator('[role="alert"]')).toHaveText(
    PHASE === 'before'
      ? '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'
      : '유예 기한을 저장하지 못했습니다. 다시 시도해 주세요.',
  );
  await capture(page, testInfo, 'element-grace-failure', row);
  await capture(page, testInfo, 'screen-grace-failure', page.locator('body'));
  await record(testInfo, 'grace-failure', {
    message: await row.locator('[role="alert"]').textContent(),
    antiPatterns: await antiPatterns(page),
  });
  audit.assertClean([{ status: 502, path: GRACE_PATH, method: 'PATCH' }]);
});

test('마일스톤 삭제 다이얼로그는 Escape로 닫히고 실패 이유를 안에서 알린다', async ({
  authSeedPage,
  programAuthoringActorPage,
}, testInfo) => {
  const control = await authSeedPage('admin-confirmed');
  await resetProgramAuthoringControl(control);
  const programId = await fixtureProgramId(control);
  const page = await programAuthoringActorPage('staff', {
    status: 409,
    pathname: MILESTONE_PATH,
  });
  await page.route(
    (url) => url.pathname === MILESTONE_PATH,
    async (route) => {
      if (route.request().method() !== 'DELETE') return route.fallback();
      await route.fulfill({
        status: 409,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'about:blank',
          title: 'Conflict',
          status: 409,
          detail: DELETE_REFUSAL,
          instance: MILESTONE_PATH,
          code: 'PRG_009',
        }),
      });
    },
  );
  const audit = installBrowserAudit(page);
  await page.goto(`/programs/${encodeURIComponent(programId)}/edit`);
  const card = page.locator(`[data-canonical-id="${MILESTONE_ID}"]`);
  const opener = card.getByRole('button', {
    name: `${MILESTONE_ID} 삭제`,
    exact: true,
  });
  await opener.click();
  const panel = dialogPanel(page, DELETE_TITLE);
  await expect(panel).toBeVisible();
  await capture(page, testInfo, 'element-delete-dialog', panel);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await record(testInfo, 'delete-dialog-escape', {
    panelCount: await panel.count(),
    focused: await focusedLabel(page),
  });
  if (PHASE === 'before') {
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: '취소', exact: true }).click();
  } else {
    await expect(panel).toHaveCount(0);
    await expect(opener).toBeFocused();
  }

  await opener.click();
  await panel.getByRole('button', { name: '삭제 확정', exact: true }).click();
  if (PHASE === 'before') {
    await expect(
      page.locator('[data-slot="alert"]').filter({ hasText: DELETE_REFUSAL }),
    ).toBeVisible();
    await expect(panel.locator('[role="alert"]')).toHaveCount(0);
  } else {
    await expect(panel.locator('[role="alert"]')).toContainText(DELETE_REFUSAL);
    await expect(
      page.locator('[data-slot="alert"]').filter({ hasText: '처리 실패' }),
    ).toHaveCount(0);
  }
  await capture(page, testInfo, 'element-delete-failure', panel);
  await capture(page, testInfo, 'screen-delete-failure', page.locator('body'));
  await record(testInfo, 'delete-failure', {
    alertInDialog: await panel.locator('[role="alert"]').count(),
    antiPatterns: await antiPatterns(page),
  });
  await captureLowHeight(page, testInfo, 'delete-failure', DELETE_TITLE, panel);
  audit.assertClean([{ status: 409, path: MILESTONE_PATH, method: 'DELETE' }]);
});

test('요청 반려 다이얼로그는 Escape로 닫히고 반려 버튼으로 포커스를 돌려준다', async ({
  adminPage,
}, testInfo) => {
  const audit = installBrowserAudit(adminPage);
  await openDetail(
    adminPage,
    seedId('auth', 'staff-pending-second'),
    '합성 두 번째 대기 사용자',
  );
  await chooseMutation(adminPage, '요청 반려');
  const panel = dialogPanel(adminPage, '요청 반려');
  await expect(panel).toBeVisible();
  await capture(adminPage, testInfo, 'element-reject-dialog', panel);
  await capture(
    adminPage,
    testInfo,
    'screen-reject-dialog',
    adminPage.locator('body'),
  );
  await record(testInfo, 'reject-dialog', {
    antiPatterns: await antiPatterns(adminPage),
  });

  await adminPage.keyboard.press('Escape');
  await adminPage.waitForTimeout(500);
  await record(testInfo, 'reject-dialog-escape', {
    panelCount: await panel.count(),
    focused: await focusedLabel(adminPage),
  });
  if (PHASE === 'before') {
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: '취소', exact: true }).click();
  } else {
    await expect(panel).toHaveCount(0);
    await expect(
      adminPage.getByRole('button', { name: '반려', exact: true }),
    ).toBeFocused();
  }

  await chooseMutation(adminPage, '요청 반려');
  await panel
    .getByLabel('반려 사유', { exact: true })
    .fill(
      '제출한 재직 증빙 서류의 발급일이 신청 기준일보다 오래되어 확인하기 어렵습니다. 최근 3개월 안에 발급한 서류로 다시 신청해 주세요.',
    );
  await captureLowHeight(
    adminPage,
    testInfo,
    'reject-dialog',
    '요청 반려',
    panel,
  );
  audit.assertClean();
});

test('역할 선택 뒤 외부 주소로 보내는 응답을 받아도 앱 안에 머문다', async ({
  authSeedPage,
}, testInfo) => {
  const page = await authSeedPage('user-role-unselected');
  await page.route(
    (url) => url.pathname === ROLE_PATH,
    async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const response = await route.fetch();
      const payload: unknown = await response.json();
      if (typeof payload !== 'object' || payload === null)
        throw new Error('Missing role selection result');
      await route.fulfill({
        response,
        json: { ...payload, redirectTo: EXTERNAL_REDIRECT },
      });
    },
  );
  await page.route(/^https?:\/\/external\.example\//, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><title>합성 외부</title><p>합성 외부 페이지</p>',
    }),
  );
  const audit = installBrowserAudit(page);
  await page.goto('/onboarding/role');
  await page.locator('label[data-role="STUDENT"]').click();
  await expect(page.getByRole('radio', { name: '학생' })).toBeChecked();
  await record(testInfo, 'role-selection', {
    antiPatterns: await antiPatterns(page),
  });
  await page.getByRole('button', { name: '선택 완료', exact: true }).click();
  if (PHASE === 'before') await page.waitForURL(/external\.example/);
  else {
    await expect(page).toHaveURL(/\/onboarding\/profile$/);
    await expect(page.getByLabel('이름')).toBeVisible();
  }
  const landed = new URL(page.url());
  await record(testInfo, 'role-redirect', {
    external: landed.hostname === 'external.example',
    pathname: landed.pathname,
  });
  await capture(page, testInfo, 'screen-role-redirect', page.locator('body'));
  audit.assertClean();
});

test('순위 CSV는 수식으로 읽힐 이름 앞에 작은따옴표를 붙여 내려준다', async ({
  authSeedPage,
  programAuthoringActorPage,
}, testInfo) => {
  test.setTimeout(120_000);
  const control = await authSeedPage('admin-confirmed');
  await resetProgramAuthoringControl(control);
  await fixtureProgramId(control);
  const page = await programAuthoringActorPage('staff');
  await page.route('**/api/v1/ranking*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/years')) return route.fallback();
    const requestPage = Number(url.searchParams.get('page') ?? '1');
    await route.fulfill({
      json: {
        year: 2026,
        items: requestPage === 1 ? [RANKING_ITEM] : [],
        page: requestPage,
        pageSize: Number(url.searchParams.get('pageSize') ?? '20'),
        total: 1,
        dataAsOf: '2026-08-19T02:30:00.000Z',
        viewerClass: 'staff',
        nextCycleAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      },
    });
  });
  await page.route('**/api/v1/ranking/years*', (route) =>
    route.fulfill({ json: { years: [2026] } }),
  );
  const audit = installBrowserAudit(page);
  await page.goto('/ranking?year=2026');
  await expect(page.getByRole('button', { name: /계정 메뉴/ })).toBeVisible();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV 다운로드' }).click();
  const download = await downloading;
  const firstRow = (await readFile(await download.path()))
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .split('\r\n')[1];
  expect(download.suggestedFilename()).toBe('ranking-2026.csv');
  expect(firstRow).toBe(
    PHASE === 'before'
      ? '1,=1+1,synthetic-1,synthetic-department,1,2,3,4,5,15'
      : "1,'=1+1,synthetic-1,synthetic-department,1,2,3,4,5,15",
  );
  await record(testInfo, 'ranking-csv', {
    filename: download.suggestedFilename(),
    firstRow,
  });
  await capture(page, testInfo, 'screen-ranking-csv', page.locator('body'));
  audit.assertClean();
});

test('마일스톤이 바뀐 뒤 늦게 온 이전 제출 양식 응답은 화면을 덮지 않는다', async ({
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
  const page = await programAuthoringActorPage('student');
  const day = 86_400_000;
  const dueAt = new Date(
    (Math.floor(Date.now() / day) + 30) * day,
  ).toISOString();
  const fileUpload = { maxBytes: 10_485_760, maxLabel: '10 MB' };
  const milestones = [
    { id: 'synthetic-milestone-a', name: '합성 A 단계' },
    { id: 'synthetic-milestone-b', name: '합성 B 단계' },
  ];
  const aRequested = Promise.withResolvers<void>();
  const aReleased = Promise.withResolvers<void>();
  await page.route('**/api/v1/programs/*/submissions/me', (route) =>
    route.fulfill({
      json: {
        fileUpload,
        applicationId: 'synthetic-application',
        applicationMode: 'PERSONAL',
        items: milestones.map((milestone) => ({
          milestoneId: milestone.id,
          name: milestone.name,
          dueAt,
          submissionType: 'TEXT',
          submission: null,
        })),
      },
    }),
  );
  await page.route(
    '**/api/v1/programs/*/milestones/*/submission-form',
    async (route) => {
      const id = decodeURIComponent(
        new URL(route.request().url()).pathname.split('/').at(-2) ?? '',
      );
      const milestone = milestones.find((candidate) => candidate.id === id);
      if (!milestone) return route.fallback();
      if (milestone.id === 'synthetic-milestone-a') {
        aRequested.resolve();
        await aReleased.promise;
      }
      await route.fulfill({
        json: {
          fileUpload,
          applicationId: 'synthetic-application',
          applicationMode: 'PERSONAL',
          milestone: {
            id: milestone.id,
            name: milestone.name,
            dueAt,
            dDay: 30,
            deadlineLabel: 'D-30',
            submissionType: 'TEXT',
            instructions: `${milestone.name} 제출 안내`,
          },
          existingSubmission: null,
          canSubmit: true,
          blockedReason: null,
        },
      });
    },
  );
  const audit = installBrowserAudit(page);
  await page.goto(
    `/programs/${encodeURIComponent(programId)}/documents?milestoneId=synthetic-milestone-a`,
  );
  await aRequested.promise;
  await page.evaluate(
    (id) =>
      window.history.pushState(
        null,
        '',
        `${window.location.pathname}?milestoneId=${encodeURIComponent(id)}`,
      ),
    'synthetic-milestone-b',
  );
  const dialog = page.getByRole('dialog', { name: '합성 B 단계' });
  await expect(dialog).toBeVisible();
  const body = page.getByTestId('submission-dialog-body');
  await expect(body).toContainText('합성 B 단계 제출 안내');
  const lateA = page.waitForResponse((response) =>
    response.url().includes('synthetic-milestone-a/submission-form'),
  );
  aReleased.resolve();
  await lateA;
  if (PHASE === 'before')
    await expect(body).toContainText('합성 A 단계 제출 안내');
  else {
    await page.waitForTimeout(500);
    await expect(body).toContainText('합성 B 단계 제출 안내');
    await expect(body).not.toContainText('합성 A 단계 제출 안내');
  }
  await record(testInfo, 'submission-stale', {
    dialogTitle: await dialog.getByRole('heading').first().textContent(),
    showsA: await body.getByText('합성 A 단계 제출 안내').count(),
    showsB: await body.getByText('합성 B 단계 제출 안내').count(),
  });
  await capture(page, testInfo, 'element-submission-stale', dialog);
  await capture(
    page,
    testInfo,
    'screen-submission-stale',
    page.locator('body'),
  );
  audit.assertClean();
});
