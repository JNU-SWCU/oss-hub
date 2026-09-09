import type { INestApplication } from '@nestjs/common';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import {
  createDeadlineDigestIntegrationHarness,
  DIGEST_FIXTURE as fixture,
} from '../notifications/deadline-digest.integration-support';
import { SubmissionMatrixRepository } from './submission-matrix.repository';
import { SubmissionMatrixService } from './submission-matrix.service';
import {
  createMatrixDeliveryHttp,
  matrixSessionHeaders,
} from './submission-matrix-delivery.http-fixture';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});
const harness = createDeadlineDigestIntegrationHarness();
const repository = new SubmissionMatrixRepository(harness.prisma);
const service = new SubmissionMatrixService(repository);
const first = new Date(fixture.dueSoon.getTime() - 1);
const late = new Date(fixture.dueSoon.getTime() + 1);
let application: INestApplication;
let baseUrl: string;

async function cleanHistories() {
  await harness.prisma.milestoneDocumentSubmissionHistory.deleteMany({
    where: { milestoneDocumentSubmissionId: fixture.documentSubmission },
  });
}
beforeAll(async () => {
  await harness.connect();
  application = await createMatrixDeliveryHttp(service);
  baseUrl = await application.getUrl();
});
beforeEach(async () => {
  await cleanHistories();
  await harness.reset();
  await harness.prisma.milestoneDocumentSubmission.update({
    where: { id: fixture.documentSubmission },
    data: { createdAt: first, submittedAt: late },
  });
});
afterAll(async () => {
  await cleanHistories();
  await application.close();
  await harness.disconnect();
});

async function requestMatrix(
  githubId: bigint = fixture.staffOnGithub,
  programId: string = fixture.notifyProgram,
) {
  return fetch(`${baseUrl}/api/v1/programs/${programId}/submissions/matrix`, {
    headers: await matrixSessionHeaders(githubId),
  });
}

it('exposes on-time delivery over the real route despite a late rejected revision', async () => {
  // Given
  await harness.prisma.milestoneDocumentSubmission.update({
    where: { id: fixture.documentSubmission },
    data: {
      createdAt: late,
      submittedAt: late,
      revision: 2,
      status: 'REJECTED',
      histories: {
        create: [
          {
            event: 'SUBMITTED',
            revision: 1,
            actorId: fixture.studentSubmitted,
            createdAt: first,
          },
          {
            event: 'SUBMITTED',
            revision: 2,
            actorId: fixture.studentSubmitted,
            createdAt: late,
          },
          {
            event: 'RESUBMITTED',
            revision: 2,
            actorId: fixture.studentSubmitted,
            createdAt: late,
          },
        ],
      },
    },
  });
  // When
  const response = await requestMatrix();
  // Then
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  const body: unknown = await response.json();
  expect(body).toMatchObject({ total: 4 });
  expect(body).toHaveProperty(
    'rows',
    expect.arrayContaining([
      expect.objectContaining({
        applicationId: fixture.submittedApplication,
        cells: [
          {
            milestoneId: fixture.notifyMilestone,
            deliveryStatus: 'COMPLETE',
            status: 'NOT_SUBMITTED',
            submissionId: null,
            revision: null,
            submittedAt: null,
            reviewUrl: null,
          },
        ],
      }),
      expect.objectContaining({
        applicationId: fixture.missingApplication,
        cells: [expect.objectContaining({ deliveryStatus: 'MISSING' })],
      }),
    ]),
  );
});

it.each([
  ['exact deadline', fixture.dueSoon, 'COMPLETE'],
  ['after deadline', late, 'LATE'],
] as const)(
  'uses persisted creation time when first history is absent: %s',
  async (_, createdAt, deliveryStatus) => {
    // Given
    await harness.prisma.milestoneDocumentSubmission.update({
      where: { id: fixture.documentSubmission },
      data: { createdAt },
    });
    // When
    const response = await requestMatrix();
    // Then
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toHaveProperty(
      'rows',
      expect.arrayContaining([
        expect.objectContaining({
          applicationId: fixture.submittedApplication,
          cells: [expect.objectContaining({ deliveryStatus })],
        }),
      ]),
    );
  },
);

it.each([
  ['optional', false, 'DOCUMENT'],
  ['internal legacy slot', true, 'LEGACY_MILESTONE_SUBMISSION'],
] as const)(
  'does not require an %s item for delivery completion',
  async (_, required, kind) => {
    // Given
    await harness.prisma.milestoneDocument.update({
      where: { id: fixture.notifyDocument },
      data: { required, kind },
    });
    // When
    const matrix = await service.matrix(
      fixture.staffOnGithub,
      fixture.notifyProgram,
      {
        q: '',
        applicationMode: null,
        page: 1,
        pageSize: 20,
      },
    );
    // Then
    expect(matrix.rows).toHaveLength(4);
    expect(
      matrix.rows.flatMap((row) =>
        row.cells.map((cell) => cell.deliveryStatus),
      ),
    ).toEqual(Array(4).fill('NO_REQUIRED_ITEMS'));
  },
);

it('does not mistake an unrelated history event or later revision for the first submission', async () => {
  // Given
  await harness.prisma.milestoneDocumentSubmission.update({
    where: { id: fixture.documentSubmission },
    data: {
      createdAt: late,
      histories: {
        create: [
          {
            event: 'SUBMITTED',
            revision: 2,
            actorId: fixture.studentSubmitted,
            createdAt: first,
          },
          {
            event: 'APPROVED',
            revision: 1,
            actorId: fixture.studentSubmitted,
            createdAt: first,
          },
        ],
      },
    },
  });
  // When
  const matrix = await service.matrix(
    fixture.staffOnGithub,
    fixture.notifyProgram,
    {
      q: '',
      applicationMode: null,
      page: 1,
      pageSize: 20,
    },
  );
  // Then
  expect(
    matrix.rows.find(
      (row) => row.applicationId === fixture.submittedApplication,
    )?.cells[0],
  ).toMatchObject({ deliveryStatus: 'LATE' });
});

it('excludes a rejected application and keeps the other program isolated', async () => {
  // Given
  await harness.prisma.application.update({
    where: { id: fixture.submittedApplication },
    data: { status: 'REJECTED' },
  });
  // When
  const matrix = await service.matrix(
    fixture.staffOnGithub,
    fixture.notifyProgram,
    {
      q: '',
      applicationMode: null,
      page: 1,
      pageSize: 20,
    },
  );
  // Then
  expect(matrix.total).toBe(3);
  expect(matrix.rows.map((row) => row.applicationId)).not.toContain(
    fixture.submittedApplication,
  );
  expect(matrix.milestones.map((milestone) => milestone.id)).toEqual([
    fixture.notifyMilestone,
  ]);
  expect(
    matrix.rows.flatMap((row) => row.cells.map((cell) => cell.deliveryStatus)),
  ).toEqual(Array(3).fill('MISSING'));
});

it('blocks a student through real session and database role checks', async () => {
  // Given / When
  const response = await requestMatrix(fixture.studentMissingGithub);
  // Then
  expect(response.status).toBe(403);
  await expect(response.json()).resolves.toMatchObject({ code: 'SUB_015' });
});
