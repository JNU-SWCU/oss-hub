import {
  ApplicationStatus,
  OutboxEventStatus,
  ProgramCategory,
  RepositoryConnectionMode,
  RepositoryProvisionJobStatus,
  RepositorySource,
  RepositoryVisibility,
  ProgramTrackType,
} from '@prisma/client';
import { MemberKind } from '../users/user-contract.config';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../platform/prisma.service';
import { RepositoryProvisionJobRepository } from './repository-provision-job.repository';
import { RepositoryProvisionLeaseLostError } from './repository-provision-state.error';
import { REPOSITORY_PROVISION_EVENT_TYPE } from './repository-provision-event.config';

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
  'synthetic-job-shared-a',
  'synthetic-job-shared-b',
  'synthetic-job-legacy-null-generation',
  'synthetic-job-org-on-own',
] as const;
const SHARED_REPOSITORY_ID = 'synthetic-job-shared-repository';

function repositoryIdFor(teamId: string): string {
  return `${teamId}-repository`;
}

function requestIdFor(teamId: string): string {
  return `${teamId}-provision-event`;
}

describe('RepositoryProvisionJobRepository integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.create({
      data: {
        id: APPLICANT_ID,
        githubId: 8200000000001n,
        nickname: 'synthetic-provision-job-applicant',
        type: MemberKind.STUDENT,
        approvalStatus: 'NOT_REQUIRED',
      },
    });
  });

  afterEach(async () => {
    await prisma.teamHistory.deleteMany({
      where: { teamId: { in: [...APPLICATION_IDS] } },
    });
    await prisma.repositoryProvisionJob.deleteMany({
      where: { teamId: { in: [...APPLICATION_IDS] } },
    });
    await prisma.repositoryInvitation.deleteMany({
      where: { repository: { teamId: { in: [...APPLICATION_IDS] } } },
    });
    await prisma.githubRepository.deleteMany({
      where: {
        OR: [
          {
            id: {
              in: [
                ...APPLICATION_IDS.map(repositoryIdFor),
                SHARED_REPOSITORY_ID,
              ],
            },
          },
          { teamId: { in: [...APPLICATION_IDS] } },
        ],
      },
    });
    await prisma.outboxEvent.deleteMany({
      where: { id: { in: APPLICATION_IDS.map(requestIdFor) } },
    });
    await prisma.teamMember.deleteMany({
      where: { teamId: { in: [...APPLICATION_IDS] } },
    });
    await prisma.team.deleteMany({
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
    const teamId = APPLICATION_IDS[0];
    await createJob(teamId, RepositoryProvisionJobStatus.PENDING, NOW);

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

    expect(claims.filter((claim) => claim !== null)).toHaveLength(1);
    await expect(
      prisma.repositoryProvisionJob.findUniqueOrThrow({
        where: { teamId },
      }),
    ).resolves.toMatchObject({
      status: RepositoryProvisionJobStatus.PROCESSING,
      attemptCount: 1,
      lockedAt: NOW,
      startedAt: NOW,
    });
  });

  it('같은 historical repositoryId를 두 application job이 보존할 수 있다', async () => {
    const firstApplicationId = APPLICATION_IDS[9];
    const secondApplicationId = APPLICATION_IDS[10];
    await createJob(
      firstApplicationId,
      RepositoryProvisionJobStatus.SUCCEEDED,
      NOW,
    );
    await createJob(
      secondApplicationId,
      RepositoryProvisionJobStatus.SUCCEEDED,
      NOW,
    );
    await prisma.githubRepository.create({
      data: {
        id: SHARED_REPOSITORY_ID,
        teamId: firstApplicationId,
        githubRepositoryId: 8200000099001n,
        nameWithOwner: 'synthetic-org/shared-history',
        source: RepositorySource.ORG_PROVISIONED,
        visibility: RepositoryVisibility.PRIVATE,
      },
    });

    await prisma.repositoryProvisionJob.update({
      where: { teamId: firstApplicationId },
      data: { repositoryId: SHARED_REPOSITORY_ID },
    });
    await prisma.repositoryProvisionJob.update({
      where: { teamId: secondApplicationId },
      data: { repositoryId: SHARED_REPOSITORY_ID },
    });

    await expect(
      prisma.repositoryProvisionJob.count({
        where: { repositoryId: SHARED_REPOSITORY_ID },
      }),
    ).resolves.toBe(2);
    await expect(
      prisma.githubRepository.findUniqueOrThrow({
        where: { id: SHARED_REPOSITORY_ID },
      }),
    ).resolves.toMatchObject({ teamId: firstApplicationId });
    await expect(
      prisma.repositoryProvisionJob.update({
        where: { teamId: secondApplicationId },
        data: { repositoryId: 'synthetic-missing-repository' },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      prisma.repositoryProvisionJob.count({
        where: { repositoryId: SHARED_REPOSITORY_ID },
      }),
    ).resolves.toBe(2);
  });

  it('reconciles a live ORG_PROVISIONED current link', async () => {
    const teamId = APPLICATION_IDS[0];
    await createJob(teamId, RepositoryProvisionJobStatus.SUCCEEDED, NOW);
    const current = await prisma.githubRepository.create({
      data: {
        teamId,
        githubRepositoryId: 8133900001n,
        nameWithOwner: 'synthetic/relinked',
        source: 'ORG_PROVISIONED',
        invitations: { create: { githubLogin: 'synthetic-invitee' } },
      },
    });
    await prisma.repositoryProvisionJob.update({
      where: { teamId },
      data: { repositoryId: current.id },
    });
    await expect(
      repository.claimNextReconciliation({
        workerId: 'synthetic-reconciliation-worker',
        now: NOW,
        leaseMs: LEASE_MS,
      }),
    ).resolves.toMatchObject({
      teamId,
      repositoryId: current.id,
    });
  });

  it('backoff 전 FAILED_RETRYABLE job은 claim하지 않는다', async () => {
    await createJob(
      APPLICATION_IDS[1],
      RepositoryProvisionJobStatus.FAILED_RETRYABLE,
      new Date(NOW.getTime() + 60_000),
    );

    const claim = await repository.claimNext({
      workerId: 'worker-c',
      now: NOW,
      leaseMs: LEASE_MS,
    });

    expect(claim).toBeNull();
  });

  it('세대를 증명할 수 없는 legacy job은 두 claim 경로 모두 fail closed 한다', async () => {
    const teamId = APPLICATION_IDS[11];
    await createJob(teamId, RepositoryProvisionJobStatus.PENDING, NOW);
    await prisma.repositoryProvisionJob.update({
      where: { teamId },
      data: { currentEventId: null },
    });

    await expect(
      repository.claimNext({
        workerId: 'worker-legacy',
        now: NOW,
        leaseMs: LEASE_MS,
      }),
    ).resolves.toBeNull();
    await prisma.repositoryProvisionJob.update({
      where: { teamId },
      data: {
        status: RepositoryProvisionJobStatus.SUCCEEDED,
        nextAttemptAt: NOW,
      },
    });
    await expect(
      repository.claimNextReconciliation({
        workerId: 'worker-legacy',
        now: NOW,
        leaseMs: LEASE_MS,
      }),
    ).resolves.toBeNull();
    await expect(
      prisma.repositoryProvisionJob.findUniqueOrThrow({
        where: { teamId },
      }),
    ).resolves.toMatchObject({
      currentEventId: null,
      status: RepositoryProvisionJobStatus.SUCCEEDED,
      attemptCount: 0,
      lockedAt: null,
      lockedBy: null,
    });
  });

  it('만료된 PROCESSING lease만 회수한다', async () => {
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

    const claim = await repository.claimNext({
      workerId: 'worker-d',
      now: NOW,
      leaseMs: LEASE_MS,
    });

    expect(claim?.teamId).toBe(APPLICATION_IDS[2]);
    await expect(
      prisma.repositoryProvisionJob.findUniqueOrThrow({
        where: { teamId: APPLICATION_IDS[3] },
      }),
    ).resolves.toMatchObject({ lockedBy: 'previous-worker' });
  });

  it('갱신한 lease는 보호하고 회수 뒤 이전 worker 갱신은 거절한다', async () => {
    const teamId = APPLICATION_IDS[4];
    await createJob(teamId, RepositoryProvisionJobStatus.PENDING, NOW);
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
    await repository.renewLease(
      claim.id,
      'worker-a',
      claim.requestId,
      renewedAt,
    );

    const protectedClaim = await repository.claimNext({
      workerId: 'worker-b',
      now: new Date(NOW.getTime() + 6 * 60_000),
      leaseMs: LEASE_MS,
    });

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
        claim.requestId,
        new Date(NOW.getTime() + 10 * 60_000),
      ),
    ).rejects.toBeInstanceOf(RepositoryProvisionLeaseLostError);
  });

  it('대기 초대가 없어도 관리형 NEW 완료 job을 재조회 시각에 다시 임대한다', async () => {
    const teamId = 'synthetic-job-recurring';
    await createJob(teamId, RepositoryProvisionJobStatus.SUCCEEDED, NOW, {
      attachRepository: true,
    });
    await prisma.repositoryProvisionJob.update({
      where: { teamId },
      data: { attemptCount: 5 },
    });

    const claim = await repository.claimNextReconciliation({
      workerId: 'worker-reconcile',
      now: NOW,
      leaseMs: LEASE_MS,
    });

    expect(claim?.teamId).toBe(teamId);
    expect(claim?.attemptCount).toBe(1);
    await expect(
      prisma.repositoryProvisionJob.findUniqueOrThrow({
        where: { teamId },
      }),
    ).resolves.toMatchObject({
      status: RepositoryProvisionJobStatus.PROCESSING,
      lockedBy: 'worker-reconcile',
      lockedAt: NOW,
      attemptCount: 1,
      finishedAt: null,
    });
  });

  it('EXTERNAL_PUBLIC 연결·미프로비저닝 job은 재조회하지 않는다', async () => {
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

    const claim = await repository.claimNextReconciliation({
      workerId: 'worker-reconcile-skip',
      now: NOW,
      leaseMs: LEASE_MS,
    });

    expect(claim).toBeNull();
  });

  it('reconciliation follows current ORG_PROVISIONED link even when application mode is still OWN', async () => {
    const teamId = 'synthetic-job-org-on-own';
    await createJob(teamId, RepositoryProvisionJobStatus.SUCCEEDED, NOW, {
      attachRepository: true,
      connectionMode: RepositoryConnectionMode.OWN,
      source: RepositorySource.ORG_PROVISIONED,
    });
    await expect(
      repository.claimNextReconciliation({
        workerId: 'worker-reconcile-source',
        now: NOW,
        leaseMs: LEASE_MS,
      }),
    ).resolves.toMatchObject({
      teamId,
      repositoryId: repositoryIdFor(teamId),
    });
  });

  it('동시 재조회 claim에서도 한 worker만 임대한다', async () => {
    const teamId = 'synthetic-job-race';
    await createJob(teamId, RepositoryProvisionJobStatus.SUCCEEDED, NOW, {
      attachRepository: true,
    });

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

    const claimed = claims.filter((claim) => claim !== null);
    expect(claimed).toHaveLength(1);
    const job = await prisma.repositoryProvisionJob.findUniqueOrThrow({
      where: { teamId },
    });
    const loser = job.lockedBy === 'worker-x' ? 'worker-y' : 'worker-x';
    await expect(
      repository.renewLease(job.id, loser, job.currentEventId!, NOW),
    ).rejects.toBeInstanceOf(RepositoryProvisionLeaseLostError);
  });
});

function programId(teamId: string): string {
  return `${teamId}-program`;
}

interface CreateJobOptions {
  readonly lockedAt?: Date | null;
  readonly attachRepository?: boolean;
  readonly connectionMode?: RepositoryConnectionMode;
  readonly source?: RepositorySource;
}

async function createJob(
  teamId: string,
  status: RepositoryProvisionJobStatus,
  nextAttemptAt: Date,
  options: CreateJobOptions = {},
): Promise<void> {
  const lockedAt = options.lockedAt ?? null;
  const program = programId(teamId);
  const requestId = requestIdFor(teamId);
  await prisma.program.create({
    data: {
      startAt: new Date('2026-01-01T00:00:00.000Z'),
      endAt: new Date(
        new Date('2026-12-31T00:00:00.000Z').getTime() + 365 * 86400000,
      ),
      id: program,
      name: `program-${teamId}`,
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
      name: `${teamId}-team`,
      leaderId: APPLICANT_ID,
      applicantId: APPLICANT_ID,
      answers: { title: `${teamId}-team` },
      applicationTemplateVersion: 1,
    },
  });
  await prisma.teamMember.create({
    data: {
      teamId,
      programId: program,
      userId: APPLICANT_ID,
    },
  });
  await prisma.outboxEvent.create({
    data: {
      id: requestId,
      type: REPOSITORY_PROVISION_EVENT_TYPE,
      aggregateType: 'Team',
      aggregateId: teamId,
      idempotencyKey: `repository-provision:${teamId}`,
      payload: {
        teamId,
        programId: program,
        requestedAt: NOW.toISOString(),
        collaboratorGithubLogins: ['synthetic-provision-job-applicant'],
        repositoryConnectionMode:
          options.connectionMode ?? RepositoryConnectionMode.NEW,
        repositoryUrl:
          options.connectionMode === RepositoryConnectionMode.OWN
            ? 'https://github.com/synthetic-student/synthetic-own-repo'
            : null,
      },
      status: OutboxEventStatus.PROCESSED,
      availableAt: NOW,
    },
  });
  await prisma.team.update({
    where: { id: teamId },
    data: {
      programId: program,
      applicantId: APPLICANT_ID,
      answers: { synthetic: true },
      applicationTemplateVersion: 1,
      status: ApplicationStatus.APPROVED,
      repositoryConnectionMode:
        options.connectionMode ?? RepositoryConnectionMode.NEW,
      provisionJob: {
        create: {
          currentEventId: requestId,
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
  const repositoryId = repositoryIdFor(teamId);
  await prisma.githubRepository.create({
    data: {
      id: repositoryId,
      githubRepositoryId: BigInt(
        8300000000000 + APPLICATION_IDS.findIndex((id) => id === teamId),
      ),
      nameWithOwner: `synthetic-org/${teamId}`,
      source:
        options.source ??
        (options.connectionMode === RepositoryConnectionMode.OWN
          ? RepositorySource.EXTERNAL_PUBLIC
          : RepositorySource.ORG_PROVISIONED),
      teamId,
    },
  });
  await prisma.repositoryProvisionJob.update({
    where: { teamId },
    data: { repositoryId },
  });
}
