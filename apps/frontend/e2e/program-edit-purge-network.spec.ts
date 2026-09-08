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
const SCOPE_FINGERPRINT = 'a'.repeat(32);
const CHANGED_SCOPE_FINGERPRINT = 'b'.repeat(32);
const COUNTS = {
  applications: 4,
  teams: 4,
  boardPosts: 2,
  submissions: 3,
  submissionEvents: 5,
  scopeFingerprint: SCOPE_FINGERPRINT,
} as const;
const ZERO_COUNTS = {
  applications: 0,
  teams: 0,
  boardPosts: 0,
  submissions: 0,
  submissionEvents: 0,
  scopeFingerprint: SCOPE_FINGERPRINT,
} as const;

type Counts = {
  readonly applications: number;
  readonly teams: number;
  readonly boardPosts: number;
  readonly submissions: number;
  readonly submissionEvents: number;
  readonly scopeFingerprint: string;
};
type PurgeResponse = {
  readonly status: number;
  readonly body: unknown;
};

interface Scenario {
  readonly actor: SessionActor;
  readonly counts: Counts;
  readonly purgeResponses?: readonly PurgeResponse[];
  readonly purgeDelayMs?: number;
  readonly scopeDelayMs?: number;
  readonly scopeError?: boolean;
}

function editableProgram(counts: Counts) {
  return {
    id: PROGRAM_ID,
    name: PROGRAM_NAME,
    organizer: '합성 운영팀',
    trackType: 'EXTRACURRICULAR',
    lifecycle: 'PUBLISHED',
    applicationTemplateKey: 'oss-contest',
    applicationTemplateVersion: 1,
    applicationCount: counts.applications,
    deletionScopeCounts: counts,
    applicationStartAt: '2026-01-01T00:00:00.000Z',
    applicationEndAt: '2026-02-01T00:00:00.000Z',
    startAt: '2026-01-01T00:00:00.000Z',
    endAt: '2026-03-01T00:00:00.000Z',
    repositoryProvisioningEnabled: false,
    notifyOnDeadline: false,
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
): Promise<{
  readonly purgeRequests: unknown[];
  readonly normalDeletes: string[];
  readonly lifecyclePatches: unknown[];
}> {
  const purgeRequests: unknown[] = [];
  const normalDeletes: string[] = [];
  const lifecyclePatches: unknown[] = [];
  let initialLoadComplete = false;
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (
      request.method() === 'PATCH' &&
      path.endsWith(`/programs/${PROGRAM_ID}/lifecycle`)
    ) {
      lifecyclePatches.push(JSON.parse(request.postData() ?? '{}'));
      await json(
        route,
        { detail: 'lifecycle PATCH must not be requested' },
        500,
      );
      return;
    }
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
      const response = scenario.purgeResponses?.[purgeRequests.length - 1] ?? {
        status: 200,
        body: {
          id: PROGRAM_ID,
          deleted: true,
          deletedCounts: scenario.counts,
        },
      };
      if (scenario.purgeDelayMs) {
        await new Promise((resolve) =>
          setTimeout(resolve, scenario.purgeDelayMs),
        );
      }
      await route.fulfill({
        status: response.status,
        contentType:
          response.status >= 400
            ? 'application/problem+json'
            : 'application/json',
        body: JSON.stringify(response.body),
      });
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
      if (initialLoadComplete && scenario.scopeDelayMs) {
        await new Promise((resolve) =>
          setTimeout(resolve, scenario.scopeDelayMs),
        );
      }
      if (initialLoadComplete && scenario.scopeError) {
        await json(route, { detail: 'scope unavailable' }, 500);
        return;
      }
      await json(route, editableProgram(scenario.counts));
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
  await page.waitForLoadState('networkidle');
  initialLoadComplete = true;
  return { purgeRequests, normalDeletes, lifecyclePatches };
}

async function openPurge(page: Page, counts: Counts = COUNTS) {
  await page
    .getByRole('button', { name: '프로그램 삭제', exact: true })
    .click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  const summary =
    counts === ZERO_COUNTS
      ? '연결된 데이터 없음'
      : `지원서 ${counts.applications}건 · 팀 ${counts.teams}개 · 게시글 ${counts.boardPosts}건 · 제출물 ${counts.submissions}건 · 제출·검토·파일 이력 ${counts.submissionEvents}건`;
  await expect(page.getByText(summary, { exact: true })).toBeVisible();
}

test.describe('program edit purge network contract', () => {
  test('ADMIN confirms one purge with the displayed full scope', async ({
    page,
  }) => {
    const { purgeRequests, normalDeletes, lifecyclePatches } = await openEdit(
      page,
      { actor: 'admin', counts: COUNTS },
    );
    const trigger = page.getByRole('button', {
      name: '프로그램 삭제',
      exact: true,
    });
    await expect(trigger).toHaveCount(1);
    await expect(page.getByText('내리기', { exact: true })).toHaveCount(0);
    await expect(page.getByText('다시 게시하기', { exact: true })).toHaveCount(
      0,
    );
    await openPurge(page);
    await expect(page.getByLabel('프로그램 이름')).toHaveCount(0);
    await page.getByRole('button', { name: '삭제', exact: true }).click();
    await expect(page).toHaveURL(/\/programs(?:\?|$)/);
    expect(purgeRequests).toEqual([{ expectedScope: COUNTS }]);
    expect(normalDeletes).toEqual([]);
    expect(lifecyclePatches).toEqual([]);
    const evidenceDir = resolve(
      process.cwd(),
      '../../.omo/evidence/task-5-browser',
    );
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(
      resolve(evidenceDir, 'purge-network-request-log.json'),
      JSON.stringify(
        { purgeRequests, normalDeletes, lifecyclePatches },
        null,
        2,
      ),
    );
    await page.screenshot({
      path: resolve(evidenceDir, 'admin-purge-success.png'),
      fullPage: true,
    });
  });

  test('zero-count scope can be cancelled without mutation and then confirmed', async ({
    page,
  }) => {
    const { purgeRequests, normalDeletes, lifecyclePatches } = await openEdit(
      page,
      { actor: 'admin', counts: ZERO_COUNTS },
    );
    const trigger = page.getByRole('button', {
      name: '프로그램 삭제',
      exact: true,
    });
    await trigger.focus();
    await openPurge(page, ZERO_COUNTS);
    await expect(
      page.getByRole('button', { name: '삭제', exact: true }),
    ).toBeEnabled();
    await page.getByRole('button', { name: '취소', exact: true }).click();
    await expect(trigger).toBeFocused();
    expect(purgeRequests).toEqual([]);
    expect(normalDeletes).toEqual([]);
    expect(lifecyclePatches).toEqual([]);
    await trigger.click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.getByRole('button', { name: '삭제', exact: true }).click();
    await expect(page).toHaveURL(/\/programs(?:\?|$)/);
    expect(purgeRequests).toEqual([{ expectedScope: ZERO_COUNTS }]);
  });

  test('STAFF uses the same direct purge action', async ({ page }) => {
    const { purgeRequests, normalDeletes, lifecyclePatches } = await openEdit(
      page,
      { actor: 'staff', counts: COUNTS },
    );
    await expect(
      page.getByRole('button', { name: '프로그램 삭제', exact: true }),
    ).toHaveCount(1);
    await openPurge(page);
    await page.getByRole('button', { name: '삭제', exact: true }).click();
    await expect(page).toHaveURL(/\/programs(?:\?|$)/);
    expect(purgeRequests).toEqual([{ expectedScope: COUNTS }]);
    expect(normalDeletes).toEqual([]);
    expect(lifecyclePatches).toEqual([]);
  });

  test('purge failure stays visible without an automatic retry', async ({
    page,
  }) => {
    const { purgeRequests, normalDeletes, lifecyclePatches } = await openEdit(
      page,
      {
        actor: 'admin',
        counts: COUNTS,
        purgeResponses: [
          {
            status: 500,
            body: {
              type: 'about:blank',
              title: 'Purge failed',
              status: 500,
              detail: '삭제할 수 없습니다.',
              instance: `/programs/${PROGRAM_ID}/purge`,
              code: 'SYS_000',
            },
          },
        ],
      },
    );
    await openPurge(page);
    await page.getByRole('button', { name: '삭제', exact: true }).click();
    await expect(
      page.getByText('삭제할 수 없습니다.', { exact: true }),
    ).toBeVisible();
    expect(purgeRequests).toEqual([{ expectedScope: COUNTS }]);
    expect(normalDeletes).toEqual([]);
    expect(lifecyclePatches).toEqual([]);
  });

  test('scope drift updates the displayed scope without automatic retry', async ({
    page,
  }) => {
    const changedCounts = {
      applications: 5,
      teams: 4,
      boardPosts: 2,
      submissions: 3,
      submissionEvents: 6,
      scopeFingerprint: CHANGED_SCOPE_FINGERPRINT,
    } as const;
    const { purgeRequests, normalDeletes, lifecyclePatches } = await openEdit(
      page,
      {
        actor: 'admin',
        counts: COUNTS,
        purgeResponses: [
          {
            status: 409,
            body: {
              type: 'about:blank',
              title: 'Program scope changed',
              status: 409,
              detail: '삭제 범위가 변경되었습니다.',
              instance: `/programs/${PROGRAM_ID}/purge`,
              code: 'PRG_014',
              currentScopeCounts: changedCounts,
            },
          },
          {
            status: 200,
            body: {
              id: PROGRAM_ID,
              deleted: true,
              deletedCounts: changedCounts,
            },
          },
        ],
      },
    );
    await openPurge(page);
    await page.getByRole('button', { name: '삭제', exact: true }).click();
    await expect(
      page.getByText(
        '삭제 범위가 변경되었습니다. 내용을 확인한 뒤 삭제를 다시 눌러 주세요.',
        { exact: true },
      ),
    ).toBeVisible();
    expect(purgeRequests).toEqual([{ expectedScope: COUNTS }]);
    await expect(
      page.getByText(
        '지원서 5건 · 팀 4개 · 게시글 2건 · 제출물 3건 · 제출·검토·파일 이력 6건',
        { exact: true },
      ),
    ).toBeVisible();
    await page.getByRole('button', { name: '삭제', exact: true }).click();
    await expect(page).toHaveURL(/\/programs(?:\?|$)/);
    expect(purgeRequests).toEqual([
      { expectedScope: COUNTS },
      { expectedScope: changedCounts },
    ]);
    expect(normalDeletes).toEqual([]);
    expect(lifecyclePatches).toEqual([]);
  });

  test('scope loading blocks confirmation', async ({ page }) => {
    const loading = await openEdit(page, {
      actor: 'admin',
      counts: COUNTS,
      scopeDelayMs: 250,
    });
    await page
      .getByRole('button', { name: '프로그램 삭제', exact: true })
      .click();
    await expect(
      page.getByRole('alertdialog').getByRole('button').last(),
    ).toBeDisabled();
    expect(loading.purgeRequests).toEqual([]);
    await expect(
      page.getByText(
        '지원서 4건 · 팀 4개 · 게시글 2건 · 제출물 3건 · 제출·검토·파일 이력 5건',
        { exact: true },
      ),
    ).toBeVisible();
    expect(loading.purgeRequests).toEqual([]);
  });

  test('scope failure blocks confirmation', async ({ page }) => {
    const failure = await openEdit(page, {
      actor: 'admin',
      counts: COUNTS,
      scopeError: true,
    });
    await page
      .getByRole('button', { name: '프로그램 삭제', exact: true })
      .click();
    await expect(
      page.getByText('삭제 범위를 확인하지 못했습니다. 다시 시도해 주세요.', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: '삭제', exact: true }),
    ).toBeDisabled();
    expect(failure.purgeRequests).toEqual([]);
  });

  test('duplicate in-flight confirmation never mutates twice', async ({
    page,
  }) => {
    const pending = await openEdit(page, {
      actor: 'admin',
      counts: COUNTS,
      purgeDelayMs: 1000,
    });
    await page
      .getByRole('button', { name: '프로그램 삭제', exact: true })
      .click();
    await expect(
      page.getByText(
        '지원서 4건 · 팀 4개 · 게시글 2건 · 제출물 3건 · 제출·검토·파일 이력 5건',
        { exact: true },
      ),
    ).toBeVisible();
    await page.getByRole('button', { name: '삭제', exact: true }).click();
    await expect.poll(() => pending.purgeRequests.length).toBe(1);
    await expect(
      page.getByRole('alertdialog').getByRole('button').last(),
    ).toBeDisabled();
    await page
      .getByRole('alertdialog')
      .getByRole('button')
      .last()
      .click({ force: true });
    expect(pending.purgeRequests).toHaveLength(1);
    await expect(page).toHaveURL(/\/programs(?:\?|$)/);
  });
});
