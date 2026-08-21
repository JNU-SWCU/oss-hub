import { expect, type Browser } from '@playwright/test';
import { armSessionResponse } from './legacy-member-reclassification-actions';
import { installBrowserAudit } from './browser-audit';
import {
  installLegacyMemberReclassificationFixture,
  SESSION_PATH,
  type SessionState,
  TASK_10_BROWSER_TIMEOUT,
} from './legacy-member-reclassification-fixture';
import { recordLegacyReclassificationScenario } from './legacy-member-reclassification-suite';

interface AbsenceScenario {
  readonly name: string;
  readonly session: SessionState;
  readonly status: number;
}

const absenceScenarios: readonly AbsenceScenario[] = [
  { name: 'anonymous', session: { kind: 'anonymous' }, status: 200 },
  { name: 'loading', session: { kind: 'anonymous' }, status: 200 },
  { name: 'error', session: { kind: 'error' }, status: 500 },
  {
    name: 'unassigned',
    session: {
      kind: 'authenticated',
      role: null,
      memberKind: null,
      hasStaffAccess: false,
      hasAdminAccess: false,
    },
    status: 200,
  },
  {
    name: 'non-admin',
    session: {
      kind: 'authenticated',
      role: 'STUDENT',
      memberKind: 'STUDENT',
      hasStaffAccess: false,
      hasAdminAccess: false,
    },
    status: 200,
  },
  {
    name: 'resolved-admin',
    session: {
      kind: 'authenticated',
      role: 'ADMIN',
      memberKind: 'STUDENT',
      hasStaffAccess: false,
      hasAdminAccess: true,
    },
    status: 200,
  },
  {
    name: 'admin-access-false',
    session: {
      kind: 'authenticated',
      role: 'ADMIN',
      memberKind: null,
      hasStaffAccess: true,
      hasAdminAccess: false,
    },
    status: 200,
  },
];

export async function runForcedUiAbsenceMatrix(
  browser: Browser,
  baseURL: string,
): Promise<void> {
  const matrix: Record<string, unknown>[] = [];

  for (const scenario of absenceScenarios) {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    const fixture = await installLegacyMemberReclassificationFixture(page, {
      session: scenario.session,
    });
    const audit = installBrowserAudit(page);
    try {
      const held =
        scenario.name === 'loading' ? fixture.holdNextSession() : null;
      const sessionRequest = page.waitForRequest(
        (request) => new URL(request.url()).pathname === SESSION_PATH,
        { timeout: TASK_10_BROWSER_TIMEOUT },
      );
      const sessionResponse = armSessionResponse(
        page,
        fixture,
        scenario.status,
      );
      await page.goto('/dashboard');
      await sessionRequest;
      const forced = page.locator(
        '[data-slot="legacy-member-reclassification"]',
      );
      await expect(forced).toHaveCount(0);
      held?.release();
      expect((await sessionResponse).status()).toBe(scenario.status);
      await expect(forced).toHaveCount(0);
      const allowed = scenario.status >= 400 ? [scenario.status] : [];
      audit.assertClean(allowed);
      matrix.push({
        state: scenario.name,
        sessionStatus: scenario.status,
        forcedUiRendered: false,
        observedWhileSessionPending: scenario.name === 'loading',
        browserAudit: audit.receipt(allowed),
      });
    } finally {
      await context.close();
    }
  }

  expect(matrix).toHaveLength(7);
  recordLegacyReclassificationScenario({
    scenario: 'forced-ui-absence-matrix',
    cases: matrix,
  });
}
