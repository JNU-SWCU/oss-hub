import {
  ApplicationStatus,
  RepositoryConnectionMode,
  RepositoryInvitationStatus,
  RepositoryProvisionJobStatus,
  RepositoryVisibility,
} from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { RepositoryProvisionStateRepository } from './repository-provision-state.repository';
import { RepositoryProvisionLeaseLostError } from '../repository-provision-state.helpers';
import { RepositoryProvisionFailure } from '../repository-provision.failure';

const NOW = new Date('2026-09-01T00:00:00.000Z');
const JOB_ID = 'job-1';
const WORKER_ID = 'worker-1';
const REPOSITORY_ID = 'repository-1';

interface MockDb {
  repositoryProvisionJob: {
    findFirst: jest.Mock;
    count: jest.Mock;
    updateMany: jest.Mock;
  };
  outboxEvent: { findFirst: jest.Mock };
  repositoryInvitation: {
    findMany: jest.Mock;
    createMany: jest.Mock;
    updateMany: jest.Mock;
  };
  application: { findUnique: jest.Mock };
  teamMember: { findMany: jest.Mock };
  githubRepository: { findUnique: jest.Mock; upsert: jest.Mock };
  $transaction: jest.Mock;
  $queryRaw: jest.Mock;
}

function createDb(): MockDb {
  const db: Partial<MockDb> = {
    repositoryProvisionJob: {
      findFirst: jest.fn(),
      count: jest.fn().mockResolvedValue(1),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    outboxEvent: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 'event-1', payload: { synthetic: true } }),
    },
    repositoryInvitation: {
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    application: { findUnique: jest.fn() },
    teamMember: { findMany: jest.fn().mockResolvedValue([]) },
    githubRepository: { findUnique: jest.fn(), upsert: jest.fn() },
    $queryRaw: jest
      .fn()
      .mockResolvedValue([{ applicationId: 'application-1' }]),
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
): unknown {
  return {
    application: {
      id: 'application-1',
      status: ApplicationStatus.APPROVED,
      programId: 'program-1',
      teamId: team === null ? null : 'team-1',
      applicant: { githubId: 42n, nickname: 'Applicant-Login' },
      program: { name: 'Synthetic', repositoryProvisioningEnabled: true },
      repositoryConnectionMode: connectionMode,
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
    // Given: 표기가 제각각이고 순서도 섞인 현재 구성원이 있다.
    const db = createDb();
    db.repositoryProvisionJob.findFirst.mockResolvedValue(
      jobRow({
        name: 'synthetic-team',
        nicknames: ['  Zeta ', 'alpha', 'ALPHA'],
      }),
    );

    // When: context를 읽는다.
    const context = await repositoryFor(db).loadContext(JOB_ID, WORKER_ID);

    // Then: trim/소문자/중복 제거/정렬된 목록과 그 목록 그대로의 지문이 나온다.
    expect(context.currentMemberGithubLogins).toEqual(['alpha', 'zeta']);
    expect(context.membershipFingerprint).toBe(
      JSON.stringify(['alpha', 'zeta']),
    );
    // 신청자는 구성원 목록의 authority가 아니다 — fallback으로도 섞이지 않는다.
    expect(context.currentMemberGithubLogins).not.toContain('applicant-login');
  });

  it('NEW인데 팀을 읽을 수 없으면 최종 실패로 막는다', async () => {
    // Given: NEW 신청인데 연결된 팀이 없다.
    const db = createDb();
    db.repositoryProvisionJob.findFirst.mockResolvedValue(jobRow(null));

    // When/Then: 빈 목록을 "전원 회수"로 흘려보내지 않고 fail closed 한다.
    await expect(
      repositoryFor(db).loadContext(JOB_ID, WORKER_ID),
    ).rejects.toMatchObject({
      name: 'RepositoryProvisionFailure',
      retryable: false,
      code: 'REPOSITORY_PROVISION_MEMBERSHIP_UNAVAILABLE',
    });
  });

  it('OWN은 팀이 없어도 신청자를 채우지 않고 빈 목록을 든다', async () => {
    // Given: 팀 없는 OWN 신청이다.
    const db = createDb();
    db.repositoryProvisionJob.findFirst.mockResolvedValue(
      jobRow(null, RepositoryConnectionMode.OWN),
    );

    // When: context를 읽는다.
    const context = await repositoryFor(db).loadContext(JOB_ID, WORKER_ID);

    // Then: 초대 축이 없는 경로라 빈 목록이 정상이다.
    expect(context.currentMemberGithubLogins).toEqual([]);
    expect(context.membershipFingerprint).toBe('[]');
    expect(context.subjectName).toBe('Applicant-Login');
  });

  it('lease를 잃은 job은 context를 주지 않는다', async () => {
    const db = createDb();
    db.repositoryProvisionJob.findFirst.mockResolvedValue(null);

    await expect(
      repositoryFor(db).loadContext(JOB_ID, WORKER_ID),
    ).rejects.toBeInstanceOf(RepositoryProvisionLeaseLostError);
  });
});

describe('RepositoryProvisionStateRepository.prepareInvitations', () => {
  it('탈퇴자는 회수 대기로, 재합류자는 부여 대기로 옮기고 이력은 남긴다', async () => {
    // Given: 남은 사람/떠난 사람/재합류자/이미 회수된 이력 행이 섞여 있다.
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

    // When: 현재 구성원 목록으로 조정한다.
    await repositoryFor(db).prepareInvitations(
      JOB_ID,
      WORKER_ID,
      REPOSITORY_ID,
      ['stay', 'rejoined', 'grant-final', 'fresh'],
    );

    // Then: 이미 행이 있는 login은 다시 만들지 않는다(대소문자 표기 차이 포함).
    expect(db.repositoryInvitation.createMany).toHaveBeenCalledWith({
      data: [{ repositoryId: REPOSITORY_ID, githubLogin: 'fresh' }],
      skipDuplicates: true,
    });
    const [revokeCall, rejoinCall] =
      db.repositoryInvitation.updateMany.mock.calls;
    // 떠난 사람만 회수 대기로 간다 — 이미 REVOKED인 이력 행은 다시 건드리지 않는다.
    expect(revokeCall[0].where.id.in).toEqual(['left']);
    expect(revokeCall[0].data).toMatchObject({
      status: RepositoryInvitationStatus.REVOKE_REQUIRED,
      attemptCount: 0,
      reconciliationCount: 0,
      lastErrorCode: null,
      lastErrorMessage: null,
    });
    // 실제 재합류한 사람만 부여 축으로 돌아온다 — GRANT 축 FAILED_FINAL은 그대로 둔다.
    expect(rejoinCall[0].where.id.in).toEqual(['rejoined']);
    expect(rejoinCall[0].data).toMatchObject({
      status: RepositoryInvitationStatus.PENDING,
      attemptCount: 0,
      reconciliationCount: 0,
    });
  });

  it('회수 재시도 행은 매 사이클 재무장하지 않는다', async () => {
    // Given: 회수 재시도 중인 탈퇴자 행이 있다.
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

    // When: 같은 구성원 목록으로 다시 조정한다.
    await repositoryFor(db).prepareInvitations(
      JOB_ID,
      WORKER_ID,
      REPOSITORY_ID,
      ['stay'],
    );

    // Then: attemptCount가 리셋되지 않도록 회수 축 행은 대상에서 빠진다.
    const [revokeCall] = db.repositoryInvitation.updateMany.mock.calls;
    expect(revokeCall[0].where.id.in).toEqual([]);
  });
});

describe('RepositoryProvisionStateRepository.findInvitationWork', () => {
  it('회수를 먼저 돌려주고 최종 실패·예산 소진은 제외한다', async () => {
    // Given: 부여 대기와 회수 대기가 섞여 있다(조회는 생성순).
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

    // When: 처리할 일감을 읽는다.
    const work = await repositoryFor(db).findInvitationWork(
      JOB_ID,
      WORKER_ID,
      REPOSITORY_ID,
    );

    // Then: 회수가 앞선다 — 부여 중 오류로 중단돼도 회수는 이미 끝나 있다.
    expect(work.map((item) => [item.id, item.intent])).toEqual([
      ['revoke-1', 'REVOKE'],
      ['revoke-2', 'REVOKE'],
      // 이미 회수한 행도 매 사이클 재확인한다 — 늦게 성공한 부여가
      // GitHub 쪽에만 살아남는 경로를 닫는다.
      ['revoked', 'REVOKE'],
      ['grant-1', 'GRANT'],
      ['grant-2', 'GRANT'],
    ]);
    expect(work[0]?.status).toBe(RepositoryInvitationStatus.REVOKE_REQUIRED);
    // 조회 조건 자체가 최종 실패와 확인 예산 소진을 제외한다.
    const statuses = db.repositoryInvitation.findMany.mock.calls[0][0].where.OR;
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
      invitationId: 'invitation-1',
      repositoryId: REPOSITORY_ID,
      expectedStatus: RepositoryInvitationStatus.REVOKE_REQUIRED,
      status: RepositoryInvitationStatus.REVOKED,
      now: NOW,
    });

    expect(db.repositoryInvitation.updateMany.mock.calls[0][0].where).toEqual({
      id: 'invitation-1',
      repositoryId: REPOSITORY_ID,
      status: RepositoryInvitationStatus.REVOKE_REQUIRED,
    });
    // REVOKED는 확인 예산과 무관하다 — 예산 종료 업데이트를 덧붙이지 않는다.
    expect(db.repositoryInvitation.updateMany).toHaveBeenCalledTimes(1);
  });

  it('재확인한 REVOKED 는 같은 상태로 멱등하게 닫힌다', async () => {
    // Given: 재확인 대상으로 나온 REVOKED 행이다.
    const db = createDb();

    // When: 회수를 다시 돌려 같은 상태로 닫는다.
    await repositoryFor(db).completeInvitation({
      jobId: JOB_ID,
      workerId: WORKER_ID,
      invitationId: 'invitation-1',
      repositoryId: REPOSITORY_ID,
      expectedStatus: RepositoryInvitationStatus.REVOKED,
      status: RepositoryInvitationStatus.REVOKED,
      now: NOW,
    });

    // Then: 기대 상태도 REVOKED 라 CAS 가 통과하고 확인 예산은 건드리지 않는다.
    const call = db.repositoryInvitation.updateMany.mock.calls[0][0];
    expect(call.where.status).toBe(RepositoryInvitationStatus.REVOKED);
    expect(call.data.reconciliationCount).toBeUndefined();
    expect(db.repositoryInvitation.updateMany).toHaveBeenCalledTimes(1);
  });

  it('기대 상태가 어긋난 완료는 lease 상실로 되돌린다', async () => {
    // Given: 그 사이 멤버십이 바뀌어 행이 회수 대기로 옮겨갔다.
    const db = createDb();
    db.repositoryInvitation.updateMany.mockResolvedValue({ count: 0 });

    // When/Then: 늦게 도착한 부여 결과가 회수 지시를 덮지 못한다.
    await expect(
      repositoryFor(db).completeInvitation({
        jobId: JOB_ID,
        workerId: WORKER_ID,
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
      invitationId: 'invitation-1',
      repositoryId: REPOSITORY_ID,
      expectedStatus: RepositoryInvitationStatus.PENDING,
      status: RepositoryInvitationStatus.PENDING,
      now: NOW,
    });

    expect(
      db.repositoryInvitation.updateMany.mock.calls[0][0].data
        .reconciliationCount,
    ).toEqual({ increment: 1 });
    expect(db.repositoryInvitation.updateMany.mock.calls[1][0]).toMatchObject({
      where: { reconciliationCount: { gte: 96 } },
      data: { status: RepositoryInvitationStatus.FAILED_FINAL },
    });
  });

  it('회수 실패는 회수 축 상태로 적는다', async () => {
    const db = createDb();
    const repository = repositoryFor(db);

    await repository.failInvitation({
      jobId: JOB_ID,
      workerId: WORKER_ID,
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
      invitationId: 'invitation-3',
      repositoryId: REPOSITORY_ID,
      expectedStatus: RepositoryInvitationStatus.PENDING,
      intent: 'GRANT',
      final: false,
      errorCode: 'UPSTREAM',
      now: NOW,
    });

    // 회수 실패를 부여 실패로 적으면 다음 사이클이 탈퇴자를 다시 초대한다.
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
  const members = (nicknames: readonly string[]): unknown[] =>
    nicknames.map((nickname) => ({ user: { nickname } }));

  it('멤버십이 그대로면 SUCCEEDED로 닫고 다음 확인 시각을 남긴다', async () => {
    // Given: 작업 시작 시점 지문과 지금 구성원이 같다.
    const db = createDb();
    db.application.findUnique.mockResolvedValue({ teamId: 'team-1' });
    db.teamMember.findMany.mockResolvedValue(members(['Alpha', 'zeta']));
    const nextAt = new Date(NOW.getTime() + 900_000);

    // When: 완료 처리한다.
    await repositoryFor(db).completeJob(
      JOB_ID,
      WORKER_ID,
      REPOSITORY_ID,
      NOW,
      nextAt,
      JSON.stringify(['alpha', 'zeta']),
    );

    // Then: 정상 완료다.
    expect(db.repositoryProvisionJob.updateMany.mock.calls[0][0].data).toEqual({
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
    // Given: GitHub 호출 사이에 한 명이 팀을 떠났다.
    const db = createDb();
    db.application.findUnique.mockResolvedValue({ teamId: 'team-1' });
    db.teamMember.findMany.mockResolvedValue(members(['alpha']));

    // When: 오래된 지문으로 완료를 시도한다.
    await repositoryFor(db).completeJob(
      JOB_ID,
      WORKER_ID,
      REPOSITORY_ID,
      NOW,
      new Date(NOW.getTime() + 900_000),
      JSON.stringify(['alpha', 'zeta']),
    );

    // Then: SUCCEEDED로 닫히지 않고 지금 실행 가능한 PENDING으로 돌아간다.
    expect(db.repositoryProvisionJob.updateMany.mock.calls[0][0].data).toEqual({
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
    // Given: 재무장 경쟁을 막으려면 job 행 잠금이 먼저여야 한다.
    const db = createDb();
    const order: string[] = [];
    db.$queryRaw.mockImplementation(() => {
      order.push('lock-job');
      return Promise.resolve([{ applicationId: 'application-1' }]);
    });
    db.application.findUnique.mockImplementation(() => {
      order.push('read-application');
      return Promise.resolve({ teamId: 'team-1' });
    });
    db.teamMember.findMany.mockImplementation(() => {
      order.push('read-members');
      return Promise.resolve([]);
    });

    // When: 완료 처리한다.
    await repositoryFor(db).completeJob(
      JOB_ID,
      WORKER_ID,
      REPOSITORY_ID,
      NOW,
      undefined,
      '[]',
    );

    // Then: Job 잠금 → 멤버십 재조회 순서다(멤버십은 잠그지 않는다 — Team→Job
    // 순서로 잠그는 쓰기 경로와 순환 대기가 된다).
    expect(order).toEqual(['lock-job', 'read-application', 'read-members']);
    expect(db.$queryRaw.mock.calls[0][0].strings.join(' ')).toContain(
      'FOR UPDATE',
    );
  });

  it('지문이 없는 OWN 완료는 멤버십을 다시 읽지 않는다', async () => {
    // Given: OWN 경로는 초대/회수 축이 없어 지문을 넘기지 않는다.
    const db = createDb();

    // When: 지문 없이 완료한다.
    await repositoryFor(db).completeJob(JOB_ID, WORKER_ID, REPOSITORY_ID, NOW);

    // Then: 멤버십 재확인 없이 정상 완료한다.
    expect(db.teamMember.findMany).not.toHaveBeenCalled();
    expect(
      db.repositoryProvisionJob.updateMany.mock.calls[0][0].data,
    ).toMatchObject({
      status: RepositoryProvisionJobStatus.SUCCEEDED,
      nextAttemptAt: NOW,
    });
  });

  it('lease를 잃은 job은 완료하지 못한다', async () => {
    const db = createDb();
    db.$queryRaw.mockResolvedValue([]);

    await expect(
      repositoryFor(db).completeJob(JOB_ID, WORKER_ID, REPOSITORY_ID, NOW),
    ).rejects.toBeInstanceOf(RepositoryProvisionLeaseLostError);
    expect(db.repositoryProvisionJob.updateMany).not.toHaveBeenCalled();
  });
});

describe('RepositoryProvisionStateRepository.failJob', () => {
  const failInput = {
    jobId: JOB_ID,
    workerId: WORKER_ID,
    final: true,
    errorCode: 'REPOSITORY_PROVISION_INTERNAL',
    nextAttemptAt: NOW,
    now: NOW,
  };

  it('작업 중 멤버십이 바뀜다면 최종 실패로 닫지 않고 재무장한다', async () => {
    // Given: 실패 직전에 한 명이 팀을 떠났다.
    const db = createDb();
    db.application.findUnique.mockResolvedValue({ teamId: 'team-1' });
    db.teamMember.findMany.mockResolvedValue([{ user: { nickname: 'alpha' } }]);

    // When: 오래된 지문으로 최종 실패를 기록하려 한다.
    await repositoryFor(db).failJob({
      ...failInput,
      expectedMembershipFingerprint: JSON.stringify(['alpha', 'zeta']),
    });

    // Then: FAILED_FINAL 로 닫히면 그 사이 도착한 멤버십 변경이 통째로 사라진다.
    expect(db.repositoryProvisionJob.updateMany.mock.calls[0][0].data).toEqual({
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
      db.repositoryProvisionJob.updateMany.mock.calls[0][0].data,
    ).toMatchObject({
      status: RepositoryProvisionJobStatus.FAILED_FINAL,
      lastErrorCode: 'REPOSITORY_PROVISION_INTERNAL',
      finishedAt: NOW,
    });
  });

  it('지문 없는 실패는 멤버십을 읽지 않고 job 행만 잠그고 기록한다', async () => {
    // Given: loadContext 이전에 터진 실패는 비교할 지문이 없다.
    const db = createDb();

    // When: 지문 없이 실패를 기록한다.
    await repositoryFor(db).failJob({ ...failInput, final: false });

    // Then: 멤버십 재조회 없이 재시도 실패로 남는다.
    expect(db.teamMember.findMany).not.toHaveBeenCalled();
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(
      db.repositoryProvisionJob.updateMany.mock.calls[0][0].data,
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
    repositoryFor(db).loadContext(JOB_ID, WORKER_ID),
  ).rejects.toBeInstanceOf(RepositoryProvisionFailure);
});
