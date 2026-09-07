import { expect, type Page } from '@playwright/test';
import {
  parseDocuments,
  parseSnapshot,
} from './program-authoring-archive-contracts';
import { expectApiStatus } from './program-authoring-flow';
import { originHeaders } from './program-authoring-ui';

/** The existing authoring flow has two items in one stage and an empty informational stage. */
export async function archiveFixtureDocument(page: Page, milestoneId: string) {
  const response = await page.request.get(
    `/api/v1/milestones/${milestoneId}/documents`,
  );
  await expectApiStatus(response, 200);
  const documents = parseDocuments(await response.json());
  const existing =
    documents.find((document) => document.required) ?? documents[0];
  if (existing !== undefined) return existing;
  const snapshotResponse = await page.request.get(
    `/api/v1/milestones/${milestoneId}/edit`,
  );
  await expectApiStatus(snapshotResponse, 200);
  const snapshot = parseSnapshot(await snapshotResponse.json());
  expect(snapshot.documents).toHaveLength(0);
  const updated = await page.request.patch(
    `/api/v1/milestones/${milestoneId}`,
    {
      headers: originHeaders(),
      data: {
        ...snapshot.milestone,
        expectedFingerprint: snapshot.fingerprint,
        documents: [
          { id: null, name: 'e2e:archive:second-stage-item', required: false },
        ],
      },
    },
  );
  await expectApiStatus(updated, 200);
  const next = parseSnapshot(await updated.json());
  expect(next.documents).toHaveLength(1);
  const created = next.documents[0];
  if (created === undefined)
    throw new Error('Current milestone PATCH did not create the fixture item.');
  return created;
}
