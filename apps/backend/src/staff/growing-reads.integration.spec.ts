import {
  AccountStatus,
  ApplicationStatus,
  ProgramCategory,
  ProgramLifecycle,
  RepositorySource,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { SystemStatusRepository } from '../admin/system-status.repository';
import { SystemStatusService } from '../admin/system-status.service';
import { CollectionScheduleService } from '../github/collection-schedule.service';
import { READ_BATCH_SIZE } from '../platform/bounded-read.config';
import { PlatformRepository } from '../platform/platform.repository';
import { PrismaService } from '../platform/prisma.service';
import { StaffInsightsRepository } from './staff-insights.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const insights = new StaffInsightsRepository(prisma);
const systemStatus = new SystemStatusRepository(
  prisma,
  new PlatformRepository(),
);

const systemStatusService = new SystemStatusService(
  systemStatus,
  () => new Date(),
  new CollectionScheduleService(),
);

const COUNT = READ_BATCH_SIZE + 1;
const STALE_PAGE_LIMIT = 10;
const lastSuccessAt = (index: number) =>
  new Date(Date.UTC(1971, 0, 1) + index * 60_000);
let staleBeforeSeed = 0;
const PREFIX = 'growing-reads-it';
const APPLICANT_ID = `${PREFIX}-applicant`;
const FIRST_GITHUB_ID = 8_971_000_000_000n;
const FIRST_REPO_ID = 8_972_000_000_000n;
const indexes = Array.from({ length: COUNT }, (_, index) => index);
const programId = (index: number) =>
  `${PREFIX}-program-${String(index).padStart(4, '0')}`;
const teamId = (index: number) =>
  `${PREFIX}-team-${String(index).padStart(4, '0')}`;

async function purge(): Promise<void> {
  const repoIds = indexes.map((index) => FIRST_REPO_ID + BigInt(index));
  await prisma.teamRepo.deleteMany({ where: { repoId: { in: repoIds } } });
  await prisma.repo.deleteMany({ where: { githubRepoId: { in: repoIds } } });
  await prisma.team.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.program.deleteMany({ where: { id: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await purge();
  staleBeforeSeed = (await systemStatusService.getStatus()).staleRepositories
    .total;
  await prisma.user.createMany({
    data: [
      {
        id: APPLICANT_ID,
        githubId: FIRST_GITHUB_ID - 1n,
        nickname: `${PREFIX}-applicant`,
        accountStatus: AccountStatus.ACTIVE,
        type: 'STUDENT',
        approvalStatus: 'NOT_REQUIRED',
        profileCreatedAt: new Date('2117-01-01T00:00:00.000Z'),
        profileUpdatedAt: new Date('2117-01-01T00:00:00.000Z'),
        departmentType: 'DEPARTMENT' as const,
        name: '합성 신청자',
        studentId: '29709999',
        department: '합성 학과',
      },
      ...indexes.map((index) => ({
        id: `${PREFIX}-student-${index}`,
        githubId: FIRST_GITHUB_ID + BigInt(index),
        nickname: `${PREFIX}-student-${index}`,
        accountStatus: AccountStatus.ACTIVE,
        type: 'STUDENT' as const,
        approvalStatus: 'NOT_REQUIRED' as const,
        department: `${PREFIX} 학과 ${String(index).padStart(4, '0')}`,
        profileCreatedAt: new Date('2117-01-01T00:00:00.000Z'),
        profileUpdatedAt: new Date('2117-01-01T00:00:00.000Z'),
        departmentType: 'DEPARTMENT' as const,
        name: `합성 학생 ${index}`,
        studentId: `2971${String(index).padStart(4, '0')}`,
      })),
    ],
  });
  await prisma.program.createMany({
    data: indexes.map((index) => ({
      id: programId(index),
      name: programId(index),
      category: ProgramCategory.CAPSTONE,
      applicationTemplateKey: 'capstone-v1',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2117-01-01T00:00:00.000Z'),
      applicationEndAt: new Date('2117-02-01T00:00:00.000Z'),
      startAt: new Date('2117-03-01T00:00:00.000Z'),
      endAt: new Date('2117-06-30T00:00:00.000Z'),
      description: 'Synthetic growth fixture',
      lifecycle: ProgramLifecycle.PUBLISHED,
    })),
  });
  await prisma.team.createMany({
    data: indexes.map((index) => ({
      id: teamId(index),
      programId: programId(index),
      name: teamId(index),
      leaderId: APPLICANT_ID,
      applicantId: APPLICANT_ID,
      answers: {},
      applicationTemplateVersion: 1,
      status: ApplicationStatus.APPROVED,
    })),
  });
  await prisma.repo.createMany({
    data: indexes.map((index) => ({
      githubRepoId: FIRST_REPO_ID + BigInt(index),
      ownerName: `synthetic-org/${PREFIX}-${String(index).padStart(4, '0')}`,
      source: RepositorySource.ORG_PROVISIONED,
      lastSuccessAt: lastSuccessAt(index),
    })),
  });
  await prisma.teamRepo.createMany({
    data: indexes.map((index) => ({
      teamId: teamId(index),
      repoId: FIRST_REPO_ID + BigInt(index),
      validFrom: new Date('2117-03-01T00:00:00.000Z'),
    })),
  });
});

afterAll(async () => {
  await purge();
  await prisma.$disconnect();
});

it('reads every department past one batch instead of failing at a cap', async () => {
  const departments = (await insights.listDepartmentMetrics({})).flatMap(
    (row) => (row.department?.startsWith(PREFIX) ? [row.department] : []),
  );

  expect(departments).toHaveLength(COUNT);
  expect(new Set(departments).size).toBe(COUNT);
});

it('reads every published program and its application counts past one batch', async () => {
  const programs = (await insights.listPublishedPrograms()).filter((program) =>
    program.id.startsWith(PREFIX),
  );
  const counts = (await insights.listProgramApplicationCounts()).filter((row) =>
    row.programId.startsWith(PREFIX),
  );

  expect(programs).toHaveLength(COUNT);
  expect(counts).toHaveLength(COUNT);
  expect(counts.every((row) => row.appliedCount === 1)).toBe(true);
});

it('pages stale organization repositories on the system status page with the full total', async () => {
  const { staleRepositories, collection } = await systemStatusService.getStatus(
    { staleRepositoryPage: 1, staleRepositoryLimit: STALE_PAGE_LIMIT },
  );

  expect(staleRepositories.items).toEqual(
    indexes.slice(0, STALE_PAGE_LIMIT).map((index) => ({
      repositoryName: `synthetic-org/${PREFIX}-${String(index).padStart(4, '0')}`,
      programName: programId(index),
      lastSuccessAt: lastSuccessAt(index),
    })),
  );
  expect(staleRepositories.total).toBe(staleBeforeSeed + COUNT);
  expect(collection.staleRepositoryCount).toBe(staleRepositories.total);
});
