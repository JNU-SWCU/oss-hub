import {
  ApplicationStatus,
  RepositoryConnectionMode,
  RepositoryInvitationStatus,
  RepositoryProvisionJobStatus,
  RepositorySource,
  RepositoryVisibility,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { RepositoryProvisionStateRepository } from './repository-provision-state.repository';
import { RepositoryProvisionLeaseLostError } from './repository-provision-state.helpers';
import { RepositoryProvisionFailure } from '../domain/repository-provision.failure';
import { REPOSITORY_PROVISION_EVENT_TYPE } from '../domain/repository-provision-event';

const NOW = new Date('2026-09-01T00:00:00.000Z');
const JOB_ID = 'job-1';
const WORKER_ID = 'worker-1';
const REQUEST_ID = 'event-1';
const REPOSITORY_ID = 'repository-1';

interface InvitationRow {
  readonly id: string;
  readonly githubLogin: string;
  readonly status: RepositoryInvitationStatus;
}

interface TeamMemberRow {
  readonly user: { readonly nickname: string };
}

interface MockDb {
  repositoryProvisionJob: {
    findFirst: jest.Mock<
      Promise<unknown>,
      [Prisma.RepositoryProvisionJobFindFirstArgs]
    >;
    count: jest.Mock<Promise<number>, [Prisma.RepositoryProvisionJobCountArgs]>;
    updateMany: jest.Mock<
      Promise<Prisma.BatchPayload>,
      [Prisma.RepositoryProvisionJobUpdateManyArgs]
    >;
  };
  outboxEvent: {
    findUnique: jest.Mock<
      Promise<{
        readonly id: string;
        readonly type: string;
        readonly aggregateType: string;
        readonly aggregateId: string;
        readonly payload: unknown;
      } | null>,
      [Prisma.OutboxEventFindUniqueArgs]
    >;
  };
  repositoryInvitation: {
    findMany: jest.Mock<
      Promise<readonly InvitationRow[]>,
      [Prisma.RepositoryInvitationFindManyArgs]
    >;
    createMany: jest.Mock<
      Promise<Prisma.BatchPayload>,
      [Prisma.RepositoryInvitationCreateManyArgs]
    >;
    updateMany: jest.Mock<
      Promise<Prisma.BatchPayload>,
      [Prisma.RepositoryInvitationUpdateManyArgs]
    >;
  };
  application: {
    findUnique: jest.Mock<
      Promise<{ readonly teamId: string | null } | null>,
      [Prisma.ApplicationFindUniqueArgs]
    >;
  };
  teamMember: {
    findMany: jest.Mock<
      Promise<readonly TeamMemberRow[]>,
      [Prisma.TeamMemberFindManyArgs]
    >;
  };
  githubRepository: {
    findUnique: jest.Mock<
      Promise<{
        readonly id: string;
        readonly applicationId: string | null;
      } | null>,
      [Prisma.GithubRepositoryFindUniqueArgs]
    >;
    findUniqueOrThrow: jest.Mock<
      Promise<{ readonly source: RepositorySource }>,
      [Prisma.GithubRepositoryFindUniqueOrThrowArgs]
    >;
    upsert: jest.Mock<Promise<unknown>, [Prisma.GithubRepositoryUpsertArgs]>;
  };
  repositoryIssuanceHistory: {
    createMany: jest.Mock<
      Promise<Prisma.BatchPayload>,
      [Prisma.RepositoryIssuanceHistoryCreateManyArgs]
    >;
  };
  $transaction: jest.Mock<Promise<unknown>, [(tx: MockDb) => unknown]>;
  $queryRaw: jest.Mock<
    Promise<
      readonly {
        readonly applicationId: string;
        readonly currentEventId: string | null;
        readonly repositoryId: string | null;
        readonly status: RepositoryProvisionJobStatus;
        readonly lockedBy: string | null;
      }[]
    >,
    [Prisma.Sql]
  >;
}

function createDb(): MockDb {
  const db: Partial<MockDb> = {
    repositoryProvisionJob: {
      findFirst: jest.fn<
        Promise<unknown>,
        [Prisma.RepositoryProvisionJobFindFirstArgs]
      >(),
      count: jest
        .fn<Promise<number>, [Prisma.RepositoryProvisionJobCountArgs]>()
        .mockResolvedValue(1),
      updateMany: jest
        .fn<
          Promise<Prisma.BatchPayload>,
          [Prisma.RepositoryProvisionJobUpdateManyArgs]
        >()
        .mockResolvedValue({ count: 1 }),
    },
    outboxEvent: {
      findUnique: jest
        .fn<
          Promise<{
            readonly id: string;
            readonly type: string;
            readonly aggregateType: string;
            readonly aggregateId: string;
            readonly payload: unknown;
          } | null>,
          [Prisma.OutboxEventFindUniqueArgs]
        >()
        .mockResolvedValue({
          id: REQUEST_ID,
          type: REPOSITORY_PROVISION_EVENT_TYPE,
          aggregateType: 'Application',
          aggregateId: 'application-1',
          payload: {
            applicationId: 'application-1',
            programId: 'program-1',
            teamId: null,
            requestedAt: NOW.toISOString(),
            collaboratorGithubLogins: ['synthetic-member'],
          },
        }),
    },
    repositoryInvitation: {
      findMany: jest
        .fn<
          Promise<readonly InvitationRow[]>,
          [Prisma.RepositoryInvitationFindManyArgs]
        >()
        .mockResolvedValue([]),
      createMany: jest
        .fn<
          Promise<Prisma.BatchPayload>,
          [Prisma.RepositoryInvitationCreateManyArgs]
        >()
        .mockResolvedValue({ count: 0 }),
      updateMany: jest
        .fn<
          Promise<Prisma.BatchPayload>,
          [Prisma.RepositoryInvitationUpdateManyArgs]
        >()
        .mockResolvedValue({ count: 1 }),
    },
    application: {
      findUnique: jest.fn<
        Promise<{ readonly teamId: string | null } | null>,
        [Prisma.ApplicationFindUniqueArgs]
      >(),
    },
    teamMember: {
      findMany: jest
        .fn<
          Promise<readonly TeamMemberRow[]>,
          [Prisma.TeamMemberFindManyArgs]
        >()
        .mockResolvedValue([]),
    },
    githubRepository: {
      findUnique: jest.fn<
        Promise<{
          readonly id: string;
          readonly applicationId: string | null;
        } | null>,
        [Prisma.GithubRepositoryFindUniqueArgs]
      >(),
      findUniqueOrThrow: jest
        .fn<
          Promise<{ readonly source: RepositorySource }>,
          [Prisma.GithubRepositoryFindUniqueOrThrowArgs]
        >()
        .mockResolvedValue({ source: RepositorySource.ORG_PROVISIONED }),
      upsert: jest.fn<Promise<unknown>, [Prisma.GithubRepositoryUpsertArgs]>(),
    },
    repositoryIssuanceHistory: {
      createMany: jest
        .fn<
          Promise<Prisma.BatchPayload>,
          [Prisma.RepositoryIssuanceHistoryCreateManyArgs]
        >()
        .mockResolvedValue({ count: 1 }),
    },
    $queryRaw: jest
      .fn<
        Promise<
          readonly {
            readonly applicationId: string;
            readonly currentEventId: string | null;
            readonly repositoryId: string | null;
            readonly status: RepositoryProvisionJobStatus;
            readonly lockedBy: string | null;
          }[]
        >,
        [Prisma.Sql]
      >()
      .mockResolvedValue([
        {
          applicationId: 'application-1',
          currentEventId: REQUEST_ID,
          repositoryId: REPOSITORY_ID,
          status: RepositoryProvisionJobStatus.PROCESSING,
          lockedBy: WORKER_ID,
        },
      ]),
  };
  db.$transaction = jest.fn((run: (tx: MockDb) => unknown) =>
    Promise.resolve(run(db as MockDb)),
  );
  return db as MockDb;
}

function repositoryFor(db: MockDb): RepositoryProvisionStateRepository {
  return new RepositoryProvisionStateRepository(db as unknown as PrismaService);
}

function jobRow(
  team: { readonly name: string; readonly nicknames: readonly string[] } | null,
  connectionMode: RepositoryConnectionMode = RepositoryConnectionMode.NEW,
  source: RepositorySource = RepositorySource.ORG_PROVISIONED,
) {
  return {
    currentEventId: REQUEST_ID,
    repositoryId: REPOSITORY_ID,
    application: {
      id: 'application-1',
      status: ApplicationStatus.APPROVED,
      programId: 'program-1',
      teamId: team === null ? null : 'team-1',
      applicant: { githubId: 42n, nickname: 'Applicant-Login' },
      program: { name: 'Synthetic', repositoryProvisioningEnabled: true },
      repositoryConnectionMode: connectionMode,
      repositoryUrl:
        connectionMode === RepositoryConnectionMode.OWN
          ? 'https://github.com/synthetic-owner/synthetic-repo'
          : null,
      team:
        team === null
          ? null
          : {
              name: team.name,
              members: team.nicknames.map((nickname) => ({
                user: { nickname },
              })),
            },
      repository: {
        id: REPOSITORY_ID,
        source,
        applicationId: 'application-1',
        githubRepositoryId: 7n,
        nameWithOwner: 'synthetic-org/synthetic-repo',
        visibility: RepositoryVisibility.PRIVATE,
      },
    },
  };
}

describe('RepositoryProvisionStateRepository.loadContext', () => {
  it('현재 TeamMember만으로 정규화된 login과 지문을 만든다', async () => {
    const db = createDb();
    db.repositoryProvisionJob.findFirst.mockResolvedValue(
      jobRow({
        name: 'synthetic-team',
        nicknames: ['  Zeta ', 'alpha', 'ALPHA'],
      }),
    );

    const context = await repositoryFor(db).loadContext(
      JOB_ID,
      WORKER_ID,
      REQUEST_ID,
    );

    expect(context.currentMemberGithubLogins).toEqual(['alpha', 'zeta']);
    expect(context.membershipFingerprint).toBe(
      JSON.stringify(['alpha', 'zeta']),
    );

    expect(context.currentMemberGithubLogins).not.toContain('applicant-login');
  });

  it('NEW인데 팀을 읽을 수 없으면 최종 실패로 막는다', async () => {
    const db = createDb();
    db.repositoryProvisionJob.findFirst.mockResolvedValue(jobRow(null));

    await expect(
      repositoryFor(db).loadContext(JOB_ID, WORKER_ID, REQUEST_ID),
    ).rejects.toMatchObject({
      name: 'RepositoryProvisionFailure',
      retryable: false,
      code: 'REPOSITORY_PROVISION_MEMBERSHIP_UNAVAILABLE',
    });
  });

  it('OWN은 팀이 없어도 신청자를 채우지 않고 빈 목록을 든다', async () => {
    const db = createDb();
    db.outboxEvent.findUnique.mockResolvedValue({
      id: REQUEST_ID,
      type: REPOSITORY_PROVISION_EVENT_TYPE,
      aggregateType: 'Application',
      aggregateId: 'application-1',
      payload: {
        applicationId: 'application-1',
        programId: 'program-1',
        teamId: null,
        requestedAt: NOW.toISOString(),
        collaboratorGithubLogins: ['synthetic-member'],
        repositoryConnectionMode: RepositoryConnectionMode.OWN,
        repositoryUrl: 'https://github.com/synthetic-owner/synthetic-repo',
      },
    });
    db.repositoryProvisionJob.findFirst.mockResolvedValue(
      jobRow(
        null,
        RepositoryConnectionMode.OWN,
        RepositorySource.EXTERNAL_PUBLIC,
      ),
    );

    const context = await repositoryFor(db).loadContext(
      JOB_ID,
      WORKER_ID,
      REQUEST_ID,
    );

    expect(context.currentMemberGithubLogins).toEqual([]);
    expect(context.membershipFingerprint).toBe('[]');
    expect(context.subjectName).toBe('Applicant-Login');
    expect(context.currentRepositorySource).toBe(
      RepositorySource.EXTERNAL_PUBLIC,
    );
  });

  it('원래 OWN이어도 현재 관리 저장소의 팀을 읽지 못하면 막는다', async () => {
    const db = createDb();
    db.repositoryProvisionJob.findFirst.mockResolvedValue(
      jobRow(
        null,
        RepositoryConnectionMode.OWN,
        RepositorySource.ORG_PROVISIONED,
      ),
    );
    await expect(
      repositoryFor(db).loadContext(JOB_ID, WORKER_ID, REQUEST_ID),
    ).rejects.toMatchObject({
      code: 'REPOSITORY_PROVISION_MEMBERSHIP_UNAVAILABLE',
      retryable: false,
    });
  });

  it('원래 NEW라도 현재 외부 저장소에는 팀 초대 원본을 요구하지 않는다', async () => {
    const db = createDb();
    db.repositoryProvisionJob.findFirst.mockResolvedValue(
      jobRow(
        null,
        RepositoryConnectionMode.NEW,
        RepositorySource.EXTERNAL_PUBLIC,
      ),
    );
    const context = await repositoryFor(db).loadContext(
      JOB_ID,
      WORKER_ID,
      REQUEST_ID,
    );
    expect(context.currentRepositorySource).toBe(
      RepositorySource.EXTERNAL_PUBLIC,
    );
    expect(context.currentMemberGithubLogins).toEqual([]);
  });

  it.each(['missing', 'different'] as const)(
    'job의 현재 저장소가 %s이면 이 세대의 결과로 보지 않는다',
    async (state) => {
      const db = createDb();
      const job = jobRow({ name: 'synthetic-team', nicknames: ['alpha'] });
      db.repositoryProvisionJob.findFirst.mockResolvedValue(
        state === 'missing'
          ? { ...job, application: { ...job.application, repository: null } }
          : { ...job, repositoryId: 'different-repository' },
      );

      const context = await repositoryFor(db).loadContext(
        JOB_ID,
        WORKER_ID,
        REQUEST_ID,
      );

      expect(context.repository).toBeNull();
    },
  );

  it('lease를 잃은 job은 context를 주지 않는다', async () => {
    const db = createDb();
    db.repositoryProvisionJob.findFirst.mockResolvedValue(null);

    await expect(
      repositoryFor(db).loadContext(JOB_ID, WORKER_ID, REQUEST_ID),
    ).rejects.toBeInstanceOf(RepositoryProvisionLeaseLostError);
  });
});

describe('RepositoryProvisionStateRepository.prepareInvitations', () => {
  it('탈퇴자는 회수 대기로, 재합류자는 부여 대기로 옮기고 이력은 남긴다', async () => {
    const db = createDb();
    db.repositoryInvitation.findMany.mockResolvedValue([
      {
        id: 'stay',
        githubLogin: 'stay',
        status: RepositoryInvitationStatus.SUCCEEDED,
      },
      {
        id: 'left',
        githubLogin: 'Left',
        status: RepositoryInvitationStatus.SUCCEEDED,
      },
      {
        id: 'rejoined',
        githubLogin: 'rejoined',
        status: RepositoryInvitationStatus.REVOKED,
      },
      {
        id: 'gone',
        githubLogin: 'gone',
        status: RepositoryInvitationStatus.REVOKED,
      },
      {
        id: 'grant-final',
        githubLogin: 'grant-final',
        status: RepositoryInvitationStatus.FAILED_FINAL,
      },
    ]);

    await repositoryFor(db).prepareInvitations(
      JOB_ID,
      WORKER_ID,
      REQUEST_ID,
      REPOSITORY_ID,
      ['stay', 'rejoined', 'grant-final', 'fresh'],
    );

    expect(db.repositoryInvitation.createMany).toHaveBeenCalledWith({
      data: [{ repositoryId: REPOSITORY_ID, githubLogin: 'fresh' }],
      skipDuplicates: true,
    });
    const [revokeCall, rejoinCall] =
      db.repositoryInvitation.updateMany.mock.calls;

    expect(revokeCall?.[0].where?.id).toEqual({ in: ['left'] });
    expect(revokeCall?.[0].data).toMatchObject({
      status: RepositoryInvitationStatus.REVOKE_REQUIRED,
      attemptCount: 0,
      reconciliationCount: 0,
      lastErrorCode: null,
      lastErrorMessage: null,
    });

    expect(rejoinCall?.[0].where?.id).toEqual({ in: ['rejoined'] });
    expect(rejoinCall?.[0].data).toMatchObject({
      status: RepositoryInvitationStatus.PENDING,
      attemptCount: 0,
      reconciliationCount: 0,
    });
  });

  it('회수 재시도 행은 매 사이클 재무장하지 않는다', async () => {
    const db = createDb();
    db.repositoryInvitation.findMany.mockResolvedValue([
      {
        id: 'retrying',
        githubLogin: 'retrying',
        status: RepositoryInvitationStatus.REVOKE_FAILED_RETRYABLE,
      },
      {
        id: 'final',
        githubLogin: 'final',
        status: RepositoryInvitationStatus.REVOKE_FAILED_FINAL,
      },
    ]);

    await repositoryFor(db).prepareInvitations(
      JOB_ID,
      WORKER_ID,
      REQUEST_ID,
      REPOSITORY_ID,
      ['stay'],
    );

    const [revokeCall] = db.repositoryInvitation.updateMany.mock.calls;
    expect(revokeCall?.[0].where?.id).toEqual({ in: [] });
  });
});

describe('RepositoryProvisionStateRepository.findInvitationWork', () => {
  it('회수를 먼저 돌려주고 최종 실패·예산 소진은 제외한다', async () => {
    const db = createDb();
    db.repositoryInvitation.findMany.mockResolvedValue([
      {
        id: 'grant-1',
        githubLogin: 'grant-1',
        status: RepositoryInvitationStatus.PENDING,
      },
      {
        id: 'revoke-1',
        githubLogin: 'revoke-1',
        status: RepositoryInvitationStatus.REVOKE_REQUIRED,
      },
      {
        id: 'grant-2',
        githubLogin: 'grant-2',
        status: RepositoryInvitationStatus.FAILED_RETRYABLE,
      },
      {
        id: 'revoke-2',
        githubLogin: 'revoke-2',
        status: RepositoryInvitationStatus.REVOKE_FAILED_RETRYABLE,
      },
      {
        id: 'revoked',
        githubLogin: 'revoked',
        status: RepositoryInvitationStatus.REVOKED,
      },
    ]);

    const work = await repositoryFor(db).findInvitationWork(
      JOB_ID,
      WORKER_ID,
      REQUEST_ID,
      REPOSITORY_ID,
    );

    expect(work.map((item) => [item.id, item.intent])).toEqual([
      ['revoke-1', 'REVOKE'],
      ['revoke-2', 'REVOKE'],

      ['revoked', 'REVOKE'],
      ['grant-1', 'GRANT'],
      ['grant-2', 'GRANT'],
    ]);
    expect(work[0]?.status).toBe(RepositoryInvitationStatus.REVOKE_REQUIRED);

    const statuses =
      db.repositoryInvitation.findMany.mock.calls[0]?.[0].where?.OR;
    expect(statuses).toEqual([
      {
        status: RepositoryInvitationStatus.PENDING,
        reconciliationCount: { lt: 96 },
      },
      { status: RepositoryInvitationStatus.FAILED_RETRYABLE },
      { status: RepositoryInvitationStatus.REVOKE_REQUIRED },
      { status: RepositoryInvitationStatus.REVOKE_FAILED_RETRYABLE },
      { status: RepositoryInvitationStatus.REVOKED },
    ]);
  });
});

describe('RepositoryProvisionStateRepository invitation CAS', () => {
  it('completeInvitation은 저장소·기대 상태가 모두 맞을 때만 쓴다', async () => {
    const db = createDb();

    await repositoryFor(db).completeInvitation({
      jobId: JOB_ID,
      workerId: WORKER_ID,
      requestId: REQUEST_ID,
      invitationId: 'invitation-1',
      repositoryId: REPOSITORY_ID,
      expectedStatus: RepositoryInvitationStatus.REVOKE_REQUIRED,
      status: RepositoryInvitationStatus.REVOKED,
      now: NOW,
    });

    expect(db.repositoryInvitation.updateMany.mock.calls[0]?.[0].where).toEqual(
      {
        id: 'invitation-1',
        repositoryId: REPOSITORY_ID,
        status: RepositoryInvitationStatus.REVOKE_REQUIRED,
      },
    );

    expect(db.repositoryInvitation.updateMany).toHaveBeenCalledTimes(1);
  });

  it('재확인한 REVOKED 는 같은 상태로 멱등하게 닫힌다', async () => {
    const db = createDb();

    await repositoryFor(db).completeInvitation({
      jobId: JOB_ID,
      workerId: WORKER_ID,
      requestId: REQUEST_ID,
      invitationId: 'invitation-1',
      repositoryId: REPOSITORY_ID,
      expectedStatus: RepositoryInvitationStatus.REVOKED,
      status: RepositoryInvitationStatus.REVOKED,
      now: NOW,
    });

    const call = db.repositoryInvitation.updateMany.mock.calls[0]?.[0];
    expect(call?.where?.status).toBe(RepositoryInvitationStatus.REVOKED);
    expect(call?.data.reconciliationCount).toBeUndefined();
    expect(db.repositoryInvitation.updateMany).toHaveBeenCalledTimes(1);
  });

  it('기대 상태가 어긋난 완료는 lease 상실로 되돌린다', async () => {
    const db = createDb();
    db.repositoryInvitation.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      repositoryFor(db).completeInvitation({
        jobId: JOB_ID,
        workerId: WORKER_ID,
        requestId: REQUEST_ID,
        invitationId: 'invitation-1',
        repositoryId: REPOSITORY_ID,
        expectedStatus: RepositoryInvitationStatus.PENDING,
        status: RepositoryInvitationStatus.SUCCEEDED,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(RepositoryProvisionLeaseLostError);
  });

  it('PENDING 완료만 확인 예산을 올리고 소진 시 종료한다', async () => {
    const db = createDb();

    await repositoryFor(db).completeInvitation({
      jobId: JOB_ID,
      workerId: WORKER_ID,
      requestId: REQUEST_ID,
      invitationId: 'invitation-1',
      repositoryId: REPOSITORY_ID,
      expectedStatus: RepositoryInvitationStatus.PENDING,
      status: RepositoryInvitationStatus.PENDING,
      now: NOW,
    });

    expect(
      db.repositoryInvitation.updateMany.mock.calls[0]?.[0].data
        .reconciliationCount,
    ).toEqual({ increment: 1 });
    expect(db.repositoryInvitation.updateMany.mock.calls[1]?.[0]).toMatchObject(
      {
        where: { reconciliationCount: { gte: 96 } },
        data: { status: RepositoryInvitationStatus.FAILED_FINAL },
      },
    );
  });

  it('회수 실패는 회수 축 상태로 적는다', async () => {
    const db = createDb();
    const repository = repositoryFor(db);

    await repository.failInvitation({
      jobId: JOB_ID,
      workerId: WORKER_ID,
      requestId: REQUEST_ID,
      invitationId: 'invitation-1',
      repositoryId: REPOSITORY_ID,
      expectedStatus: RepositoryInvitationStatus.REVOKE_REQUIRED,
      intent: 'REVOKE',
      final: false,
      errorCode: 'UPSTREAM',
      now: NOW,
    });
    await repository.failInvitation({
      jobId: JOB_ID,
      workerId: WORKER_ID,
      requestId: REQUEST_ID,
      invitationId: 'invitation-2',
      repositoryId: REPOSITORY_ID,
      expectedStatus: RepositoryInvitationStatus.REVOKE_FAILED_RETRYABLE,
      intent: 'REVOKE',
      final: true,
      errorCode: 'UPSTREAM',
      now: NOW,
    });
    await repository.failInvitation({
      jobId: JOB_ID,
      workerId: WORKER_ID,
      requestId: REQUEST_ID,
      invitationId: 'invitation-3',
      repositoryId: REPOSITORY_ID,
      expectedStatus: RepositoryInvitationStatus.PENDING,
      intent: 'GRANT',
      final: false,
      errorCode: 'UPSTREAM',
      now: NOW,
    });

    expect(
      db.repositoryInvitation.updateMany.mock.calls.map(
        (call) => call[0].data.status,
      ),
    ).toEqual([
      RepositoryInvitationStatus.REVOKE_FAILED_RETRYABLE,
      RepositoryInvitationStatus.REVOKE_FAILED_FINAL,
      RepositoryInvitationStatus.FAILED_RETRYABLE,
    ]);
  });
});

describe('RepositoryProvisionStateRepository.completeJob', () => {
  const members = (nicknames: readonly string[]): TeamMemberRow[] =>
    nicknames.map((nickname) => ({ user: { nickname } }));

  it('멤버십이 그대로면 SUCCEEDED로 닫고 다음 확인 시각을 남긴다', async () => {
    const db = createDb();
    db.application.findUnique.mockResolvedValue({ teamId: 'team-1' });
    db.teamMember.findMany.mockResolvedValue(members(['Alpha', 'zeta']));
    const nextAt = new Date(NOW.getTime() + 900_000);

    await repositoryFor(db).completeJob(
      JOB_ID,
      WORKER_ID,
      REQUEST_ID,
      REPOSITORY_ID,
      NOW,
      nextAt,
      JSON.stringify(['alpha', 'zeta']),
    );

    expect(
      db.repositoryProvisionJob.updateMany.mock.calls[0]?.[0].data,
    ).toEqual({
      repositoryId: REPOSITORY_ID,
      status: RepositoryProvisionJobStatus.SUCCEEDED,
      nextAttemptAt: nextAt,
      lockedAt: null,
      lockedBy: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      finishedAt: NOW,
    });
  });

  it('작업 중 멤버십이 바뀌었으면 닫지 않고 즉시 재무장한다', async () => {
    const db = createDb();
    db.application.findUnique.mockResolvedValue({ teamId: 'team-1' });
    db.teamMember.findMany.mockResolvedValue(members(['alpha']));

    await repositoryFor(db).completeJob(
      JOB_ID,
      WORKER_ID,
      REQUEST_ID,
      REPOSITORY_ID,
      NOW,
      new Date(NOW.getTime() + 900_000),
      JSON.stringify(['alpha', 'zeta']),
    );

    expect(
      db.repositoryProvisionJob.updateMany.mock.calls[0]?.[0].data,
    ).toEqual({
      repositoryId: REPOSITORY_ID,
      status: RepositoryProvisionJobStatus.PENDING,
      attemptCount: 0,
      nextAttemptAt: NOW,
      lockedAt: null,
      lockedBy: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      finishedAt: null,
    });
  });

  it('멤버십을 읽기 전에 job 행을 먼저 잠근다', async () => {
    const db = createDb();
    const order: string[] = [];
    db.$queryRaw.mockImplementation(() => {
      order.push('lock-job');
      return Promise.resolve([
        {
          applicationId: 'application-1',
          currentEventId: REQUEST_ID,
          repositoryId: REPOSITORY_ID,
          status: RepositoryProvisionJobStatus.PROCESSING,
          lockedBy: WORKER_ID,
        },
      ]);
    });
    db.application.findUnique.mockImplementation(() => {
      order.push('read-application');
      return Promise.resolve({ teamId: 'team-1' });
    });
    db.teamMember.findMany.mockImplementation(() => {
      order.push('read-members');
      return Promise.resolve([]);
    });

    await repositoryFor(db).completeJob(
      JOB_ID,
      WORKER_ID,
      REQUEST_ID,
      REPOSITORY_ID,
      NOW,
      undefined,
      '[]',
    );

    expect(order).toEqual(['lock-job', 'read-application', 'read-members']);
    expect(db.$queryRaw.mock.calls[0]?.[0].strings.join(' ')).toContain(
      'FOR UPDATE',
    );
  });

  it('지문이 없는 OWN 완료는 멤버십을 다시 읽지 않는다', async () => {
    const db = createDb();

    await repositoryFor(db).completeJob(
      JOB_ID,
      WORKER_ID,
      REQUEST_ID,
      REPOSITORY_ID,
      NOW,
    );

    expect(db.teamMember.findMany).not.toHaveBeenCalled();
    expect(
      db.repositoryProvisionJob.updateMany.mock.calls[0]?.[0].data,
    ).toMatchObject({
      status: RepositoryProvisionJobStatus.SUCCEEDED,
      nextAttemptAt: NOW,
    });
  });

  it('lease를 잃은 job은 완료하지 못한다', async () => {
    const db = createDb();
    db.$queryRaw.mockResolvedValue([]);

    await expect(
      repositoryFor(db).completeJob(
        JOB_ID,
        WORKER_ID,
        REQUEST_ID,
        REPOSITORY_ID,
        NOW,
      ),
    ).rejects.toBeInstanceOf(RepositoryProvisionLeaseLostError);
    expect(db.repositoryProvisionJob.updateMany).not.toHaveBeenCalled();
  });
});

describe('RepositoryProvisionStateRepository.failJob', () => {
  const failInput = {
    jobId: JOB_ID,
    workerId: WORKER_ID,
    requestId: REQUEST_ID,
    final: true,
    errorCode: 'REPOSITORY_PROVISION_INTERNAL',
    nextAttemptAt: NOW,
    now: NOW,
  };

  it('작업 중 멤버십이 바뀜다면 최종 실패로 닫지 않고 재무장한다', async () => {
    const db = createDb();
    db.application.findUnique.mockResolvedValue({ teamId: 'team-1' });
    db.teamMember.findMany.mockResolvedValue([{ user: { nickname: 'alpha' } }]);

    await repositoryFor(db).failJob({
      ...failInput,
      expectedMembershipFingerprint: JSON.stringify(['alpha', 'zeta']),
    });

    expect(
      db.repositoryProvisionJob.updateMany.mock.calls[0]?.[0].data,
    ).toEqual({
      status: RepositoryProvisionJobStatus.PENDING,
      attemptCount: 0,
      nextAttemptAt: NOW,
      lockedAt: null,
      lockedBy: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      finishedAt: null,
    });
  });

  it('멤버십이 그대로면 실패를 그대로 기록한다', async () => {
    const db = createDb();
    db.application.findUnique.mockResolvedValue({ teamId: 'team-1' });
    db.teamMember.findMany.mockResolvedValue([{ user: { nickname: 'alpha' } }]);

    await repositoryFor(db).failJob({
      ...failInput,
      expectedMembershipFingerprint: JSON.stringify(['alpha']),
    });

    expect(
      db.repositoryProvisionJob.updateMany.mock.calls[0]?.[0].data,
    ).toMatchObject({
      status: RepositoryProvisionJobStatus.FAILED_FINAL,
      lastErrorCode: 'REPOSITORY_PROVISION_INTERNAL',
      finishedAt: NOW,
    });
  });

  it('지문 없는 실패는 멤버십을 읽지 않고 job 행만 잠그고 기록한다', async () => {
    const db = createDb();

    await repositoryFor(db).failJob({ ...failInput, final: false });

    expect(db.teamMember.findMany).not.toHaveBeenCalled();
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(
      db.repositoryProvisionJob.updateMany.mock.calls[0]?.[0].data,
    ).toMatchObject({
      status: RepositoryProvisionJobStatus.FAILED_RETRYABLE,
      finishedAt: null,
    });
  });

  it('lease를 잃은 job은 실패도 기록하지 못한다', async () => {
    const db = createDb();
    db.$queryRaw.mockResolvedValue([]);

    await expect(repositoryFor(db).failJob(failInput)).rejects.toBeInstanceOf(
      RepositoryProvisionLeaseLostError,
    );
    expect(db.repositoryProvisionJob.updateMany).not.toHaveBeenCalled();
  });
});

it('loadContext 실패는 재시도하지 않는 provision 실패 타입이다', async () => {
  const db = createDb();
  db.repositoryProvisionJob.findFirst.mockResolvedValue(jobRow(null));

  await expect(
    repositoryFor(db).loadContext(JOB_ID, WORKER_ID, REQUEST_ID),
  ).rejects.toBeInstanceOf(RepositoryProvisionFailure);
});
