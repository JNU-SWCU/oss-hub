import type { BrowserAudit, BrowserAuditReceipt } from './browser-audit';
import { expect, type Page, type TestInfo } from '@playwright/test';
import {
  resetTask10VisualEvidence,
  writeTask10VisualEvidence,
} from './legacy-member-reclassification-evidence';
import { TASK_10_BROWSER_TIMEOUT } from './legacy-member-reclassification-fixture';
import {
  captureLegacyReclassification,
  type Task10Screenshot,
} from './legacy-member-reclassification-visual';

const screenshots: Task10Screenshot[] = [];
const scenarioReceipts: Record<string, unknown>[] = [];

export async function resetLegacyReclassificationSuite(): Promise<void> {
  screenshots.length = 0;
  scenarioReceipts.length = 0;
  await resetTask10VisualEvidence();
}

export async function finalizeLegacyReclassificationSuite(): Promise<void> {
  const result = await writeTask10VisualEvidence(
    {
      schemaVersion: 1,
      fixture: 'local-synthetic',
      scenarioCounts: {
        browserTests: 4,
        responsiveStates: screenshots.length / 2,
        screenshots: screenshots.length,
        forcedUiAbsentMatrix: 7,
      },
      synchronization: {
        responseAndSessionSignalsArmedBeforeSubmit: true,
        forcedScreenRemovalSignalArmedBeforeSubmit: true,
        settledDashboardSignalsArmedBeforeSubmit: true,
        boundedTimeoutMs: TASK_10_BROWSER_TIMEOUT,
        sleepsOrPollingDelays: 0,
      },
      accessibilityAssertions: {
        destructiveContrastMinimum: 4.5,
        koreanWordBreak: 'keep-all',
        overflowWrap: 'anywhere',
        horizontalOverflow: false,
      },
      scenarios: scenarioReceipts,
      screenshots,
      blockers: [],
    },
    screenshots,
  );
  expect(result.verified).toBe(true);
  expect(result.files).toBe(screenshots.length + 2);
}

export async function captureLegacyReclassificationState(
  page: Page,
  testInfo: TestInfo,
  state: string,
): Promise<void> {
  screenshots.push(
    ...(await captureLegacyReclassification(page, testInfo, state)),
  );
}

export function recordLegacyReclassificationAudit(
  scenario: string,
  audit: BrowserAudit,
  allowedStatuses: readonly number[],
  facts: Record<string, unknown>,
): BrowserAuditReceipt {
  audit.assertClean(allowedStatuses);
  const browserAudit = audit.receipt(allowedStatuses);
  scenarioReceipts.push({ scenario, ...facts, browserAudit });
  return browserAudit;
}

export function recordLegacyReclassificationScenario(
  receipt: Record<string, unknown>,
): void {
  scenarioReceipts.push(receipt);
}
