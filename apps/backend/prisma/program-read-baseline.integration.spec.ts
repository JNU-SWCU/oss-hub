import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaClient, type Prisma } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../test/integration-database.guard';
import { PlatformRepository } from '../src/platform/platform.repository';
import { ProgramOverviewRepository } from '../src/programs/program-overview.repository';
import { SubmissionMatrixRepository } from '../src/programs/submission-matrix.repository';
import { MilestoneDocumentCollectionReadRepository } from '../src/programs/milestone-document-collection-read.repository';
import { ProgramTeamsRepository } from '../src/programs/program-teams.repository';
import { TeamHistoryRepository } from '../src/programs/team-history.repository';
import { ProgramTeamRepositoryEvidenceRepository } from '../src/programs/program-team-repository-evidence.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

class MeasuredPrisma extends PrismaClient<Prisma.PrismaClientOptions, 'query'> {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

class UnseededProgramBaselineError extends Error {
  constructor() {
    super(
      'PROGRAM_READ_BASELINE_UNSEEDED: expected complete program baseline fixture',
    );
    this.name = 'UnseededProgramBaselineError';
  }
}

const prisma = new MeasuredPrisma({
  log: [{ emit: 'event', level: 'query' }],
});
let queryCount = 0;
let queryBarrier: (() => void) | undefined;
prisma.$on('query', (event) => {
  if (event.query === 'SELECT 1 AS "program_baseline_query_barrier"') {
    queryBarrier?.();
  } else {
    queryCount += 1;
  }
});

async function flushQueries(): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const signal = new Promise<void>((resolveSignal, reject) => {
    queryBarrier = resolveSignal;
    timer = setTimeout(
      () => reject(new Error('Prisma query event barrier timed out')),
      10_000,
    );
  });
  try {
    await Promise.all([
      signal,
      prisma.$queryRaw`SELECT 1 AS "program_baseline_query_barrier"`,
    ]);
  } finally {
    clearTimeout(timer);
    queryBarrier = undefined;
  }
}
const prefix = 'program-read-baseline:';
const id = (suffix: string) => `${prefix}${suffix}`;
const programId = id('program');
const now = new Date('2026-06-15T12:00:00.000Z');
const startAt = new Date('2026-01-01T00:00:00.000Z');
const endAt = new Date('2026-12-31T00:00:00.000Z');
const directory = resolve(
  __dirname,
  '../../../.omo/evidence/program-table-simplification',
);
const artifact = resolve(directory, 'program-read-baseline.json');
const seedSize = {
  programs: 1,
  users: 20,
  teams: 10,
  members: 20,
  applications: 10,
  milestones: 2,
  documents: 4,
  submissions: 40,
  histories: 80,
  files: 40,
  reviews: 0,
  repositories: 10,
  provisionJobs: 10,
  outboxEvents: 10,
  auditLogs: 10,
  contributions: 10,
} as const;

async function seed(): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      await tx.user.createMany({
        data: Array.from({ length: seedSize.users }, (_, index) => ({
          id: id(`user-${index}`),
          githubId: 9_700_000_000_000_000n + BigInt(index),
          nickname: `baseline-${index}`,
          name: `Baseline ${index}`,
          type: 'STUDENT',
          department: 'Baseline department',
          departmentType: 'DEPARTMENT',
          profileCreatedAt: now,
          profileUpdatedAt: now,
        })),
      });
      await tx.program.create({
        data: {
          id: programId,
          name: 'Program read baseline',
          organizer: 'Synthetic integration fixture',
          category: 'BASIC',
          applicationTemplateKey: 'baseline',
          applicationTemplateVersion: 1,
          applicationStartAt: startAt,
          applicationEndAt: now,
          startAt,
          endAt,
          teamMaxSize: 2,
          description:
            'Read-only measurements over deterministic synthetic data',
        },
      });
      for (let milestone = 0; milestone < seedSize.milestones; milestone += 1) {
        await tx.milestone.create({
          data: {
            id: id(`milestone-${milestone}`),
            programId,
            name: `Milestone ${milestone}`,
            startAt,
            dueAt: endAt,
          },
        });
        await tx.milestoneDocument.createMany({
          data: [0, 1].map((document) => ({
            id: id(`document-${milestone}-${document}`),
            milestoneId: id(`milestone-${milestone}`),
            name: `Document ${document}`,
            required: true,
            sortOrder: document,
          })),
        });
      }
      for (let team = 0; team < seedSize.teams; team += 1) {
        const leaderId = id(`user-${team * 2}`);
        const teamId = id(`team-${team}`);
        const applicationId = id(`application-${team}`);
        const repositoryId = id(`repository-${team}`);
        await tx.team.create({
          data: {
            id: teamId,
            programId,
            name: `Team ${team}`,
            leaderId,
            members: {
              create: [0, 1].map((member) => ({
                userId: id(`user-${team * 2 + member}`),
                createdAt: now,
              })),
            },
          },
        });
        await tx.application.create({
          data: {
            id: applicationId,
            programId,
            teamId,
            applicantId: leaderId,
            answers: [],
            applicationTemplateVersion: 1,
            status: 'APPROVED',
            submittedAt: now,
          },
        });
        await tx.githubRepository.create({
          data: {
            id: repositoryId,
            githubRepositoryId: 9_700_000_000_000_000n + BigInt(team),
            nameWithOwner: `baseline/team-${team}`,
            source: 'ORG_PROVISIONED',
            applicationId,
            programId,
            teamId,
            contributions: {
              create: {
                githubId: 9_700_000_000_000_000n + BigInt(team * 2),
                date: now,
                commitCount: 3,
              },
            },
          },
        });
        await tx.repositoryProvisionJob.create({
          data: {
            id: id(`job-${team}`),
            applicationId,
            repositoryId,
            status: 'SUCCEEDED',
          },
        });
        await tx.outboxEvent.create({
          data: {
            id: id(`outbox-${team}`),
            type: 'REPOSITORY_PROVISION_REQUESTED',
            aggregateType: 'Application',
            aggregateId: applicationId,
            idempotencyKey: `repository-provision:${applicationId}`,
            payload: { applicationId },
            status: 'PROCESSED',
          },
        });
        await tx.auditLog.create({
          data: {
            id: id(`audit-${team}`),
            actorId: leaderId,
            action: 'APPLICATION_REPOSITORY_URL_CHANGED',
            targetType: 'APPLICATION',
            targetId: applicationId,
            metadata: { programId, teamId },
            occurredAt: now,
          },
        });
        for (let document = 0; document < seedSize.documents; document += 1) {
          const submissionId = id(`submission-${team}-${document}`);
          const historyId = id(`history-${team}-${document}`);
          await tx.milestoneDocumentSubmission.create({
            data: {
              id: submissionId,
              milestoneDocumentId: id(
                `document-${Math.floor(document / 2)}-${document % 2}`,
              ),
              applicationId,
              submittedById: leaderId,
              submittedAt: now,
              createdAt: now,
              histories: {
                create: {
                  id: historyId,
                  actorId: leaderId,
                  event: 'SUBMITTED',
                  revision: 1,
                  createdAt: now,
                },
              },
            },
          });
          await tx.submissionFile.create({
            data: {
              id: id(`file-${team}-${document}`),
              uploaderId: leaderId,
              applicationId,
              milestoneId: id(`milestone-${Math.floor(document / 2)}`),
              milestoneDocumentSubmissionId: submissionId,
              milestoneDocumentSubmissionHistoryId: historyId,
              storageKey: id(`storage-${team}-${document}`),
              originalFileName: 'baseline.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 1024,
              expiresAt: endAt,
            },
          });
          await tx.milestoneDocumentSubmissionHistory.create({
            data: {
              id: id(`review-${team}-${document}`),
              milestoneDocumentSubmissionId: submissionId,
              revision: 1,
              actorId: leaderId,
              event: 'APPROVED',
              createdAt: now,
            },
          });
        }
      }
    },
    { timeout: 60_000 },
  );
}

beforeAll(async () => {
  await rm(artifact, { force: true });
  await prisma.$connect();
  if (process.env.PROGRAM_READ_BASELINE_UNSEEDED !== '1') await seed();
}, 60_000);

afterAll(async () => {
  try {
    await prisma.$transaction(async (tx) => {
      const where = { id: { startsWith: prefix } };
      await tx.submissionFile.deleteMany({ where });
      await tx.milestoneDocumentReviewHistory.deleteMany({ where });
      await tx.milestoneDocumentSubmissionHistory.deleteMany({ where });
      await tx.milestoneDocumentSubmission.deleteMany({ where });
      await tx.repositoryProvisionJob.deleteMany({ where });
      await tx.githubRepository.deleteMany({ where });
      await tx.outboxEvent.deleteMany({ where });
      await tx.$executeRaw`ALTER TABLE "AuditLog" DISABLE TRIGGER audit_log_append_only`;
      await tx.auditLog.deleteMany({ where });
      await tx.$executeRaw`ALTER TABLE "AuditLog" ENABLE TRIGGER audit_log_append_only`;
      await tx.application.deleteMany({ where });
      await tx.teamMember.deleteMany({ where: { programId } });
      await tx.team.deleteMany({ where });
      await tx.milestoneDocument.deleteMany({ where });
      await tx.milestone.deleteMany({ where });
      await tx.program.deleteMany({ where });
      await tx.user.deleteMany({ where });
    });
  } finally {
    await prisma.$disconnect();
  }
});

it('records four real repository read paths with twenty warm samples and SQL counts', async () => {
  const actualSeedSize = {
    programs: await prisma.program.count({ where: { id: programId } }),
    users: await prisma.user.count({ where: { id: { startsWith: prefix } } }),
    teams: await prisma.team.count({ where: { programId } }),
    members: await prisma.teamMember.count({ where: { programId } }),
    applications: await prisma.application.count({ where: { programId } }),
    milestones: await prisma.milestone.count({ where: { programId } }),
    documents: await prisma.milestoneDocument.count({
      where: { id: { startsWith: prefix } },
    }),
    submissions: await prisma.milestoneDocumentSubmission.count({
      where: { id: { startsWith: prefix } },
    }),
    histories: await prisma.milestoneDocumentSubmissionHistory.count({
      where: { id: { startsWith: prefix } },
    }),
    files: await prisma.submissionFile.count({
      where: { id: { startsWith: prefix } },
    }),
    reviews: await prisma.milestoneDocumentReviewHistory.count({
      where: { id: { startsWith: prefix } },
    }),
    repositories: await prisma.githubRepository.count({ where: { programId } }),
    provisionJobs: await prisma.repositoryProvisionJob.count({
      where: { id: { startsWith: prefix } },
    }),
    outboxEvents: await prisma.outboxEvent.count({
      where: { id: { startsWith: prefix } },
    }),
    auditLogs: await prisma.auditLog.count({
      where: { id: { startsWith: prefix } },
    }),
    contributions: await prisma.contribution.count({
      where: { repositoryId: { startsWith: prefix } },
    }),
  };
  if (
    Object.entries(seedSize).some(
      ([key, value]) => Reflect.get(actualSeedSize, key) !== value,
    )
  ) {
    throw new UnseededProgramBaselineError();
  }
  const platform = new PlatformRepository();
  const overview = new ProgramOverviewRepository(prisma, platform);
  const matrix = new SubmissionMatrixRepository(prisma, platform);
  const collection = new MilestoneDocumentCollectionReadRepository(prisma);
  const teams = new ProgramTeamsRepository(
    prisma,
    new ProgramTeamRepositoryEvidenceRepository(prisma),
    platform,
    new TeamHistoryRepository(),
  );
  const operations = [
    {
      name: 'program-overview',
      method: 'ProgramOverviewRepository.findByProgramId',
      run: async () => {
        const row = await overview.findByProgramId(programId);
        expect(row).toMatchObject({
          teamCount: 10,
          participantCount: 20,
          milestoneCount: 2,
          connectedRepositoryCount: 10,
        });
      },
    },
    {
      name: 'submission-matrix',
      method:
        'SubmissionMatrixRepository.findMilestones/findApprovedApplications/findCurrentSubmissions/findDocumentFirstSubmissions/findDocumentChangeRequests',
      run: async () => {
        const milestones = await matrix.findMilestones(programId);
        const page = await matrix.findApprovedApplications(
          programId,
          { q: '', applicationMode: null },
          0,
          20,
        );
        const applicationIds = page.items.map((row) => row.id);
        const documents = milestones.flatMap((row) => row.requiredDocumentIds);
        const legacy = await matrix.findCurrentSubmissions(applicationIds);
        const coordinates = await matrix.findDocumentFirstSubmissions(
          applicationIds,
          documents,
        );
        const changes = await matrix.findDocumentChangeRequests(applicationIds);
        expect([
          milestones.length,
          page.total,
          page.items.length,
          legacy.length,
          coordinates.length,
          changes.length,
        ]).toEqual([2, 10, 10, 0, 40, 0]);
      },
    },
    {
      name: 'document-collection',
      method:
        'MilestoneDocumentCollectionReadRepository.withSnapshot + findMilestone/findDocuments/findApplications/findCoordinates/findDetails',
      run: async () => {
        await collection.withSnapshot(async (store) => {
          const milestone = await store.findMilestone(id('milestone-0'));
          const documents = await store.findDocuments(id('milestone-0'));
          const applications = await store.findApplications(programId);
          const documentIds = documents.map((row) => row.id);
          const applicationIds = applications.map((row) => row.applicationId);
          const coordinates = await store.findCoordinates(
            documentIds,
            applicationIds,
          );
          const details = await store.findDetails(
            documentIds,
            applicationIds,
            now,
          );
          expect(milestone?.id).toBe(id('milestone-0'));
          expect([
            documents.length,
            applications.length,
            coordinates.length,
            details.length,
          ]).toEqual([2, 10, 20, 20]);
          expect(
            details.every(
              (row) =>
                row.file?.sizeBytes === 1024 &&
                row.review?.decision === 'APPROVED',
            ),
          ).toBe(true);
        });
      },
    },
    {
      name: 'staff-team-detail',
      method:
        'ProgramTeamsRepository.findStaffTeamDetail (including evidence queries)',
      run: async () => {
        const row = await teams.findStaffTeamDetail(programId, id('team-0'));
        expect(row?.members).toHaveLength(2);
        expect(row?.application?.id).toBe(id('application-0'));
        expect(row?.repositoryContributions?.members).toHaveLength(2);
        expect(row?.repositoryUrlHistory.rows).toHaveLength(1);
      },
    },
  ];
  const measurements = [];
  for (const operation of operations) {
    await operation.run();
    await flushQueries();
    const samples = [];
    for (let index = 0; index < 20; index += 1) {
      const before = queryCount;
      const startedAt = performance.now();
      await operation.run();
      const milliseconds = performance.now() - startedAt;
      await flushQueries();
      samples.push({ milliseconds, sqlCount: queryCount - before });
    }
    const sorted = samples
      .map((sample) => sample.milliseconds)
      .sort((a, b) => a - b);
    const lower = sorted[9];
    const upper = sorted[10];
    if (lower === undefined || upper === undefined)
      throw new Error('Missing read samples');
    const sqlCounts = [...new Set(samples.map((sample) => sample.sqlCount))];
    expect(sqlCounts).toHaveLength(1);
    expect(sqlCounts[0]).toBeGreaterThan(0);
    measurements.push({
      name: operation.name,
      method: operation.method,
      p50Ms: (lower + upper) / 2,
      sqlCount: sqlCounts[0],
      samples,
    });
  }
  const [database] = await prisma.$queryRaw<
    readonly { readonly version: string }[]
  >`SELECT version()`;
  const baseline = {
    schemaVersion: 1,
    surface:
      'real repositories; includes output assertions, transaction control SQL and team evidence SQL; not HTTP latency',
    clock: now.toISOString(),
    database: database?.version,
    seedSize: actualSeedSize,
    warmups: 1,
    sampleCount: 20,
    measurements,
  };
  await mkdir(directory, { recursive: true });
  await writeFile(artifact, `${JSON.stringify(baseline, null, 2)}\n`);
  console.info('PROGRAM_READ_BASELINE', JSON.stringify(baseline));
}, 60_000);
