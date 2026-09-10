import {
  ApplicationStatus,
  MemberKind,
  ProgramCategory,
  RepositoryConnectionMode,
  RepositoryProvisionJobStatus,
  RepositorySource,
  ProgramTrackType,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import { RepositoryProvisionJobRepository } from './repository/repository-provision-job.repository';
import { RepositoryProvisionLeaseLostError } from './repository-provision-state.helpers';

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
  'synthetic-job-renewed',
  'synthetic-job-recurring',
  'synthetic-job-own',
  'synthetic-job-unprovisioned',
  'synthetic-job-race',
] as const;

function repositoryIdFor(applicationId: string): string {
  return `${applicationId}-repository`;
}

describe('RepositoryProvisionJobRepository integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.create({
      data: {
        id: APPLICANT_ID,
        githubId: 8_200_000_000_001n,
        nickname: 'synthetic-provision-job-applicant',
        selectedMemberKind: MemberKind.STUDENT,
      },
    });
  });

  afterEach(async () => {
    await prisma.repositoryProvisionJob.deleteMany({
      where: { applicationId: { in: [...APPLICATION_IDS] } },
    });
    await prisma.githubRepository.deleteMany({
      where: { id: { in: APPLICATION_IDS.map(repositoryIdFor) } },
    });
    await prisma.application.deleteMany({
      where: { id: { in: [...APPLICATION_IDS] } },
    });
    await prisma.teamMember.deleteMany({
      where: { id: { in: APPLICATION_IDS.map((id) => `${id}-team-member`) } },
    });
    await prisma.team.deleteMany({
      where: { id: { in: APPLICATION_IDS.map(teamIdFor) } },
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
      { lockedAt: new Date(NOW.getTime() - 10 * 60_000) },
    );
    await createJob(
      APPLICATION_IDS[3],
      RepositoryProvisionJobStatus.PROCESSING,
      NOW,
      { lockedAt: new Date(NOW.getTime() - 60_000) },
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

  it('갱신한 lease는 보호하고 회수 뒤 이전 worker 갱신은 거절한다', async () => {
    // Given: worker-a가 job을 claim한 뒤 외부 호출 직전에 lease를 갱신한다.
    const applicationId = APPLICATION_IDS[4];
    await createJob(applicationId, RepositoryProvisionJobStatus.PENDING, NOW);
    const claim = await repository.claimNext({
      workerId: 'worker-a',
      now: NOW,
      leaseMs: LEASE_MS,
    });
    expect(claim).not.toBeNull();
    if (claim === null) {
      throw new Error('fixture job must be claimable');
    }
    const renewedAt = new Date(NOW.getTime() + 4 * 60_000);
    await repository.renewLease(claim.id, 'worker-a', renewedAt);

    // When: 최초 claim은 지났지만 갱신 lease가 유효한 시각에 다른 worker가 접근한다.
    const protectedClaim = await repository.claimNext({
      workerId: 'worker-b',
      now: new Date(NOW.getTime() + 6 * 60_000),
      leaseMs: LEASE_MS,
    });

    // Then: 갱신 lease를 보호하고, 실제 만료·회수 뒤에는 이전 worker를 fence한다.
    expect(protectedClaim).toBeNull();
    const reclaimed = await repository.claimNext({
      workerId: 'worker-b',
      now: new Date(NOW.getTime() + 10 * 60_000),
      leaseMs: LEASE_MS,
    });
    expect(reclaimed?.id).toBe(claim.id);
    await expect(
      repository.renewLease(
        claim.id,
        'worker-a',
        new Date(NOW.getTime() + 10 * 60_000),
      ),
    ).rejects.toBeInstanceOf(RepositoryProvisionLeaseLostError);
  });

  it('대기 초대가 없어도 관리형 NEW 완료 job을 재조회 시각에 다시 임대한다', async () => {
    // Given: 초대 행이 하나도 없는 성공 job의 재조회 시각이 도래했다.
    const applicationId = 'synthetic-job-recurring';
    await createJob(
      applicationId,
      RepositoryProvisionJobStatus.SUCCEEDED,
      NOW,
      {
        attachRepository: true,
      },
    );

    // When: 재조회 claim을 시도한다.
    const claim = await repository.claimNextReconciliation({
      workerId: 'worker-reconcile',
      now: NOW,
      leaseMs: LEASE_MS,
    });

    // Then: 팀원 변동을 볼 수 있도로 다시 임대하고 시도 횟수는 올리지 않는다.
    expect(claim?.applicationId).toBe(applicationId);
    await expect(
      prisma.repositoryProvisionJob.findUniqueOrThrow({
        where: { applicationId },
      }),
    ).resolves.toMatchObject({
      status: RepositoryProvisionJobStatus.PROCESSING,
      lockedBy: 'worker-reconcile',
      lockedAt: NOW,
      attemptCount: 0,
      finishedAt: null,
    });
  });

  it('OWN 연결·미프로비저닝 job은 재조회하지 않는다', async () => {
    // Given: OWN 연결 job과 저장소가 없는 완료 job만 남아 있다.
    await createJob(
      'synthetic-job-own',
      RepositoryProvisionJobStatus.SUCCEEDED,
      NOW,
      {
        attachRepository: true,
        connectionMode: RepositoryConnectionMode.OWN,
      },
    );
    await createJob(
      'synthetic-job-unprovisioned',
      RepositoryProvisionJobStatus.SUCCEEDED,
      NOW,
    );

    // When: 재조회 claim을 시도한다.
    const claim = await repository.claimNextReconciliation({
      workerId: 'worker-reconcile-skip',
      now: NOW,
      leaseMs: LEASE_MS,
    });

    // Then: 회수할 권한도 대상도 없는 job을 깨우지 않는다.
    expect(claim).toBeNull();
  });

  it('동시 재조회 claim에서도 한 worker만 임대한다', async () => {
    // Given: 재조회 대상 job 한 건이 있다.
    const applicationId = 'synthetic-job-race';
    await createJob(
      applicationId,
      RepositoryProvisionJobStatus.SUCCEEDED,
      NOW,
      {
        attachRepository: true,
      },
    );

    // When: 두 worker가 동시에 재조회 claim을 시도한다.
    const claims = await Promise.all([
      repository.claimNextReconciliation({
        workerId: 'worker-x',
        now: NOW,
        leaseMs: LEASE_MS,
      }),
      repository.claimNextReconciliation({
        workerId: 'worker-y',
        now: NOW,
        leaseMs: LEASE_MS,
      }),
    ]);

    // Then: 한 worker만 lease를 잡고, 잃은 worker의 갱신은 fence된다.
    const claimed = claims.filter((claim) => claim !== null);
    expect(claimed).toHaveLength(1);
    const job = await prisma.repositoryProvisionJob.findUniqueOrThrow({
      where: { applicationId },
    });
    const loser = job.lockedBy === 'worker-x' ? 'worker-y' : 'worker-x';
    await expect(
      repository.renewLease(job.id, loser, NOW),
    ).rejects.toBeInstanceOf(RepositoryProvisionLeaseLostError);
  });
});

function programId(applicationId: string): string {
  return `${applicationId}-program`;
}

function teamIdFor(applicationId: string): string {
  return `${applicationId}-team`;
}

interface CreateJobOptions {
  readonly lockedAt?: Date | null;
  readonly attachRepository?: boolean;
  readonly connectionMode?: RepositoryConnectionMode;
}

async function createJob(
  applicationId: string,
  status: RepositoryProvisionJobStatus,
  nextAttemptAt: Date,
  options: CreateJobOptions = {},
): Promise<void> {
  const lockedAt = options.lockedAt ?? null;
  const program = programId(applicationId);
  const teamId = teamIdFor(applicationId);
  await prisma.program.create({
    data: {
      id: program,
      name: `program-${applicationId}`,
      organizer: 'synthetic-organizer',
      trackType: ProgramTrackType.EXTRACURRICULAR,
      category: ProgramCategory.BASIC,
      applicationTemplateKey: 'synthetic-template',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2026-01-01T00:00:00.000Z'),
      applicationEndAt: new Date('2026-12-31T00:00:00.000Z'),
      description: 'synthetic-description',
      repositoryProvisioningEnabled: true,
    },
  });
  await prisma.team.create({
    data: {
      id: teamId,
      programId: program,
      name: `${applicationId}-team`,
      joinCodeDigest: `${applicationId}-team-digest`,
      leaderId: APPLICANT_ID,
    },
  });
  await prisma.teamMember.create({
    data: {
      id: `${applicationId}-team-member`,
      teamId,
      programId: program,
      userId: APPLICANT_ID,
    },
  });
  await prisma.application.create({
    data: {
      id: applicationId,
      programId: program,
      applicantId: APPLICANT_ID,
      teamId,
      answers: { synthetic: true },
      applicationTemplateVersion: 1,
      status: ApplicationStatus.APPROVED,
      repositoryConnectionMode:
        options.connectionMode ?? RepositoryConnectionMode.NEW,
      repositoryUrl:
        options.connectionMode === RepositoryConnectionMode.OWN
          ? 'https://github.com/synthetic-student/synthetic-own-repo'
          : null,
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
  if (options.attachRepository !== true) {
    return;
  }
  const repositoryId = repositoryIdFor(applicationId);
  await prisma.githubRepository.create({
    data: {
      id: repositoryId,
      githubRepositoryId: BigInt(
        8_300_000_000_000 +
          APPLICATION_IDS.findIndex((id) => id === applicationId),
      ),
      nameWithOwner: `synthetic-org/${applicationId}`,
      source: RepositorySource.ORG_PROVISIONED,
      applicationId,
      programId: program,
      teamId,
    },
  });
  await prisma.repositoryProvisionJob.update({
    where: { applicationId },
    data: { repositoryId },
  });
}
