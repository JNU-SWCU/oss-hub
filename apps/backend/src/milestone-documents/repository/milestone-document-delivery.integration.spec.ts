import { assertIsolatedIntegrationDatabase } from '../../../test/integration-database.guard';
import {
  createDeadlineDigestIntegrationHarness,
  DIGEST_FIXTURE as fixture,
} from '../../notifications/repository/deadline-digest.integration-support';
import { MilestoneDocumentCollectionReadRepository } from './milestone-document-collection-read.repository';
import { MilestoneDocumentCollectionService } from '../service/milestone-document-collection.service';
import { buildMilestoneDocumentDeliveryPage } from '../domain/milestone-document-delivery-page';
import { MilestoneDocumentsRepository } from './milestone-documents.repository';
import { MilestoneDocumentsService } from '../service/milestone-documents.service';
import { UsersAuthorityService } from '../../users/service/authority.service';
import { UsersAuthorityRepository } from '../../users/repository/authority.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});
const harness = createDeadlineDigestIntegrationHarness();
const repository = new MilestoneDocumentCollectionReadRepository(
  harness.prisma,
);
const authority = new UsersAuthorityService(
  new UsersAuthorityRepository(harness.prisma),
);
const service = new MilestoneDocumentCollectionService(repository, authority);
const legacyService = new MilestoneDocumentsService(
  new MilestoneDocumentsRepository(harness.prisma),
  authority,
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
  await harness.prisma.application.update({
    where: { id: fixture.offApplication },
    data: { status: 'REJECTED' },
  });

  const result = await service.collectForStaff(
    fixture.staffOnGithub,
    fixture.notifyMilestone,
    { ...query, pageSize: 2 },
    fixture.now,
  );
  const old = await legacyService.collectForStaff(
    fixture.staffOnGithub,
    fixture.notifyMilestone,
    { ...query, pageSize: 2 },
    fixture.now,
  );
  const { deliveryCounts, rows, ...unchanged } = result;

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

  const result = await service.collectForStaff(
    fixture.staffOnGithub,
    fixture.notifyMilestone,
    { ...query, deliveryStatus: 'COMPLETE' },
    fixture.now,
  );

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
    await harness.prisma.milestoneDocumentSubmission.update({
      where: { id: fixture.documentSubmission },
      data: { createdAt, submittedAt: late },
    });

    const result = await service.collectForStaff(
      fixture.staffOnGithub,
      fixture.notifyMilestone,
      { ...query, deliveryStatus },
      fixture.now,
    );

    expect(result.total).toBe(1);
    expect(result.rows[0]?.deliveryStatus).toBe(deliveryStatus);
  },
);

it('filters missing rows before pagination and keeps whole-population counts', async () => {
  const result = await service.collectForStaff(
    fixture.staffOnGithub,
    fixture.notifyMilestone,
    { ...query, deliveryStatus: 'MISSING', page: 2, pageSize: 1 },
    fixture.now,
  );

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
  await harness.prisma.milestoneDocument.update({
    where: { id: fixture.notifyDocument },
    data: { required: false },
  });

  const result = await service.collectForStaff(
    fixture.staffOnGithub,
    fixture.notifyMilestone,
    { ...query, deliveryStatus: 'NO_REQUIRED_ITEMS' },
    fixture.now,
  );

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
    fixture.staffOnGithub,
    fixture.notifyMilestone,
    query,
    fixture.now,
  );

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
