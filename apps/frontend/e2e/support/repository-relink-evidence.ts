import type { Locator, Page, TestInfo } from '@playwright/test';
import { expectApiStatus } from './program-authoring-flow';
import { PROGRAM_AUTHORING_CONTROL_PATH } from './program-authoring-ui';

export function applicationTeamId(value: unknown): string {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('teamId' in value) ||
    typeof value.teamId !== 'string' ||
    value.teamId.length === 0
  ) {
    throw new RelinkEvidenceError('Approved application must expose its team.');
  }
  return value.teamId;
}

export async function capture(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

export async function captureRegion(
  region: Locator,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  await region.scrollIntoViewIfNeeded();
  const path = testInfo.outputPath(`${name}.png`);
  await region.screenshot({ path });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

export class RelinkEvidenceError extends Error {
  override readonly name = 'RelinkEvidenceError';
}

type RepositoryFact = {
  readonly repositoryId: string;
  readonly githubId: string;
  readonly date: string;
  readonly commitCount: number;
  readonly pullRequestCount: number;
  readonly releaseCount: number;
};

export async function seedRepositoryEvidence(page: Page): Promise<{
  readonly currentRepositoryId: string;
  readonly facts: readonly RepositoryFact[];
}> {
  const response = await page.request.post(
    `${PROGRAM_AUTHORING_CONTROL_PATH}/repository-evidence`,
  );
  await expectApiStatus(response, 201);
  const value: unknown = await response.json();
  if (
    typeof value !== 'object' ||
    value === null ||
    !('currentRepositoryId' in value) ||
    typeof value.currentRepositoryId !== 'string' ||
    !('facts' in value) ||
    !Array.isArray(value.facts) ||
    !value.facts.every(repositoryFact)
  ) {
    throw new RelinkEvidenceError('Invalid synthetic repository evidence.');
  }
  return { currentRepositoryId: value.currentRepositoryId, facts: value.facts };
}

function repositoryFact(value: unknown): value is RepositoryFact {
  return (
    typeof value === 'object' &&
    value !== null &&
    'repositoryId' in value &&
    typeof value.repositoryId === 'string' &&
    'githubId' in value &&
    typeof value.githubId === 'string' &&
    'date' in value &&
    typeof value.date === 'string' &&
    'commitCount' in value &&
    typeof value.commitCount === 'number' &&
    'pullRequestCount' in value &&
    typeof value.pullRequestCount === 'number' &&
    'releaseCount' in value &&
    typeof value.releaseCount === 'number'
  );
}
