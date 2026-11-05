import { PrismaService } from '../platform/prisma.service';
import { PlatformRepository } from '../platform/platform.repository';
import { ProgramHistoryRepository } from './programs.repository';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';
import { PrismaSerializationRetryRepository } from '../platform/prisma-serialization-retry.repository';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { ProgramLifecycleRepository } from './programs.repository';
import { ProgramLifecycleService } from './programs.service';
import { ProgramDeletionScopeRepository } from './programs.repository';
import { ProgramListStatusFilterRepository } from './program-list-status-filter.repository';
import { ProgramsRepository } from './programs.repository';
import { canonicalUserCreateFromLabel } from '../users/canonical-user-fixture';
import { ProgramCreationService } from './program-creation.service';
import { ProgramScheduleService } from './program-schedule.service';
import { ProgramTemplatesService } from './team-application.service';
import { ApplicationsRepository } from './team.repository';
import { TeamHistoryRepository } from './team-history.repository';
import { RepositoryProvisionGenerationRepository } from '../platform/repository-provision-generation.repository';
import { DeadlineDigestRepository } from '../notifications/deadline-digest.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const prefix = 'test:program-status-delete:';
const githubId = 98760000001n;
const scopeRepository = new ProgramDeletionScopeRepository();
const repository = new ProgramLifecycleRepository(prisma, scopeRepository);
const metadata = new AuditLogMetadataService();
const service = new ProgramLifecycleService(
  repository,
  new ProgramHistoryRepository(),
  metadata,
  new PrismaSerializationRetryRepository(),
);
const programs = new ProgramsRepository(
  prisma,
  new PlatformRepository(),
  new ProgramListStatusFilterRepository(),
);
const now = new Date('2026-11-04T00:00:00Z');
const dashboard = new ApplicationsRepository(
  prisma,
  new TeamHistoryRepository(),
  new RepositoryProvisionGenerationRepository(),
  new PlatformRepository(),
);
const deadlineDigest = new DeadlineDigestRepository(prisma);
const deadlineWindow = {
  from: new Date('2026-11-19T00:00:00Z'),
  to: new Date('2026-11-21T00:00:00Z'),
};

beforeAll(async () => {
  await prisma.$connect();
  await prisma.user.upsert({
    where: { id: `${prefix}actor` },
    update: {},
    create: canonicalUserCreateFromLabel('STAFF', {
      id: `${prefix}actor`,
      githubId,
      nickname: 'synthetic-status-delete',
    }),
  });
});

afterEach(async () => {
  await prisma.milestoneDocument.deleteMany({
    where: { milestone: { program: { name: { startsWith: prefix } } } },
  });
  await prisma.milestone.deleteMany({
    where: { program: { name: { startsWith: prefix } } },
  });
  await prisma.program.deleteMany({ where: { name: { startsWith: prefix } } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

it.each(['delete', 'purge'] as const)(
  '%s retains the program and milestone while excluding every public and staff list filter',
  async (operation) => {
    const program = await prisma.program.create({
      data: {
        id: `${prefix}${operation}`,
        name: `${prefix}${operation}`,
        organizer: 'Synthetic center',
        category: 'BASIC',
        applicationTemplateKey: 'basic',
        applicationTemplateVersion: 1,
        applicationStartAt: new Date('2026-11-01T00:00:00Z'),
        applicationEndAt: new Date('2026-11-05T00:00:00Z'),
        startAt: new Date('2026-11-06T00:00:00Z'),
        endAt: new Date('2026-12-01T00:00:00Z'),
        description: 'Preservation fixture',
        notifyOnDeadline: true,
        milestones: {
          create: {
            id: `${prefix}milestone-${operation}`,
            name: 'Retained milestone',
            startAt: new Date('2026-11-06T00:00:00Z'),
            dueAt: new Date('2026-11-20T00:00:00Z'),
            documents: {
              create: {
                name: 'Retained document',
                required: true,
                sortOrder: 1,
              },
            },
          },
        },
      },
      include: { milestones: true },
    });
    expect(
      (await dashboard.listStaffDashboardSummary()).programs.map(
        (item) => item.id,
      ),
    ).toContain(program.id);
    await expect(
      deadlineDigest.findAutomaticProgramIds(deadlineWindow),
    ).resolves.toContain(program.id);

    if (operation === 'purge') {
      await service.purge(
        githubId,
        program.id,
        await repository.readScopeCounts(program.id),
      );
    } else {
      await service.delete(githubId, program.id);
    }

    await expect(
      prisma.program.findUnique({
        where: { id: program.id },
        include: { milestones: true },
      }),
    ).resolves.toMatchObject({
      id: program.id,
      lifecycle: 'DELETED',
      milestones: program.milestones,
    });
    for (const status of [
      'all',
      'current',
      'recruiting',
      'upcoming',
      'in_progress',
      'ended',
    ] as const) {
      const [rows, count] = await programs.listPrograms(
        { page: 1, pageSize: 10, search: prefix, status },
        now,
      );
      expect(rows).toEqual([]);
      expect(count).toBe(0);
    }
    await expect(programs.findProgramDetail(program.id)).resolves.toBeNull();
    expect(
      (await dashboard.listStaffDashboardSummary()).programs.map(
        (item) => item.id,
      ),
    ).not.toContain(program.id);
    await expect(
      deadlineDigest.findAutomaticProgramIds(deadlineWindow),
    ).resolves.not.toContain(program.id);
    await expect(
      deadlineDigest.findDeadlineProgram(program.id),
    ).resolves.toBeNull();
  },
);

it('legacy POST /programs records its known actor without an invented idempotency key', async () => {
  const creation = new ProgramCreationService(
    programs,
    new ProgramHistoryRepository(),
    metadata,
    new ProgramScheduleService(),
    new ProgramTemplatesService(),
  );
  const program = await creation.create(githubId, {
    name: `${prefix}legacy-create`,
    organizer: 'Synthetic center',
    trackType: 'EXTRACURRICULAR',
    applicationStartAt: '2026-11-01T00:00:00Z',
    applicationEndAt: '2026-11-05T00:00:00Z',
    startAt: '2026-11-06T00:00:00Z',
    endAt: '2026-12-01T00:00:00Z',
    description: 'Legacy creation fixture',
  });

  await expect(
    prisma.program.findUnique({
      where: { id: program.id },
      select: {
        createdBy: true,
        createdById: true,
        idempotencyKey: true,
        payloadHash: true,
      },
    }),
  ).resolves.toEqual({
    createdBy: 'USER',
    createdById: `${prefix}actor`,
    idempotencyKey: null,
    payloadHash: null,
  });
});
