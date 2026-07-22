import {
  ApplicationStatus,
  ProgramCategory,
  RepositoryProvisionJobStatus,
  Role,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import { RepositoryProvisionJobRepository } from './repository-provision-job.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const repository = new RepositoryProvisionJobRepository(prisma);
const NOW = new Date('2026-07-22T00:00:00.000Z');
const LEASE_MS = 5 * 60_000;
const APPLICANT_ID = 'synthetic-provision-job-applicant';
const APPLICATION_IDS = [
  'synthetic-job-pending',
  'synthetic-job-future',
  'synthetic-job-stale',
  'synthetic-job-active',
] as const;

describe('RepositoryProvisionJobRepository integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.create({
      data: {
        id: APPLICANT_ID,
        githubId: 8_200_000_000_001n,
        login: 'synthetic-provision-job-applicant',
        role: Role.STUDENT,
      },
    });
  });

  afterEach(async () => {
    await prisma.repositoryProvisionJob.deleteMany({
      where: { applicationId: { in: [...APPLICATION_IDS] } },
    });
    await prisma.application.deleteMany({
      where: { id: { in: [...APPLICATION_IDS] } },
    });
    await prisma.program.deleteMany({
      where: { id: { in: APPLICATION_IDS.map(programId) } },
    });
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: APPLICANT_ID } });
    await prisma.$disconnect();
  });

  it('동시 claim에서도 PENDING job을 한 worker에게만 임대한다', async () => {
    // Given: 실행 가능한 job 한 건이 있다.
    const applicationId = APPLICATION_IDS[0];
    await createJob(applicationId, RepositoryProvisionJobStatus.PENDING, NOW);

    // When: 두 worker가 동시에 claim한다.
    const claims = await Promise.all([
      repository.claimNext({
        workerId: 'worker-a',
        now: NOW,
        leaseMs: LEASE_MS,
      }),
      repository.claimNext({
        workerId: 'worker-b',
        now: NOW,
        leaseMs: LEASE_MS,
      }),
    ]);

    // Then: 한 worker만 claim하고 시도 횟수와 lease가 원자적으로 저장된다.
    expect(claims.filter((claim) => claim !== null)).toHaveLength(1);
    await expect(
      prisma.repositoryProvisionJob.findUniqueOrThrow({
        where: { applicationId },
      }),
    ).resolves.toMatchObject({
      status: RepositoryProvisionJobStatus.PROCESSING,
      attemptCount: 1,
      lockedAt: NOW,
      startedAt: NOW,
    });
  });

  it('backoff 전 FAILED_RETRYABLE job은 claim하지 않는다', async () => {
    // Given: 다음 실행 시각이 아직 오지 않은 재시도 job이 있다.
    await createJob(
      APPLICATION_IDS[1],
      RepositoryProvisionJobStatus.FAILED_RETRYABLE,
      new Date(NOW.getTime() + 60_000),
    );

    // When: worker가 현재 시각에 claim한다.
    const claim = await repository.claimNext({
      workerId: 'worker-c',
      now: NOW,
      leaseMs: LEASE_MS,
    });

    // Then: backoff를 건너뛰지 않는다.
    expect(claim).toBeNull();
  });

  it('만료된 PROCESSING lease만 회수한다', async () => {
    // Given: 만료된 job과 아직 유효한 job이 있다.
    await createJob(
      APPLICATION_IDS[2],
      RepositoryProvisionJobStatus.PROCESSING,
      NOW,
      new Date(NOW.getTime() - 10 * 60_000),
    );
    await createJob(
      APPLICATION_IDS[3],
      RepositoryProvisionJobStatus.PROCESSING,
      NOW,
      new Date(NOW.getTime() - 60_000),
    );

    // When: 새 worker가 claim한다.
    const claim = await repository.claimNext({
      workerId: 'worker-d',
      now: NOW,
      leaseMs: LEASE_MS,
    });

    // Then: stale job만 새 worker에게 넘어간다.
    expect(claim?.applicationId).toBe(APPLICATION_IDS[2]);
    await expect(
      prisma.repositoryProvisionJob.findUniqueOrThrow({
        where: { applicationId: APPLICATION_IDS[3] },
      }),
    ).resolves.toMatchObject({ lockedBy: 'previous-worker' });
  });
});

function programId(applicationId: string): string {
  return `${applicationId}-program`;
}

async function createJob(
  applicationId: string,
  status: RepositoryProvisionJobStatus,
  nextAttemptAt: Date,
  lockedAt: Date | null = null,
): Promise<void> {
  await prisma.program.create({
    data: {
      id: programId(applicationId),
      name: `program-${applicationId}`,
      organizer: 'synthetic-organizer',
      category: ProgramCategory.BASIC,
      applicationTemplateKey: 'synthetic-template',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2026-01-01T00:00:00.000Z'),
      applicationEndAt: new Date('2026-12-31T00:00:00.000Z'),
      description: 'synthetic-description',
      repositoryProvisioningEnabled: true,
    },
  });
  await prisma.application.create({
    data: {
      id: applicationId,
      programId: programId(applicationId),
      applicantId: APPLICANT_ID,
      answers: { synthetic: true },
      applicationTemplateVersion: 1,
      status: ApplicationStatus.APPROVED,
      provisionJob: {
        create: {
          status,
          nextAttemptAt,
          lockedAt,
          lockedBy: lockedAt ? 'previous-worker' : null,
        },
      },
    },
  });
}
