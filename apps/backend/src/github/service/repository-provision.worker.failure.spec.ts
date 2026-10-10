import { ApplicationStatus } from '@prisma/client';
import { RepositoryInvitationStatus, RepositorySource } from '@prisma/client';
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
} from '../../../test/repository-provision-worker.fixture';
import {
  GITHUB_OPERATIONS_ERROR_CODES,
  GithubOperationsError,
} from '../domain/github-app.error';
import { PROVISION_ERROR_CODES } from '../domain/repository-provision.failure';
import { RepositoryProvisionWorker } from './repository-provision.worker';
import { RepositoryProvisionLeaseLostError } from '../repository/repository-provision-state.helpers';
import { buildRepositoryOwnershipMarker } from '../domain/repository-name';

const OPTIONS = { leaseMs: 300_000, maxAttempts: 3, retryBaseMs: 60_000 };

describe('RepositoryProvisionWorker failure', () => {
  it('lease를 잃으면 외부 저장소를 건드리지 않고 즉시 중단한다', async () => {
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

    const result = worker.runNext('worker-stale', PROVISION_NOW);

    await expect(result).rejects.toBeInstanceOf(
      RepositoryProvisionLeaseLostError,
    );
    expect(github.findRepository.mock.calls).toHaveLength(0);
    expect(github.createRepository.mock.calls).toHaveLength(0);
    expect(state.failJob.mock.calls).toHaveLength(0);
  });

  it('승인되지 않은 신청은 GitHub 호출 없이 최종 실패한다', async () => {
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

    const result = await worker.runNext('worker-a', PROVISION_NOW);

    expect(result).toEqual({
      kind: 'FAILED_FINAL',
      jobId: 'synthetic-job-id',
      errorCode: PROVISION_ERROR_CODES.APPLICATION_NOT_APPROVED,
    });
    expect(github.findRepository.mock.calls).toHaveLength(0);
    expect(state.failJob.mock.calls[0]?.[0].final).toBe(true);

    expect(
      state.failJob.mock.calls[0]?.[0].expectedMembershipFingerprint,
    ).toBeUndefined();
  });

  it('현재 요청 context는 백필된 teamId와 함께 통과한다', async () => {
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    const claimed = provisionContext({
      teamId: 'synthetic-backfilled-team',
    });
    state.loadContext.mockResolvedValueOnce(claimed).mockResolvedValueOnce({
      ...claimed,
      repository: PROVISION_REPOSITORY,
      currentRepositorySource: RepositorySource.ORG_PROVISIONED,
    });
    const github = githubClientMock();
    const worker = new RepositoryProvisionWorker(
      jobs,
      state,
      github,
      { enrollExternalRepository: jest.fn() },
      OPTIONS,
    );

    const result = await worker.runNext(
      'worker-legacy-null-team',
      PROVISION_NOW,
    );

    expect(result).toEqual({
      kind: 'SUCCEEDED',
      jobId: 'synthetic-job-id',
      repositoryId: PROVISION_REPOSITORY.id,
    });
    expect(state.recordRepository.mock.calls).toHaveLength(1);
  });

  it('OWN 요청에 repository URL이 없으면 URL 계약 오류로 거부한다', async () => {
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    state.loadContext.mockResolvedValue(
      provisionContext({
        requestedConnectionMode: 'OWN',
        requestedRepositoryUrl: null,
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

    const result = await worker.runNext(
      'worker-own-missing-url',
      PROVISION_NOW,
    );

    expect(result).toEqual({
      kind: 'FAILED_FINAL',
      jobId: 'synthetic-job-id',
      errorCode: PROVISION_ERROR_CODES.OWN_REPOSITORY_URL_INVALID,
    });
    expect(github.findRepository.mock.calls).toHaveLength(0);
    expect(state.failJob.mock.calls[0]?.[0].final).toBe(true);
  });

  it('GitHub 5xx는 지수 backoff 뒤 재시도한다', async () => {
    const jobs = jobRepositoryMock();
    jobs.claimNext.mockResolvedValue({
      id: 'synthetic-job-id',
      applicationId: 'synthetic-application-id',
      requestId: 'synthetic-request-id',
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

    const result = await worker.runNext('worker-b', PROVISION_NOW);

    expect(result.kind).toBe('FAILED_RETRYABLE');
    expect(state.failJob.mock.calls[0]?.[0]).toMatchObject({
      requestId: 'synthetic-request-id',
      final: false,
      nextAttemptAt: new Date('2026-07-22T00:02:00.000Z'),
    });
  });

  it('생성 응답이 public이면 기록과 초대 없이 최종 실패한다', async () => {
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

    const result = await worker.runNext('worker-public-create', PROVISION_NOW);

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

    const result = await worker.runNext(
      'worker-public-recovery',
      PROVISION_NOW,
    );

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

    await worker.runNext('worker-c', PROVISION_NOW);

    expect(state.failJob.mock.calls[0]?.[0].nextAttemptAt).toEqual(
      new Date('2026-07-22T00:10:00.000Z'),
    );
  });

  it('최대 시도 횟수의 재시도 오류는 최종 실패로 전환한다', async () => {
    const jobs = jobRepositoryMock();
    jobs.claimNext.mockResolvedValue({
      id: 'synthetic-job-id',
      applicationId: 'synthetic-application-id',
      requestId: 'synthetic-request-id',
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

    const result = await worker.runNext('worker-d', PROVISION_NOW);

    expect(result.kind).toBe('FAILED_FINAL');
    expect(state.failJob.mock.calls[0]?.[0].final).toBe(true);
  });

  it('일부 invitation 실패는 해당 대상과 job만 재시도로 남긴다', async () => {
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    state.loadContext.mockResolvedValue(
      provisionContext({
        repository: PROVISION_REPOSITORY,
        currentRepositorySource: RepositorySource.ORG_PROVISIONED,
      }),
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

    const result = await worker.runNext('worker-e', PROVISION_NOW);

    expect(result.kind).toBe('FAILED_RETRYABLE');
    expect(github.createRepository.mock.calls).toHaveLength(0);
    expect(state.failInvitation.mock.calls[0]?.[0]).toMatchObject({
      requestId: 'synthetic-request-id',
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
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    state.loadContext.mockResolvedValue(
      provisionContext({
        repository: PROVISION_REPOSITORY,
        currentRepositorySource: RepositorySource.ORG_PROVISIONED,
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

    const result = await worker.runNext('worker-fail-guard', PROVISION_NOW);

    expect(result.kind).toBe('FAILED_RETRYABLE');
    expect(state.failJob.mock.calls[0]?.[0]).toMatchObject({
      requestId: 'synthetic-request-id',
      final: false,
      expectedMembershipFingerprint: MEMBERSHIP_FINGERPRINT,
    });
    expect(state.completeJob.mock.calls).toHaveLength(0);
  });

  it('최종 실패로 끝나는 관리형 job도 지문 가드를 빼지 않는다', async () => {
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    state.loadContext.mockResolvedValue(
      provisionContext({
        repository: PROVISION_REPOSITORY,
        currentRepositorySource: RepositorySource.ORG_PROVISIONED,
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

    const result = await worker.runNext(
      'worker-fail-final-guard',
      PROVISION_NOW,
    );

    expect(result.kind).toBe('FAILED_FINAL');
    expect(state.failJob.mock.calls[0]?.[0]).toMatchObject({
      requestId: 'synthetic-request-id',
      final: true,
      expectedMembershipFingerprint: MEMBERSHIP_FINGERPRINT,
    });
  });

  it('OWN 연결 실패는 지문을 넘기지 않는다', async () => {
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

    const result = await worker.runNext('worker-own-fail-guard', PROVISION_NOW);

    expect(result.kind).toBe('FAILED_FINAL');
    expect(
      state.failJob.mock.calls[0]?.[0].expectedMembershipFingerprint,
    ).toBeUndefined();
  });

  it('context를 읽기 전 lease를 잃으면 job 실패를 아예 기록하지 않는다', async () => {
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

    const result = worker.runNext('worker-fenced-load', PROVISION_NOW);

    await expect(result).rejects.toBeInstanceOf(
      RepositoryProvisionLeaseLostError,
    );
    expect(state.failJob.mock.calls).toHaveLength(0);
  });
});

describe('RepositoryProvisionWorker revocation failure', () => {
  it('이미 REVOKED인 행의 주기 재확인 실패도 회수 의도로 기록한다', async () => {
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    state.loadContext.mockResolvedValue(
      provisionContext({
        repository: PROVISION_REPOSITORY,
        currentRepositorySource: RepositorySource.ORG_PROVISIONED,
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

    const result = await worker.runNext('worker-reverify', PROVISION_NOW);

    expect(result.kind).toBe('FAILED_RETRYABLE');
    expect(github.revokeCollaborator.mock.calls).toEqual([
      [PROVISION_REPOSITORY.name, 'synthetic-left'],
    ]);
    expect(state.failInvitation.mock.calls[0]?.[0]).toMatchObject({
      requestId: 'synthetic-request-id',
      invitationId: 'synthetic-revoke-reverify',
      expectedStatus: RepositoryInvitationStatus.REVOKED,
      intent: 'REVOKE',
    });
  });

  it('한 대상의 회수 실패가 다른 대상의 회수를 막지 않는다', async () => {
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    state.loadContext.mockResolvedValue(
      provisionContext({
        repository: PROVISION_REPOSITORY,
        currentRepositorySource: RepositorySource.ORG_PROVISIONED,
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

    const result = await worker.runNext('worker-revoke-partial', PROVISION_NOW);

    expect(result.kind).toBe('FAILED_RETRYABLE');
    expect(github.revokeCollaborator.mock.calls).toEqual([
      [PROVISION_REPOSITORY.name, 'synthetic-left-a'],
      [PROVISION_REPOSITORY.name, 'synthetic-left-b'],
    ]);
    expect(state.completeInvitation.mock.calls).toHaveLength(1);
    expect(state.completeInvitation.mock.calls[0]?.[0]).toMatchObject({
      requestId: 'synthetic-request-id',
      invitationId: 'synthetic-revoke-b',
      status: RepositoryInvitationStatus.REVOKED,
    });
    expect(state.failInvitation.mock.calls[0]?.[0]).toMatchObject({
      requestId: 'synthetic-request-id',
      invitationId: 'synthetic-revoke-a',
      repositoryId: PROVISION_REPOSITORY.id,
      expectedStatus: RepositoryInvitationStatus.REVOKE_REQUIRED,
      intent: 'REVOKE',
      final: false,
      errorCode: GITHUB_OPERATIONS_ERROR_CODES.UPSTREAM,
    });

    expect(github.ensureCollaborator.mock.calls).toHaveLength(0);
    expect(state.completeJob.mock.calls).toHaveLength(0);
    expect(state.failJob.mock.calls[0]?.[0]).toMatchObject({
      requestId: 'synthetic-request-id',
      final: false,
      errorCode: GITHUB_OPERATIONS_ERROR_CODES.UPSTREAM,
    });
  });

  it('회수 중 lease를 잃으면 남은 회수를 시도하지 않고 즉시 중단한다', async () => {
    const jobs = jobRepositoryMock();
    jobs.renewLease
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new RepositoryProvisionLeaseLostError());
    const state = provisionStateMock();
    state.loadContext.mockResolvedValue(
      provisionContext({
        repository: PROVISION_REPOSITORY,
        currentRepositorySource: RepositorySource.ORG_PROVISIONED,
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

    const result = worker.runNext('worker-revoke-fenced', PROVISION_NOW);

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
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    state.loadContext.mockResolvedValue(
      provisionContext({
        repository: PROVISION_REPOSITORY,
        currentRepositorySource: RepositorySource.ORG_PROVISIONED,
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

    const result = await worker.runNext('worker-revoke-final', PROVISION_NOW);

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
