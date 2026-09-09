import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import {
  createDeadlineDigestIntegrationHarness,
  DIGEST_FIXTURE as fixture,
} from '../notifications/deadline-digest.integration-support';
import { MilestoneDocumentCollectionReadRepository } from './milestone-document-collection-read.repository';
import { MilestoneDocumentCollectionService } from './milestone-document-collection.service';
import { buildMilestoneDocumentDeliveryPage } from './milestone-document-delivery-page';
import { MilestoneDocumentsRepository } from './milestone-documents.repository';
import { MilestoneDocumentsService } from './milestone-documents.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});
const harness = createDeadlineDigestIntegrationHarness();
const repository = new MilestoneDocumentCollectionReadRepository(
  harness.prisma,
);
const service = new MilestoneDocumentCollectionService(repository);
const legacyService = new MilestoneDocumentsService(
  new MilestoneDocumentsRepository(harness.prisma),
);
const query = { filter: 'ALL', page: 1, pageSize: 20 } as const;
const late = new Date(fixture.dueSoon.getTime() + 1);
const first = new Date(fixture.dueSoon.getTime() - 1);
const extraSubmissionId = 'test:qa153:collection:new-submission';

async function cleanExtraRows() {
  await harness.prisma.milestoneDocumentSubmissionHistory.deleteMany({
    where: { milestoneDocumentSubmissionId: fixture.documentSubmission },
  });
  await harness.prisma.milestoneDocumentSubmission.deleteMany({
    where: { id: extraSubmissionId },
  });
}
beforeAll(() => harness.connect());
beforeEach(async () => {
  await cleanExtraRows();
  await harness.reset();
  await harness.prisma.milestoneDocumentSubmission.update({
    where: { id: fixture.documentSubmission },
    data: { createdAt: first, submittedAt: first },
  });
});
afterAll(async () => {
  await cleanExtraRows();
  await harness.disconnect();
});

it('preserves the existing collection response, approved population and paging contract', async () => {
  // Given
  await harness.prisma.application.update({
    where: { id: fixture.offApplication },
    data: { status: 'REJECTED' },
  });
  // When
  const result = await service.collectForStaff(
    fixture.notifyMilestone,
    { ...query, pageSize: 2 },
    fixture.now,
  );
  const old = await legacyService.collectForStaff(
    fixture.notifyMilestone,
    { ...query, pageSize: 2 },
    fixture.now,
  );
  const { deliveryCounts, rows, ...unchanged } = result;
  // Then
  expect({
    ...unchanged,
    rows: rows.map(({ deliveryStatus, ...row }) => {
      expect(deliveryStatus).toMatch(
        /^(MISSING|LATE|COMPLETE|NO_REQUIRED_ITEMS)$/u,
      );
      return row;
    }),
  }).toEqual(old);
  expect(deliveryCounts).toEqual({
    missing: 2,
    late: 0,
    complete: 1,
    noRequiredItems: 0,
  });
  expect(result.total).toBe(3);
  expect(result.rows).toHaveLength(2);
});

it('keeps an on-time first submission complete after a late resubmission and rejection', async () => {
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
  const result = await service.collectForStaff(
    fixture.notifyMilestone,
    { ...query, deliveryStatus: 'COMPLETE' },
    fixture.now,
  );
  // Then
  expect(result.total).toBe(1);
  expect(result.rows[0]).toMatchObject({
    deliveryStatus: 'COMPLETE',
    cells: [
      { submittedAt: late.toISOString(), revision: 2, status: 'REJECTED' },
    ],
  });
  expect(result.deliveryCounts).toEqual({
    missing: 3,
    late: 0,
    complete: 1,
    noRequiredItems: 0,
  });
});

it.each([
  ['exact deadline', fixture.dueSoon, 'COMPLETE'],
  ['after deadline', late, 'LATE'],
] as const)(
  'uses persisted header time without history: %s',
  async (_label, createdAt, deliveryStatus) => {
    // Given
    await harness.prisma.milestoneDocumentSubmission.update({
      where: { id: fixture.documentSubmission },
      data: { createdAt, submittedAt: late },
    });
    // When
    const result = await service.collectForStaff(
      fixture.notifyMilestone,
      { ...query, deliveryStatus },
      fixture.now,
    );
    // Then
    expect(result.total).toBe(1);
    expect(result.rows[0]?.deliveryStatus).toBe(deliveryStatus);
  },
);

it('filters missing rows before pagination and keeps whole-population counts', async () => {
  // Given / When
  const result = await service.collectForStaff(
    fixture.notifyMilestone,
    { ...query, deliveryStatus: 'MISSING', page: 2, pageSize: 1 },
    fixture.now,
  );
  // Then
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]?.deliveryStatus).toBe('MISSING');
  expect(result.total).toBe(3);
  expect(result.deliveryCounts).toEqual({
    missing: 3,
    late: 0,
    complete: 1,
    noRequiredItems: 0,
  });
  expect(result.documentTotals).toEqual([
    { documentId: fixture.notifyDocument, submitted: 1, total: 4 },
  ]);
});

it('does not call optional-only milestones complete or missing', async () => {
  // Given
  await harness.prisma.milestoneDocument.update({
    where: { id: fixture.notifyDocument },
    data: { required: false },
  });
  // When
  const result = await service.collectForStaff(
    fixture.notifyMilestone,
    { ...query, deliveryStatus: 'NO_REQUIRED_ITEMS' },
    fixture.now,
  );
  // Then
  expect(result.total).toBe(4);
  expect(result.deliveryCounts).toEqual({
    missing: 0,
    late: 0,
    complete: 0,
    noRequiredItems: 4,
  });
  expect(result.filterCounts.hasMissing).toBe(0);
});

it('holds counts and visible details at one snapshot while another connection submits', async () => {
  // Given / When
  const before = await repository.withSnapshot(async (store) => {
    const documents = await store.findDocuments(fixture.notifyMilestone);
    const applications = await store.findApplications(fixture.notifyProgram);
    const documentIds = documents.map((document) => document.id);
    const applicationIds = applications.map(
      (application) => application.applicationId,
    );
    const submissions = await store.findCoordinates(
      documentIds,
      applicationIds,
    );
    await harness.prisma.milestoneDocumentSubmission.create({
      data: {
        id: extraSubmissionId,
        milestoneDocumentId: fixture.notifyDocument,
        applicationId: fixture.missingApplication,
        submittedById: fixture.studentMissing,
        createdAt: first,
        submittedAt: first,
      },
    });
    return {
      page: buildMilestoneDocumentDeliveryPage(
        { documents, applications, submissions, dueAt: fixture.dueSoon },
        query,
      ),
      details: await store.findDetails(
        documentIds,
        applicationIds,
        fixture.now,
      ),
    };
  });
  const after = await service.collectForStaff(
    fixture.notifyMilestone,
    query,
    fixture.now,
  );
  // Then
  expect(before.page.deliveryCounts.complete).toBe(1);
  expect(before.details).toHaveLength(1);
  expect(
    before.details.some(
      (detail) => detail.applicationId === fixture.missingApplication,
    ),
  ).toBe(false);
  expect(after.deliveryCounts.complete).toBe(2);
  expect(after.rows.filter((row) => row.cells[0]?.isSubmitted)).toHaveLength(2);
});
