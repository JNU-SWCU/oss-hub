import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

import {
  authenticatedSessionBody,
  type SessionActor,
} from './support/session-mock';

const PROGRAM_ID = 'synthetic-program-purge';
const PROGRAM_NAME = '합성 P4 프로그램';
const COUNTS = { applications: 4, teams: 4, boardPosts: 2, submissions: 3 };
const ZERO_COUNTS = {
  applications: 0,
  teams: 0,
  boardPosts: 0,
  submissions: 0,
};

type Counts = typeof COUNTS;

interface Scenario {
  readonly actor: SessionActor;
  readonly counts: Counts;
  readonly purgeStatus?: number;
  readonly purgeBody?: unknown;
}

function editableProgram(deletionProtected = false) {
  return {
    id: PROGRAM_ID,
    name: PROGRAM_NAME,
    organizer: '합성 운영팀',
    trackType: 'EXTRACURRICULAR',
    lifecycle: 'PUBLISHED',
    applicationTemplateKey: 'oss-contest',
    applicationTemplateVersion: 1,
    applicationCount: 4,
    deletionScopeCounts: COUNTS,
    applicationStartAt: '2026-01-01T00:00:00.000Z',
    applicationEndAt: '2026-02-01T00:00:00.000Z',
    startAt: '2026-01-01T00:00:00.000Z',
    endAt: '2026-03-01T00:00:00.000Z',
    repositoryProvisioningEnabled: false,
    notifyOnDeadline: false,
    deletionProtected,
    description: '합성 프로그램 설명',
    teamMinSize: 1,
    teamMaxSize: 4,
    milestones: [],
  };
}

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function openEdit(
  page: Page,
  scenario: Scenario,
  deletionProtected = false,
): Promise<{
  readonly purgeRequests: unknown[];
  readonly normalDeletes: string[];
}> {
  const purgeRequests: unknown[] = [];
  const normalDeletes: string[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (
      request.method() === 'DELETE' &&
      path.endsWith(`/programs/${PROGRAM_ID}`)
    ) {
      normalDeletes.push(path);
      await json(route, { detail: 'normal DELETE must not be requested' }, 500);
      return;
    }
    if (
      request.method() === 'DELETE' &&
      path.endsWith(`/programs/${PROGRAM_ID}/purge`)
    ) {
      purgeRequests.push(JSON.parse(request.postData() ?? '{}'));
      if (scenario.purgeStatus && scenario.purgeBody !== undefined) {
        await route.fulfill({
          status: scenario.purgeStatus,
          contentType: 'application/problem+json',
          body: JSON.stringify(scenario.purgeBody),
        });
      } else {
        await json(route, {
          id: PROGRAM_ID,
          deleted: true,
          deletedCounts: scenario.counts,
        });
      }
      return;
    }
    if (path.endsWith('/auth/session')) {
      await json(route, authenticatedSessionBody(scenario.actor));
      return;
    }
    if (path.endsWith('/onboarding/role')) {
      await json(route, { selectedRole: null });
      return;
    }
    if (path.endsWith('/role-requests/me')) {
      await json(route, null);
      return;
    }
    if (path.endsWith(`/programs/${PROGRAM_ID}/edit`)) {
      await json(route, editableProgram(deletionProtected));
      return;
    }
    if (path.endsWith('/programs/status-counts')) {
      await json(route, {
        published: 1,
        recruiting: 1,
        closed: 0,
        archived: 0,
      });
      return;
    }
    await route.continue();
  });
  await page.goto(`/programs/${PROGRAM_ID}/edit`);
  await expect(
    page.getByRole('heading', { name: '프로그램 편집' }),
  ).toBeVisible();
  return { purgeRequests, normalDeletes };
}

async function openPurge(page: Page) {
  await page
    .getByRole('button', { name: '프로그램 영구 삭제', exact: true })
    .click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await expect(
    page.getByText('지원서 4건 · 팀 4개 · 게시글 2건 · 제출물 3건'),
  ).toBeVisible();
}

test.describe('program edit purge network contract', () => {
  test('ADMIN uses one purge action, exact scope, and blocks normal DELETE', async ({
    page,
  }) => {
    const { purgeRequests, normalDeletes } = await openEdit(page, {
      actor: 'admin',
      counts: COUNTS,
    });
    await expect(
      page.getByRole('button', { name: '프로그램 영구 삭제', exact: true }),
    ).toHaveCount(1);
    await openPurge(page);
    const input = page.getByLabel('프로그램 이름');
    const submit = page
      .getByRole('button', { name: '프로그램 영구 삭제', exact: true })
      .last();
    await input.fill('다른 이름');
    await expect(submit).toBeDisabled();
    expect(purgeRequests).toEqual([]);
    await input.fill(PROGRAM_NAME);
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page).toHaveURL(/\/programs(?:\?|$)/);
    expect(purgeRequests).toEqual([{ expectedScope: COUNTS }]);
    expect(normalDeletes).toEqual([]);
    const evidenceDir = resolve(
      process.cwd(),
      '../../.omo/evidence/task-5-browser',
    );
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(
      resolve(evidenceDir, 'purge-network-request-log.json'),
      JSON.stringify({ purgeRequests, normalDeletes }, null, 2),
    );
    await page.screenshot({
      path: resolve(evidenceDir, 'admin-purge-success.png'),
      fullPage: true,
    });
  });

  test('zero-count programs still use purge and cancel restores focus', async ({
    page,
  }) => {
    const requests: unknown[] = [];
    await page.route('**/api/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().method() === 'DELETE' && path.endsWith('/purge')) {
        requests.push(JSON.parse(route.request().postData() ?? '{}'));
        await json(route, {
          id: PROGRAM_ID,
          deleted: true,
          deletedCounts: ZERO_COUNTS,
        });
      } else if (path.endsWith('/auth/session'))
        await json(route, authenticatedSessionBody('admin'));
      else if (path.endsWith('/onboarding/role'))
        await json(route, { selectedRole: null });
      else if (path.endsWith('/role-requests/me')) await json(route, null);
      else if (path.endsWith(`/programs/${PROGRAM_ID}/edit`))
        await json(route, {
          ...editableProgram(false),
          deletionScopeCounts: ZERO_COUNTS,
          applicationCount: 0,
        });
      else await route.continue();
    });
    await page.goto(`/programs/${PROGRAM_ID}/edit`);
    const trigger = page.getByRole('button', {
      name: '프로그램 영구 삭제',
      exact: true,
    });
    await trigger.focus();
    await trigger.click();
    await expect(page.getByText('연결된 데이터 없음')).toBeVisible();
    await page.getByRole('button', { name: '취소', exact: true }).click();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.getByLabel('프로그램 이름').fill(PROGRAM_NAME);
    await page
      .getByRole('button', { name: '프로그램 영구 삭제', exact: true })
      .last()
      .click();
    expect(requests).toEqual([{ expectedScope: ZERO_COUNTS }]);
  });

  test('protected programs keep the purge control disabled', async ({
    page,
  }) => {
    const protectedScenario = await openEdit(
      page,
      { actor: 'admin', counts: COUNTS },
      true,
    );
    await expect(
      page.getByRole('button', { name: '프로그램 영구 삭제', exact: true }),
    ).toBeDisabled();
    await expect(page.getByText('삭제 보호된 프로그램입니다')).toBeVisible();
    expect(protectedScenario.normalDeletes).toEqual([]);
  });

  // #1095 — 교직원도 위험 영역의 영구 삭제를 누른다. 종전에는 버튼 count 0 이었다.
  test('STAFF uses the same purge action and exact scope', async ({ page }) => {
    const { purgeRequests, normalDeletes } = await openEdit(page, {
      actor: 'staff',
      counts: COUNTS,
    });
    await expect(
      page.getByRole('button', { name: '프로그램 영구 삭제', exact: true }),
    ).toHaveCount(1);
    await openPurge(page);
    const input = page.getByLabel('프로그램 이름');
    const submit = page
      .getByRole('button', { name: '프로그램 영구 삭제', exact: true })
      .last();
    await input.fill(PROGRAM_NAME);
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page).toHaveURL(/\/programs(?:\?|$)/);
    expect(purgeRequests).toEqual([{ expectedScope: COUNTS }]);
    expect(normalDeletes).toEqual([]);
  });

  test('scope drift reports precise error without retry', async ({ page }) => {
    const { purgeRequests } = await openEdit(page, {
      actor: 'admin',
      counts: COUNTS,
      purgeStatus: 409,
      purgeBody: {
        type: 'about:blank',
        title: 'Program scope changed',
        status: 409,
        detail: '삭제 범위가 변경되었습니다. 다시 확인해 주세요.',
        instance: `/programs/${PROGRAM_ID}/purge`,
        code: 'PRG_014',
        currentScopeCounts: {
          applications: 5,
          teams: 4,
          boardPosts: 2,
          submissions: 3,
        },
      },
    });
    await openPurge(page);
    await page.getByLabel('프로그램 이름').fill(PROGRAM_NAME);
    const submit = page
      .getByRole('button', { name: '프로그램 영구 삭제', exact: true })
      .last();
    await submit.click();
    await expect(
      page.getByText(
        '삭제 범위가 변경되었습니다. 내용을 확인한 뒤 프로그램 이름을 다시 입력해 주세요.',
      ),
    ).toBeVisible();
    expect(purgeRequests).toEqual([{ expectedScope: COUNTS }]);
  });
});
