import { ApplicationStatus } from '@prisma/client';
import { RepositoryInvitationStatus } from '@prisma/client';
import {
  githubClientMock,
  grantInvitationWork,
  jobRepositoryMock,
  MEMBERSHIP_FINGERPRINT,
  ownProvisionContext,
  PROVISION_NOW,
  PROVISION_REPOSITORY,
  provisionContext,
  provisionStateMock,
  revokeInvitationWork,
} from '../../test/repository-provision-worker.fixture';
import {
  GITHUB_OPERATIONS_ERROR_CODES,
  GithubOperationsError,
} from './github-app.error';
import { PROVISION_ERROR_CODES } from './repository-provision.failure';
import { RepositoryProvisionWorker } from './repository-provision.worker';
import { RepositoryProvisionLeaseLostError } from './repository-provision-state.helpers';
import { buildRepositoryOwnershipMarker } from './repository-name';

const OPTIONS = { leaseMs: 300_000, maxAttempts: 3, retryBaseMs: 60_000 };

describe('RepositoryProvisionWorker failure', () => {
  it('lease를 잃으면 외부 저장소를 건드리지 않고 즉시 중단한다', async () => {
    // Given: context 조회 뒤 다른 worker가 job lease를 회수했다.
    const jobs = jobRepositoryMock();
    jobs.renewLease.mockRejectedValue(new RepositoryProvisionLeaseLostError());
    const state = provisionStateMock();
    const github = githubClientMock();
    const worker = new RepositoryProvisionWorker(
      jobs,
      state,
      github,
      { enrollExternalRepository: jest.fn() },
      OPTIONS,
    );

    // When: 저장소 생성 직전 lease 갱신을 시도한다.
    const result = worker.runNext('worker-stale', PROVISION_NOW);

    // Then: 새 owner의 job 상태나 GitHub에 side effect를 만들지 않는다.
    await expect(result).rejects.toBeInstanceOf(
      RepositoryProvisionLeaseLostError,
    );
    expect(github.findRepository.mock.calls).toHaveLength(0);
    expect(github.createRepository.mock.calls).toHaveLength(0);
    expect(state.failJob.mock.calls).toHaveLength(0);
  });

  it('승인되지 않은 신청은 GitHub 호출 없이 최종 실패한다', async () => {
    // Given: job의 신청 상태가 SUBMITTED다.
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    state.loadContext.mockResolvedValue(
      provisionContext({ applicationStatus: ApplicationStatus.SUBMITTED }),
    );
    const github = githubClientMock();
    const worker = new RepositoryProvisionWorker(
      jobs,
      state,
      github,
      { enrollExternalRepository: jest.fn() },
      OPTIONS,
    );

    // When: job을 실행한다.
    const result = await worker.runNext('worker-a', PROVISION_NOW);

    // Then: 승인 계약 오류를 저장하고 외부 호출을 막는다.
    expect(result).toEqual({
      kind: 'FAILED_FINAL',
      jobId: 'synthetic-job-id',
      errorCode: PROVISION_ERROR_CODES.APPLICATION_NOT_APPROVED,
    });
    expect(github.findRepository.mock.calls).toHaveLength(0);
    expect(state.failJob.mock.calls[0]?.[0].final).toBe(true);
    // 계약 검증을 통과하지 못한 job은 비교할 관리형 기준이 없다.
    expect(
      state.failJob.mock.calls[0]?.[0].expectedMembershipFingerprint,
    ).toBeUndefined();
  });

  it('레거시 teamId null payload는 백필된 context teamId와 달라도 통과한다', async () => {
    // Given: 백필 이전 outbox payload는 teamId null이고 context는 백필된 teamId다.
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    state.loadContext.mockResolvedValue(
      provisionContext({
        teamId: 'synthetic-backfilled-team',
        eventPayload: {
          applicationId: 'synthetic-application-id',
          programId: 'synthetic-program-id',
          teamId: null,
          requestedAt: PROVISION_NOW.toISOString(),
          collaboratorGithubLogins: ['synthetic-leader', 'synthetic-student'],
        },
      }),
    );
    const github = githubClientMock();
    const worker = new RepositoryProvisionWorker(
      jobs,
      state,
      github,
      { enrollExternalRepository: jest.fn() },
      OPTIONS,
    );

    // When: provision job을 실행한다.
    const result = await worker.runNext(
      'worker-legacy-null-team',
      PROVISION_NOW,
    );

    // Then: 레거시 null payload를 거부하지 않고 저장소 생성까지 진행한다.
    expect(result).toEqual({
      kind: 'SUCCEEDED',
      jobId: 'synthetic-job-id',
      repositoryId: PROVISION_REPOSITORY.id,
    });
    expect(state.recordRepository.mock.calls).toHaveLength(1);
  });

  it('event.teamId 와 context.teamId 가 서로 다른 non-null 이면 INVALID_EVENT 로 거부한다', async () => {
    // Given: payload teamId와 context teamId가 둘 다 있지만 서로 다르다.
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    state.loadContext.mockResolvedValue(
      provisionContext({
        teamId: 'synthetic-context-team',
        eventPayload: {
          applicationId: 'synthetic-application-id',
          programId: 'synthetic-program-id',
          teamId: 'synthetic-payload-team',
          requestedAt: PROVISION_NOW.toISOString(),
          collaboratorGithubLogins: ['synthetic-leader', 'synthetic-student'],
        },
      }),
    );
    const github = githubClientMock();
    const worker = new RepositoryProvisionWorker(
      jobs,
      state,
      github,
      { enrollExternalRepository: jest.fn() },
      OPTIONS,
    );

    // When: job을 실행한다.
    const result = await worker.runNext('worker-team-mismatch', PROVISION_NOW);

    // Then: 이벤트 계약 불일치로 최종 실패하고 외부 호출을 막는다.
    expect(result).toEqual({
      kind: 'FAILED_FINAL',
      jobId: 'synthetic-job-id',
      errorCode: PROVISION_ERROR_CODES.INVALID_EVENT,
    });
    expect(github.findRepository.mock.calls).toHaveLength(0);
    expect(state.failJob.mock.calls[0]?.[0].final).toBe(true);
  });

  it('GitHub 5xx는 지수 backoff 뒤 재시도한다', async () => {
    // Given: 두 번째 시도에서 GitHub가 일시 오류를 반환한다.
    const jobs = jobRepositoryMock();
    jobs.claimNext.mockResolvedValue({
      id: 'synthetic-job-id',
      applicationId: 'synthetic-application-id',
      repositoryId: null,
      attemptCount: 2,
    });
    const state = provisionStateMock();
    const github = githubClientMock();
    github.findRepository.mockRejectedValue(
      new GithubOperationsError(GITHUB_OPERATIONS_ERROR_CODES.UPSTREAM, true),
    );
    const worker = new RepositoryProvisionWorker(
      jobs,
      state,
      github,
      { enrollExternalRepository: jest.fn() },
      OPTIONS,
    );

    // When: job을 실행한다.
    const result = await worker.runNext('worker-b', PROVISION_NOW);

    // Then: 두 배 backoff를 가진 재시도 상태로 저장한다.
    expect(result.kind).toBe('FAILED_RETRYABLE');
    expect(state.failJob.mock.calls[0]?.[0]).toMatchObject({
      final: false,
      nextAttemptAt: new Date('2026-07-22T00:02:00.000Z'),
    });
  });

  it('생성 응답이 public이면 기록과 초대 없이 최종 실패한다', async () => {
    // Given: GitHub가 생성 요청에 공개 저장소 metadata를 반환한다.
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    const github = githubClientMock();
    github.createRepository.mockResolvedValue({
      githubRepositoryId: PROVISION_REPOSITORY.githubRepositoryId,
      name: PROVISION_REPOSITORY.name,
      url: PROVISION_REPOSITORY.url,
      nameWithOwner: `synthetic-org/${PROVISION_REPOSITORY.name}`,
      visibility: 'PUBLIC',
      description: buildRepositoryOwnershipMarker('synthetic-application-id'),
    });
    const worker = new RepositoryProvisionWorker(
      jobs,
      state,
      github,
      { enrollExternalRepository: jest.fn() },
      OPTIONS,
    );

    // When: provision job을 실행한다.
    const result = await worker.runNext('worker-public-create', PROVISION_NOW);

    // Then: private 불변식을 위반한 원격 응답을 저장하거나 초대하지 않는다.
    expect(result).toEqual({
      kind: 'FAILED_FINAL',
      jobId: 'synthetic-job-id',
      errorCode: GITHUB_OPERATIONS_ERROR_CODES.INVALID_RESPONSE,
    });
    expect(state.recordRepository.mock.calls).toHaveLength(0);
    expect(state.prepareInvitations.mock.calls).toHaveLength(0);
    expect(github.ensureCollaborator.mock.calls).toHaveLength(0);
  });

  it('중단 복구에서 같은 marker의 public 저장소를 재사용하지 않는다', async () => {
    // Given: 이전 시도가 남긴 것처럼 보이는 공개 저장소가 원격에 있다.
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    const github = githubClientMock();
    github.findRepository.mockResolvedValue({
      githubRepositoryId: PROVISION_REPOSITORY.githubRepositoryId,
      name: PROVISION_REPOSITORY.name,
      url: PROVISION_REPOSITORY.url,
      nameWithOwner: `synthetic-org/${PROVISION_REPOSITORY.name}`,
      visibility: 'PUBLIC',
      description: buildRepositoryOwnershipMarker('synthetic-application-id'),
    });
    const worker = new RepositoryProvisionWorker(
      jobs,
      state,
      github,
      { enrollExternalRepository: jest.fn() },
      OPTIONS,
    );

    // When: 중단된 provision job을 재시도한다.
    const result = await worker.runNext(
      'worker-public-recovery',
      PROVISION_NOW,
    );

    // Then: marker만 믿고 공개 저장소를 기록하거나 초대하지 않는다.
    expect(result).toEqual({
      kind: 'FAILED_FINAL',
      jobId: 'synthetic-job-id',
      errorCode: GITHUB_OPERATIONS_ERROR_CODES.INVALID_RESPONSE,
    });
    expect(github.createRepository.mock.calls).toHaveLength(0);
    expect(state.recordRepository.mock.calls).toHaveLength(0);
    expect(state.prepareInvitations.mock.calls).toHaveLength(0);
    expect(github.ensureCollaborator.mock.calls).toHaveLength(0);
  });

  it('GitHub Retry-After 시각을 지수 backoff보다 우선한다', async () => {
    // Given: GitHub가 10분 뒤 rate limit 재시도를 지시한다.
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    const github = githubClientMock();
    github.findRepository.mockRejectedValue(
      new GithubOperationsError(
        GITHUB_OPERATIONS_ERROR_CODES.RATE_LIMITED,
        true,
        new Date('2026-07-22T00:10:00.000Z'),
      ),
    );
    const worker = new RepositoryProvisionWorker(
      jobs,
      state,
      github,
      { enrollExternalRepository: jest.fn() },
      OPTIONS,
    );

    // When: job을 실행한다.
    await worker.runNext('worker-c', PROVISION_NOW);

    // Then: 검증된 GitHub 재시도 시각을 저장한다.
    expect(state.failJob.mock.calls[0]?.[0].nextAttemptAt).toEqual(
      new Date('2026-07-22T00:10:00.000Z'),
    );
  });

  it('최대 시도 횟수의 재시도 오류는 최종 실패로 전환한다', async () => {
    // Given: 마지막 허용 시도에서 GitHub가 다시 일시 오류를 반환한다.
    const jobs = jobRepositoryMock();
    jobs.claimNext.mockResolvedValue({
      id: 'synthetic-job-id',
      applicationId: 'synthetic-application-id',
      repositoryId: null,
      attemptCount: 3,
    });
    const state = provisionStateMock();
    const github = githubClientMock();
    github.findRepository.mockRejectedValue(
      new GithubOperationsError(GITHUB_OPERATIONS_ERROR_CODES.UPSTREAM, true),
    );
    const worker = new RepositoryProvisionWorker(
      jobs,
      state,
      github,
      { enrollExternalRepository: jest.fn() },
      OPTIONS,
    );

    // When: job을 실행한다.
    const result = await worker.runNext('worker-d', PROVISION_NOW);

    // Then: 무한 재시도 없이 최종 실패로 저장한다.
    expect(result.kind).toBe('FAILED_FINAL');
    expect(state.failJob.mock.calls[0]?.[0].final).toBe(true);
  });

  it('일부 invitation 실패는 해당 대상과 job만 재시도로 남긴다', async () => {
    // Given: 저장소는 이미 있고 한 invitation이 5xx로 실패한다.
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    state.loadContext.mockResolvedValue(
      provisionContext({ repository: PROVISION_REPOSITORY }),
    );
    state.findInvitationWork.mockResolvedValue([
      grantInvitationWork({
        id: 'synthetic-failed-invitation',
        githubLogin: 'synthetic-student',
      }),
    ]);
    const github = githubClientMock();
    github.ensureCollaborator.mockRejectedValue(
      new GithubOperationsError(GITHUB_OPERATIONS_ERROR_CODES.UPSTREAM, true),
    );
    const worker = new RepositoryProvisionWorker(
      jobs,
      state,
      github,
      { enrollExternalRepository: jest.fn() },
      OPTIONS,
    );

    // When: job을 실행한다.
    const result = await worker.runNext('worker-e', PROVISION_NOW);

    // Then: 저장소 생성 없이 실패 invitation과 job만 재시도 가능 상태가 된다.
    expect(result.kind).toBe('FAILED_RETRYABLE');
    expect(github.createRepository.mock.calls).toHaveLength(0);
    expect(state.failInvitation.mock.calls[0]?.[0]).toMatchObject({
      invitationId: 'synthetic-failed-invitation',
      repositoryId: PROVISION_REPOSITORY.id,
      expectedStatus: RepositoryInvitationStatus.PENDING,
      intent: 'GRANT',
      final: false,
      errorCode: GITHUB_OPERATIONS_ERROR_CODES.UPSTREAM,
    });
  });
});

describe('RepositoryProvisionWorker failure membership guard', () => {
  it('관리형 job 실패는 읽어둔 팀원 지문을 함께 넘긴다', async () => {
    // Given: 회수 호출이 5xx로 실패해 job이 재시도로 떨어진다.
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    state.loadContext.mockResolvedValue(
      provisionContext({
        repository: PROVISION_REPOSITORY,
        currentMemberGithubLogins: [],
      }),
    );
    state.findInvitationWork.mockResolvedValue([revokeInvitationWork()]);
    const github = githubClientMock();
    github.revokeCollaborator.mockRejectedValue(
      new GithubOperationsError(GITHUB_OPERATIONS_ERROR_CODES.UPSTREAM, true),
    );
    const worker = new RepositoryProvisionWorker(
      jobs,
      state,
      github,
      { enrollExternalRepository: jest.fn() },
      OPTIONS,
    );

    // When: job을 실행한다.
    const result = await worker.runNext('worker-fail-guard', PROVISION_NOW);

    // Then: 처리 중 들어온 팀원 변경 깨우기를 지우지 않도록 지문을 넘기고,
    // 성공으로 위장하지 않는다.
    expect(result.kind).toBe('FAILED_RETRYABLE');
    expect(state.failJob.mock.calls[0]?.[0]).toMatchObject({
      final: false,
      expectedMembershipFingerprint: MEMBERSHIP_FINGERPRINT,
    });
    expect(state.completeJob.mock.calls).toHaveLength(0);
  });

  it('최종 실패로 끝나는 관리형 job도 지문 가드를 빼지 않는다', async () => {
    // Given: 되돌릴 수 없는 권한 오류로 회수가 최종 실패한다.
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    state.loadContext.mockResolvedValue(
      provisionContext({
        repository: PROVISION_REPOSITORY,
        currentMemberGithubLogins: [],
      }),
    );
    state.findInvitationWork.mockResolvedValue([revokeInvitationWork()]);
    const github = githubClientMock();
    github.revokeCollaborator.mockRejectedValue(
      new GithubOperationsError(
        GITHUB_OPERATIONS_ERROR_CODES.PERMISSION,
        false,
      ),
    );
    const worker = new RepositoryProvisionWorker(
      jobs,
      state,
      github,
      { enrollExternalRepository: jest.fn() },
      OPTIONS,
    );

    // When: job을 실행한다.
    const result = await worker.runNext(
      'worker-fail-final-guard',
      PROVISION_NOW,
    );

    // Then: 오래된 의도의 최종 실패가 새 팀원 변경 깨우기를 덮어쓰지 못하게 한다.
    expect(result.kind).toBe('FAILED_FINAL');
    expect(state.failJob.mock.calls[0]?.[0]).toMatchObject({
      final: true,
      expectedMembershipFingerprint: MEMBERSHIP_FINGERPRINT,
    });
  });

  it('OWN 연결 실패는 지문을 넘기지 않는다', async () => {
    // Given: OWN 연결 대상 저장소를 찾지 못해 최종 실패한다.
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    state.loadContext.mockResolvedValue(ownProvisionContext());
    const github = githubClientMock();
    github.findPublicRepository.mockResolvedValue(null);
    const worker = new RepositoryProvisionWorker(
      jobs,
      state,
      github,
      { enrollExternalRepository: jest.fn() },
      OPTIONS,
    );

    // When: job을 실행한다.
    const result = await worker.runNext('worker-own-fail-guard', PROVISION_NOW);

    // Then: 회수 관리 밖인 OWN은 비교 기준을 남기지 않는다.
    expect(result.kind).toBe('FAILED_FINAL');
    expect(
      state.failJob.mock.calls[0]?.[0].expectedMembershipFingerprint,
    ).toBeUndefined();
  });

  it('context를 읽기 전 lease를 잃으면 job 실패를 아예 기록하지 않는다', async () => {
    // Given: context 조회 자체가 lease 상실로 실패한다.
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    state.loadContext.mockRejectedValue(
      new RepositoryProvisionLeaseLostError(),
    );
    const github = githubClientMock();
    const worker = new RepositoryProvisionWorker(
      jobs,
      state,
      github,
      { enrollExternalRepository: jest.fn() },
      OPTIONS,
    );

    // When: job을 실행한다.
    const result = worker.runNext('worker-fenced-load', PROVISION_NOW);

    // Then: 새 owner의 지문·상태를 건드리지 않고 즉시 중단한다.
    await expect(result).rejects.toBeInstanceOf(
      RepositoryProvisionLeaseLostError,
    );
    expect(state.failJob.mock.calls).toHaveLength(0);
  });
});

describe('RepositoryProvisionWorker revocation failure', () => {
  it('이미 REVOKED인 행의 주기 재확인 실패도 회수 의도로 기록한다', async () => {
    // Given: 이미 회수된 행이 재확인 대상으로 다시 내려왔고 GitHub가 5xx를 낸다.
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    state.loadContext.mockResolvedValue(
      provisionContext({
        repository: PROVISION_REPOSITORY,
        currentMemberGithubLogins: [],
      }),
    );
    state.findInvitationWork.mockResolvedValue([
      revokeInvitationWork({
        id: 'synthetic-revoke-reverify',
        githubLogin: 'synthetic-left',
        status: RepositoryInvitationStatus.REVOKED,
      }),
    ]);
    const github = githubClientMock();
    github.revokeCollaborator.mockRejectedValue(
      new GithubOperationsError(GITHUB_OPERATIONS_ERROR_CODES.UPSTREAM, true),
    );
    const worker = new RepositoryProvisionWorker(
      jobs,
      state,
      github,
      { enrollExternalRepository: jest.fn() },
      OPTIONS,
    );

    // When: job을 실행한다.
    const result = await worker.runNext('worker-reverify', PROVISION_NOW);

    // Then: REVOKE_REQUIRED만 상대한다고 가정하지 않고, 행의 현재 상태를 그대로
    // expectedStatus로 되돌려 CAS 경합을 깨뜨리지 않는다.
    expect(result.kind).toBe('FAILED_RETRYABLE');
    expect(github.revokeCollaborator.mock.calls).toEqual([
      [PROVISION_REPOSITORY.name, 'synthetic-left'],
    ]);
    expect(state.failInvitation.mock.calls[0]?.[0]).toMatchObject({
      invitationId: 'synthetic-revoke-reverify',
      expectedStatus: RepositoryInvitationStatus.REVOKED,
      intent: 'REVOKE',
    });
  });

  it('한 대상의 회수 실패가 다른 대상의 회수를 막지 않는다', async () => {
    // Given: 회수 대상 두 명 중 첫 번째가 GitHub 5xx로 실패한다.
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    state.loadContext.mockResolvedValue(
      provisionContext({
        repository: PROVISION_REPOSITORY,
        currentMemberGithubLogins: ['synthetic-stay'],
      }),
    );
    state.findInvitationWork.mockResolvedValue([
      revokeInvitationWork({
        id: 'synthetic-revoke-a',
        githubLogin: 'synthetic-left-a',
      }),
      revokeInvitationWork({
        id: 'synthetic-revoke-b',
        githubLogin: 'synthetic-left-b',
      }),
      grantInvitationWork({
        id: 'synthetic-grant',
        githubLogin: 'synthetic-stay',
      }),
    ]);
    const github = githubClientMock();
    github.revokeCollaborator.mockRejectedValueOnce(
      new GithubOperationsError(GITHUB_OPERATIONS_ERROR_CODES.UPSTREAM, true),
    );
    const worker = new RepositoryProvisionWorker(
      jobs,
      state,
      github,
      { enrollExternalRepository: jest.fn() },
      OPTIONS,
    );

    // When: job을 실행한다.
    const result = await worker.runNext('worker-revoke-partial', PROVISION_NOW);

    // Then: 두 번째 회수는 그대로 진행하고, job만 재시도로 남는다.
    expect(result.kind).toBe('FAILED_RETRYABLE');
    expect(github.revokeCollaborator.mock.calls).toEqual([
      [PROVISION_REPOSITORY.name, 'synthetic-left-a'],
      [PROVISION_REPOSITORY.name, 'synthetic-left-b'],
    ]);
    expect(state.completeInvitation.mock.calls).toHaveLength(1);
    expect(state.completeInvitation.mock.calls[0]?.[0]).toMatchObject({
      invitationId: 'synthetic-revoke-b',
      status: RepositoryInvitationStatus.REVOKED,
    });
    expect(state.failInvitation.mock.calls[0]?.[0]).toMatchObject({
      invitationId: 'synthetic-revoke-a',
      repositoryId: PROVISION_REPOSITORY.id,
      expectedStatus: RepositoryInvitationStatus.REVOKE_REQUIRED,
      intent: 'REVOKE',
      final: false,
      errorCode: GITHUB_OPERATIONS_ERROR_CODES.UPSTREAM,
    });
    // 회수가 남은 채 새 권한을 주지 않는다.
    expect(github.ensureCollaborator.mock.calls).toHaveLength(0);
    expect(state.completeJob.mock.calls).toHaveLength(0);
    expect(state.failJob.mock.calls[0]?.[0]).toMatchObject({
      final: false,
      errorCode: GITHUB_OPERATIONS_ERROR_CODES.UPSTREAM,
    });
  });

  it('회수 중 lease를 잃으면 남은 회수를 시도하지 않고 즉시 중단한다', async () => {
    // Given: 첫 회수 뒤 lease 갱신이 다른 worker에게 펌스된다.
    const jobs = jobRepositoryMock();
    jobs.renewLease
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new RepositoryProvisionLeaseLostError());
    const state = provisionStateMock();
    state.loadContext.mockResolvedValue(
      provisionContext({
        repository: PROVISION_REPOSITORY,
        currentMemberGithubLogins: [],
      }),
    );
    state.findInvitationWork.mockResolvedValue([
      revokeInvitationWork({
        id: 'synthetic-revoke-a',
        githubLogin: 'synthetic-left-a',
      }),
      revokeInvitationWork({
        id: 'synthetic-revoke-b',
        githubLogin: 'synthetic-left-b',
      }),
    ]);
    const github = githubClientMock();
    const worker = new RepositoryProvisionWorker(
      jobs,
      state,
      github,
      { enrollExternalRepository: jest.fn() },
      OPTIONS,
    );

    // When: job을 실행한다.
    const result = worker.runNext('worker-revoke-fenced', PROVISION_NOW);

    // Then: 새 owner의 상태를 덮어쓰지 않고 두 번째 회수도 시도하지 않는다.
    await expect(result).rejects.toBeInstanceOf(
      RepositoryProvisionLeaseLostError,
    );
    expect(github.revokeCollaborator.mock.calls).toEqual([
      [PROVISION_REPOSITORY.name, 'synthetic-left-a'],
    ]);
    expect(state.failInvitation.mock.calls).toHaveLength(0);
    expect(state.failJob.mock.calls).toHaveLength(0);
    expect(state.completeJob.mock.calls).toHaveLength(0);
  });

  it('되돌릴 수 없는 회수 실패는 최종 실패로 남기고 부여로 넘어가지 않는다', async () => {
    // Given: 회수 호출이 재시도 불가 오류로 실패한다.
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    state.loadContext.mockResolvedValue(
      provisionContext({
        repository: PROVISION_REPOSITORY,
        currentMemberGithubLogins: ['synthetic-stay'],
      }),
    );
    state.findInvitationWork.mockResolvedValue([
      revokeInvitationWork({
        id: 'synthetic-revoke-final',
        githubLogin: 'synthetic-left',
      }),
      grantInvitationWork({
        id: 'synthetic-grant',
        githubLogin: 'synthetic-stay',
      }),
    ]);
    const github = githubClientMock();
    github.revokeCollaborator.mockRejectedValue(
      new GithubOperationsError(
        GITHUB_OPERATIONS_ERROR_CODES.PERMISSION,
        false,
      ),
    );
    const worker = new RepositoryProvisionWorker(
      jobs,
      state,
      github,
      { enrollExternalRepository: jest.fn() },
      OPTIONS,
    );

    // When: job을 실행한다.
    const result = await worker.runNext('worker-revoke-final', PROVISION_NOW);

    // Then: 회수를 마치지 못한 상태로 job을 완료하지 않는다.
    expect(result).toEqual({
      kind: 'FAILED_FINAL',
      jobId: 'synthetic-job-id',
      errorCode: GITHUB_OPERATIONS_ERROR_CODES.PERMISSION,
    });
    expect(state.failInvitation.mock.calls[0]?.[0]).toMatchObject({
      invitationId: 'synthetic-revoke-final',
      intent: 'REVOKE',
      final: true,
    });
    expect(github.ensureCollaborator.mock.calls).toHaveLength(0);
    expect(state.completeJob.mock.calls).toHaveLength(0);
  });
});
