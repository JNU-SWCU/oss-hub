import { FileMetadataRepository } from './files.repository';
import { UserProfileService } from '../users/user-profile.service';
import { ProgramScheduleService } from './program-schedule.service';
import { SubmissionWindowService } from './files.service';
import { SubmissionsRepository } from './submissions.repository';
import { PlatformRepository } from '../platform/platform.repository';
import { LockProgramTreeRepository } from '../platform/lock-program-tree.repository';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthService } from '../auth/auth.service';
import { AuthConfig } from '../platform/auth.config';
import { AuthSessionService } from '../platform/auth-session.service';
import { configureHttpApp } from '../configure-http-app';
import {
  GLOBAL_AUTHENTICATION_GUARD_PROVIDERS,
  databaseSessionPrincipal,
} from '../../test/global-authentication-guard.fixture';
import {
  RequirementCollectionResponseDto,
  RequirementDeliveryCollectionResponseDto,
} from './dto/requirement-collection-response.dto';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import {
  createDeadlineDigestIntegrationHarness,
  DIGEST_FIXTURE as fixture,
} from '../notifications/deadline-digest.integration-support';
import {
  RequirementCollectionReadRepository,
  RequirementsRepository,
} from './requirements.repository';
import { RequirementCollectionService } from './requirement-archive.service';
import { RequirementsController } from './requirements.controller';
import { RequirementsService } from './requirements.service';

const requirementCollectionService = new RequirementCollectionService(
  undefined as never,
);

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});
const harness = createDeadlineDigestIntegrationHarness();
const repository = new RequirementCollectionReadRepository(
  harness.prisma,
  new FileMetadataRepository(),
);
const service = new RequirementCollectionService(repository);
const legacyService = new RequirementsService(
  new RequirementsRepository(
    harness.prisma,
    new LockProgramTreeRepository(),
    new PlatformRepository(),
    new SubmissionsRepository(
      new PlatformRepository(),
      new FileMetadataRepository(),
    ),
    new RequirementCollectionReadRepository(
      harness.prisma,
      new FileMetadataRepository(),
    ),
    new FileMetadataRepository(),
  ),
  new SubmissionWindowService(new ProgramScheduleService()),
  new RequirementCollectionService({} as never),
  new ProgramScheduleService(),
  new SubmissionsRepository(
    new PlatformRepository(),
    new FileMetadataRepository(),
  ),
  new UserProfileService(),
);
const query = { filter: 'ALL', page: 1, pageSize: 20 } as const;
const late = new Date(fixture.dueSoon.getTime() + 1);
const first = new Date(fixture.dueSoon.getTime() - 1);
const extraSubmissionId = 'test:qa153:collection:new-submission';
const otherSubmissionId = 'test:qa153:collection:other-submission';
const otherSiblingSubmissionId =
  'test:qa153:collection:other-sibling-submission';
const extraDocumentId = 'test:qa153:collection:extra-document';
const missingDocumentId = 'test:qa153:collection:missing-document';
const authSessionService = new AuthSessionService();
const sessionSecret = new Uint8Array(32).fill(48);
let application: INestApplication;
let collectionUrl: string;

async function cleanExtraRows() {
  await harness.prisma.submissionHistory.deleteMany({
    where: { submissionId: fixture.documentSubmission },
  });
  await harness.prisma.submission.deleteMany({
    where: {
      id: {
        in: [extraSubmissionId, otherSubmissionId, otherSiblingSubmissionId],
      },
    },
  });
  await harness.prisma.requirement.deleteMany({
    where: { id: { in: [extraDocumentId, missingDocumentId] } },
  });
}
beforeAll(async () => {
  await harness.connect();
  const module = await Test.createTestingModule({
    controllers: [RequirementsController],
    providers: [
      AuthSessionService,
      ...GLOBAL_AUTHENTICATION_GUARD_PROVIDERS,
      { provide: RequirementCollectionService, useValue: service },
      { provide: AuthConfig, useValue: { sessionSecret } },
      {
        provide: AuthService,
        useValue: {
          getMe: (githubId: bigint) =>
            databaseSessionPrincipal(harness.prisma, githubId),
        },
      },
    ],
  })
    .useMocker((token) => (token === Function ? undefined : {}))
    .compile();
  application = module.createNestApplication();
  configureHttpApp(application);
  await application.listen(0, '127.0.0.1');
  collectionUrl = `${await application.getUrl()}/api/v1/milestones/${encodeURIComponent(fixture.notifyMilestone)}/documents/collection`;
});
beforeEach(async () => {
  await cleanExtraRows();
  await harness.reset();
  await harness.prisma.submission.update({
    where: { id: fixture.documentSubmission },
    data: { createdAt: first, submittedAt: first },
  });
});
afterAll(async () => {
  await application?.close();
  await cleanExtraRows();
  await harness.disconnect();
});

async function requestCollection(query: Record<string, string>) {
  const token = await authSessionService.issueSessionToken(
    sessionSecret,
    fixture.staffOnGithub,
    0,
  );
  const response = await fetch(
    `${collectionUrl}?${new URLSearchParams(query)}`,
    {
      headers: {
        cookie: `${authSessionService.sessionCookieName(false)}=${token}`,
      },
    },
  );
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  return (await response.json()) as RequirementDeliveryCollectionResponseDto;
}

it('preserves the existing collection response, approved population and paging contract', async () => {
  await harness.prisma.team.update({
    where: { id: fixture.offApplication },
    data: { status: 'REJECTED' },
  });

  const result = await requestCollection({ filter: 'ALL', pageSize: '2' });
  const old = await legacyService
    .collectForStaff(
      fixture.notifyMilestone,
      { ...query, pageSize: 2 },
      fixture.now,
    )
    .then((result) => RequirementCollectionResponseDto.from(result));
  const { deliveryCounts, rows, statusCounts, ...unchanged } = result;

  expect({
    ...unchanged,
    rows: rows.map(({ deliveryStatus, leaderName, ...row }) => {
      expect(deliveryStatus).toMatch(
        /^(MISSING|LATE|COMPLETE|NO_REQUIRED_ITEMS)$/u,
      );
      expect(leaderName).toEqual(expect.any(String));
      return row;
    }),
  }).toEqual(old);
  expect(statusCounts).toMatchObject({ NOT_SUBMITTED: 2, SUBMITTED: 1 });
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
  await harness.prisma.submission.update({
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
          {
            event: 'REJECTED',
            revision: 2,
            actorId: fixture.staffOn,
            createdAt: new Date(late.getTime() + 1),
          },
        ],
      },
    },
  });

  const result = await requestCollection({
    deliveryStatus: 'COMPLETE',
    status: 'REJECTED',
  });

  expect(result.total).toBe(1);
  expect(result.rows[0]).toMatchObject({
    deliveryStatus: 'COMPLETE',
    cells: [
      {
        submittedAt: late.toISOString(),
        revision: 2,
        status: 'REJECTED',
        review: { decision: 'REJECTED' },
      },
    ],
  });
  expect(result.deliveryCounts).toEqual({
    missing: 3,
    late: 0,
    complete: 1,
    noRequiredItems: 0,
  });
});

it('searches, filters and sorts whole teams before paging the staff request', async () => {
  const between = (offset: number) => new Date(first.getTime() + offset);
  await harness.prisma.submission.update({
    where: { id: fixture.documentSubmission },
    data: { createdAt: between(30), submittedAt: between(30) },
  });
  await harness.prisma.requirement.createMany({
    data: [extraDocumentId, missingDocumentId].map((id, index) => ({
      id,
      milestoneId: fixture.notifyMilestone,
      name: id,
      required: true,
      sortOrder: index + 2,
    })),
  });
  await harness.prisma.submission.create({
    data: {
      id: extraSubmissionId,
      requirementId: extraDocumentId,
      teamId: fixture.submittedApplication,
      submittedById: fixture.studentSubmitted,
      createdAt: between(10),
      submittedAt: between(10),
      revision: 3,
    },
  });
  await harness.prisma.team.update({
    where: { id: fixture.submittedApplication },
    data: { name: 'Boundary Alpha' },
  });
  await harness.prisma.team.update({
    where: { id: fixture.missingApplication },
    data: { name: 'Boundary Beta' },
  });
  await harness.prisma.submission.create({
    data: {
      id: otherSubmissionId,
      requirementId: extraDocumentId,
      teamId: fixture.missingApplication,
      submittedById: fixture.studentMissing,
      createdAt: between(25),
      submittedAt: between(25),
    },
  });
  await harness.prisma.submission.create({
    data: {
      id: otherSiblingSubmissionId,
      requirementId: fixture.notifyDocument,
      teamId: fixture.missingApplication,
      submittedById: fixture.studentMissing,
      createdAt: between(20),
      submittedAt: between(20),
    },
  });

  const search = {
    q: ' BOUNDARY ',
    status: 'SUBMITTED',
    sort: 'submittedAt',
    direction: 'desc',
    pageSize: '1',
  };
  const newer = await requestCollection({ ...search, page: '1' });
  const older = await requestCollection({ ...search, page: '2' });
  expect(newer).toMatchObject({
    page: 1,
    pageSize: 1,
    total: 2,
    statusCounts: { SUBMITTED: 4, NOT_SUBMITTED: 2 },
    rows: [
      {
        teamId: fixture.submittedApplication,
        sortDocumentId: fixture.notifyDocument,
        cells: [
          {
            documentId: fixture.notifyDocument,
            revision: 1,
            status: 'SUBMITTED',
          },
          { documentId: extraDocumentId, revision: 3, status: 'SUBMITTED' },
          { documentId: missingDocumentId, isSubmitted: false },
        ],
      },
    ],
  });
  expect(older).toMatchObject({
    page: 2,
    pageSize: 1,
    total: 2,
    rows: [
      { teamId: fixture.missingApplication, sortDocumentId: extraDocumentId },
    ],
  });
  expect(older.rows[0]?.cells).toHaveLength(3);
  const scoped = await requestCollection({
    ...search,
    documentId: extraDocumentId,
    submissionState: 'SUBMITTED',
  });
  expect(scoped.rows).toEqual(older.rows);
  expect(scoped.statusCounts).toEqual(newer.statusCounts);
  const ascending = await requestCollection({ ...search, direction: 'asc' });
  const ascendingSecond = await requestCollection({
    ...search,
    direction: 'asc',
    page: '2',
  });
  expect(ascending.total).toBe(2);
  expect(ascendingSecond.total).toBe(2);
  expect(ascending.rows).toEqual([
    { ...newer.rows[0], sortDocumentId: extraDocumentId },
  ]);
  expect(ascendingSecond.rows).toEqual([
    { ...older.rows[0], sortDocumentId: fixture.notifyDocument },
  ]);
});

it.each([
  ['exact deadline', fixture.dueSoon, 'COMPLETE'],
  ['after deadline', late, 'LATE'],
] as const)(
  'uses persisted header time without history: %s',
  async (_label, createdAt, deliveryStatus) => {
    await harness.prisma.submission.update({
      where: { id: fixture.documentSubmission },
      data: { createdAt, submittedAt: late },
    });

    const result = await service
      .collectForStaff(
        fixture.notifyMilestone,
        { ...query, deliveryStatus },
        fixture.now,
      )
      .then((result) => RequirementDeliveryCollectionResponseDto.from(result));

    expect(result.total).toBe(1);
    expect(result.rows[0]?.deliveryStatus).toBe(deliveryStatus);
  },
);

it('filters missing rows before pagination and keeps whole-population counts', async () => {
  const result = await service
    .collectForStaff(
      fixture.notifyMilestone,
      { ...query, deliveryStatus: 'MISSING', page: 2, pageSize: 1 },
      fixture.now,
    )
    .then((result) => RequirementDeliveryCollectionResponseDto.from(result));

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
  await harness.prisma.requirement.update({
    where: { id: fixture.notifyDocument },
    data: { required: false },
  });

  const result = await service
    .collectForStaff(
      fixture.notifyMilestone,
      { ...query, deliveryStatus: 'NO_REQUIRED_ITEMS' },
      fixture.now,
    )
    .then((result) => RequirementDeliveryCollectionResponseDto.from(result));

  expect(result.total).toBe(4);
  expect(result.rows).toHaveLength(4);
  expect(result.statusCounts).toMatchObject({ NOT_SUBMITTED: 3, SUBMITTED: 1 });
  const missingTeam = result.rows.find(
    (row) => row.teamId === fixture.missingApplication,
  );
  expect(missingTeam?.cells).toMatchObject([
    { documentId: fixture.notifyDocument, isSubmitted: false },
  ]);
  const legacy = await requestCollection({ filter: 'HAS_MISSING' });
  expect(legacy.total).toBe(0);
  expect(result.deliveryCounts).toEqual({
    missing: 0,
    late: 0,
    complete: 0,
    noRequiredItems: 4,
  });
});

it('holds counts and visible details at one snapshot while another connection submits', async () => {
  const before = await repository.withSnapshot(async (store) => {
    const documents = await store.findDocuments(fixture.notifyMilestone);
    const applications = await store.findApplications(fixture.notifyProgram);
    const documentIds = documents.map((document) => document.id);
    const teamIds = applications.map((application) => application.teamId);
    const submissions = await store.findCoordinates(documentIds, teamIds);
    await harness.prisma.submission.create({
      data: {
        id: extraSubmissionId,
        requirementId: fixture.notifyDocument,
        teamId: fixture.missingApplication,
        submittedById: fixture.studentMissing,
        createdAt: first,
        submittedAt: first,
      },
    });
    return {
      page: requirementCollectionService.buildRequirementDeliveryPage(
        { documents, applications, submissions, dueAt: fixture.dueSoon },
        query,
      ),
      details: await store.findDetails(documentIds, teamIds, fixture.now),
    };
  });
  const after = await service
    .collectForStaff(fixture.notifyMilestone, query, fixture.now)
    .then((result) => RequirementDeliveryCollectionResponseDto.from(result));

  expect(before.page.deliveryCounts.complete).toBe(1);
  expect(before.details).toHaveLength(1);
  expect(
    before.details.some(
      (detail) => detail.teamId === fixture.missingApplication,
    ),
  ).toBe(false);
  expect(after.deliveryCounts.complete).toBe(2);
  expect(after.rows.filter((row) => row.cells[0]?.isSubmitted)).toHaveLength(2);
});

it('selects a document before paging and hydrates the same submitted cell', async () => {
  const result = await service
    .collectForStaff(
      fixture.notifyMilestone,
      {
        ...query,
        pageSize: 1,
        document: { id: fixture.notifyDocument, submissionState: 'SUBMITTED' },
      },
      fixture.now,
    )
    .then((result) => RequirementDeliveryCollectionResponseDto.from(result));
  expect(result.total).toBe(1);
  expect(result.rows[0]?.cells[0]).toMatchObject({
    documentId: fixture.notifyDocument,
    isSubmitted: true,
  });
  expect(result.documentTotals).toEqual([
    { documentId: fixture.notifyDocument, submitted: 1, total: 4 },
  ]);
  const missing = await service
    .collectForStaff(
      fixture.notifyMilestone,
      {
        ...query,
        page: 2,
        pageSize: 1,
        document: { id: fixture.notifyDocument, submissionState: 'MISSING' },
      },
      fixture.now,
    )
    .then((result) => RequirementDeliveryCollectionResponseDto.from(result));
  expect(missing.total).toBe(3);
  expect(missing.rows).toHaveLength(1);
  expect(missing.rows[0]?.cells[0]).toMatchObject({
    documentId: fixture.notifyDocument,
    isSubmitted: false,
  });
  expect(missing.documentTotals).toEqual(result.documentTotals);
});

it('rejects a document outside the milestone instead of reporting every team missing', async () => {
  await expect(
    service.collectForStaff(
      fixture.notifyMilestone,
      {
        ...query,
        document: {
          id: 'test:other-milestone-document',
          submissionState: 'MISSING',
        },
      },
      fixture.now,
    ),
  ).rejects.toMatchObject({ errorCode: { code: 'MSD_004' } });
});
