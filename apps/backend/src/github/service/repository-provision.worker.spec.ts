import { RepositoryInvitationStatus, RepositorySource } from '@prisma/client';
import {
  CURRENT_MEMBER_GITHUB_LOGINS,
  githubClientMock,
  grantInvitationWork,
  jobRepositoryMock,
  MEMBERSHIP_FINGERPRINT,
  OWN_PROVISION_REPOSITORY,
  OWN_REPOSITORY_URL,
  ownProvisionContext,
  PROVISION_NOW,
  PROVISION_REPOSITORY,
  provisionContext,
  provisionStateMock,
  revokeInvitationWork,
} from '../../../test/repository-provision-worker.fixture';
import {
  DEFAULT_PROVISION_INVITATION_RECONCILIATION_INTERVAL_MS,
  PROVISION_ERROR_CODES,
  RepositoryProvisionFailure,
} from '../domain/repository-provision.failure';
import { COLLABORATOR_OUTCOMES } from '../gateway/github-app.client';
import { RepositoryProvisionWorker } from './repository-provision.worker';
import { buildRepositoryOwnershipMarker } from '../domain/repository-name';
import {
  PROVISION_MEMBERSHIP_UNAVAILABLE_ERROR_CODE,
  RepositoryProvisionSupersededError,
} from '../repository/repository-provision-state.helpers';

describe('RepositoryProvisionWorker success', () => {
  it('실행 가능한 job이 없으면 외부 호출을 하지 않는다', async () => {
    const jobs = jobRepositoryMock();
    jobs.claimNext.mockResolvedValue(null);
    const state = provisionStateMock();
    const github = githubClientMock();
    const worker = new RepositoryProvisionWorker(jobs, state, github, {
      enrollExternalRepository: jest.fn(),
    });

    const result = await worker.runNext('worker-a', PROVISION_NOW);

    expect(result).toEqual({ kind: 'EMPTY' });
    expect(state.loadContext.mock.calls).toHaveLength(0);
    expect(github.findRepository.mock.calls).toHaveLength(0);
  });

  it('세대가 넘어간 worker는 후속 job을 쓰지 않고 자기 요청만 SUPERSEDED로 닫는다', async () => {
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    state.loadContext.mockRejectedValue(
      new RepositoryProvisionSupersededError('synthetic-request-id'),
    );
    const github = githubClientMock();
    const worker = new RepositoryProvisionWorker(jobs, state, github, {
      enrollExternalRepository: jest.fn(),
    });

    await expect(worker.runNext('worker-a', PROVISION_NOW)).resolves.toEqual({
      kind: 'SUPERSEDED',
      jobId: 'synthetic-job-id',
      requestId: 'synthetic-request-id',
    });
    expect(state.recordSupersededRequest.mock.calls).toEqual([
      ['synthetic-application-id', 'synthetic-request-id', PROVISION_NOW],
    ]);
    expect(state.failJob.mock.calls).toHaveLength(0);
    expect(github.createRepository.mock.calls).toHaveLength(0);
  });

  it('private 저장소를 먼저 기록하고 현재 팀원만 초대한다', async () => {
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    const recordedFingerprint = 'recorded-membership-fingerprint';
    state.loadContext
      .mockResolvedValueOnce(provisionContext())
      .mockResolvedValueOnce(
        provisionContext({
          repository: PROVISION_REPOSITORY,
          currentRepositorySource: RepositorySource.ORG_PROVISIONED,
          membershipFingerprint: recordedFingerprint,
        }),
      );
    const github = githubClientMock();
    github.ensureCollaborator
      .mockResolvedValueOnce(COLLABORATOR_OUTCOMES.PENDING)
      .mockResolvedValueOnce(COLLABORATOR_OUTCOMES.SUCCEEDED);
    const worker = new RepositoryProvisionWorker(jobs, state, github, {
      enrollExternalRepository: jest.fn(),
    });

    const result = await worker.runNext('worker-a', PROVISION_NOW);

    expect(result).toEqual({
      kind: 'SUCCEEDED',
      jobId: 'synthetic-job-id',
      repositoryId: PROVISION_REPOSITORY.id,
    });
    expect(
      state.recordRepository.mock.invocationCallOrder[0] ?? 0,
    ).toBeLessThan(state.prepareInvitations.mock.invocationCallOrder[0] ?? 0);
    expect(jobs.renewLease.mock.invocationCallOrder[0] ?? 0).toBeLessThan(
      github.createRepository.mock.invocationCallOrder[0] ?? 0,
    );
    expect(jobs.renewLease.mock.calls).toHaveLength(3);
    expect(jobs.renewLease).toHaveBeenCalledWith(
      'synthetic-job-id',
      'worker-a',
      'synthetic-request-id',
      PROVISION_NOW,
    );
    expect(state.loadContext.mock.calls).toHaveLength(2);

    expect(state.prepareInvitations.mock.calls[0]).toEqual([
      'synthetic-job-id',
      'worker-a',
      'synthetic-request-id',
      PROVISION_REPOSITORY.id,
      [...CURRENT_MEMBER_GITHUB_LOGINS],
    ]);
    expect(
      state.completeInvitation.mock.calls.map(([input]) => input.status),
    ).toEqual([
      RepositoryInvitationStatus.PENDING,
      RepositoryInvitationStatus.SUCCEEDED,
    ]);

    expect(state.completeJob.mock.calls).toEqual([
      [
        'synthetic-job-id',
        'worker-a',
        'synthetic-request-id',
        PROVISION_REPOSITORY.id,
        PROVISION_NOW,
        new Date(
          PROVISION_NOW.getTime() +
            DEFAULT_PROVISION_INVITATION_RECONCILIATION_INTERVAL_MS,
        ),
        recordedFingerprint,
      ],
    ]);
  });

  it('대기 초대가 하나도 없어도 다음 재조회 시각을 남긴다', async () => {
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    state.loadContext
      .mockResolvedValueOnce(provisionContext())
      .mockResolvedValueOnce(
        provisionContext({
          repository: PROVISION_REPOSITORY,
          currentRepositorySource: RepositorySource.ORG_PROVISIONED,
        }),
      );
    const github = githubClientMock();
    github.ensureCollaborator.mockResolvedValue(
      COLLABORATOR_OUTCOMES.SUCCEEDED,
    );
    const worker = new RepositoryProvisionWorker(jobs, state, github, {
      enrollExternalRepository: jest.fn(),
    });

    await worker.runNext('worker-recurring', PROVISION_NOW);

    expect(state.completeJob.mock.calls[0]?.[5]).toEqual(
      new Date(
        PROVISION_NOW.getTime() +
          DEFAULT_PROVISION_INVITATION_RECONCILIATION_INTERVAL_MS,
      ),
    );
    expect(state.completeJob.mock.calls[0]?.[6]).toBe(MEMBERSHIP_FINGERPRINT);
  });

  it('요청 당시 팀원이었어도 팀에서 빠진 login은 초대하지 않고 회수한다', async () => {
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    state.loadContext.mockResolvedValue(
      provisionContext({
        repository: PROVISION_REPOSITORY,
        currentRepositorySource: RepositorySource.ORG_PROVISIONED,
        currentMemberGithubLogins: ['synthetic-leader'],
      }),
    );
    state.findInvitationWork.mockResolvedValue([
      revokeInvitationWork({
        id: 'synthetic-invitation-left',
        githubLogin: 'synthetic-student',
      }),
      grantInvitationWork({
        id: 'synthetic-invitation-leader',
        githubLogin: 'synthetic-leader',
      }),
    ]);
    const github = githubClientMock();
    const worker = new RepositoryProvisionWorker(jobs, state, github, {
      enrollExternalRepository: jest.fn(),
    });

    await worker.runNext('worker-revoke', PROVISION_NOW);

    expect(state.loadContext.mock.calls).toHaveLength(1);
    expect(state.prepareInvitations.mock.calls[0]?.[4]).toEqual([
      'synthetic-leader',
    ]);
    expect(github.revokeCollaborator.mock.calls).toEqual([
      [PROVISION_REPOSITORY.name, 'synthetic-student'],
    ]);
    expect(github.ensureCollaborator.mock.calls).toEqual([
      [PROVISION_REPOSITORY.name, 'synthetic-leader'],
    ]);
    expect(state.completeInvitation.mock.calls[0]?.[0]).toMatchObject({
      requestId: 'synthetic-request-id',
      invitationId: 'synthetic-invitation-left',
      repositoryId: PROVISION_REPOSITORY.id,
      expectedStatus: RepositoryInvitationStatus.REVOKE_REQUIRED,
      status: RepositoryInvitationStatus.REVOKED,
    });
  });

  it('회수를 모두 끝낸 뒤에 부여를 진행한다', async () => {
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    state.loadContext.mockResolvedValue(
      provisionContext({
        repository: PROVISION_REPOSITORY,
        currentRepositorySource: RepositorySource.ORG_PROVISIONED,
        currentMemberGithubLogins: ['synthetic-new'],
      }),
    );
    state.findInvitationWork.mockResolvedValue([
      grantInvitationWork({
        id: 'synthetic-invitation-new',
        githubLogin: 'synthetic-new',
      }),
      revokeInvitationWork({
        id: 'synthetic-invitation-left',
        githubLogin: 'synthetic-left',
      }),
    ]);
    const github = githubClientMock();
    const worker = new RepositoryProvisionWorker(jobs, state, github, {
      enrollExternalRepository: jest.fn(),
    });

    await worker.runNext('worker-order', PROVISION_NOW);

    expect(
      github.revokeCollaborator.mock.invocationCallOrder[0] ?? 0,
    ).toBeLessThan(github.ensureCollaborator.mock.invocationCallOrder[0] ?? 0);
  });

  it('현재 팀원이 한 명도 없으면 모든 기존 권한을 회수한다', async () => {
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
        id: 'synthetic-invitation-a',
        githubLogin: 'synthetic-leader',
      }),
      revokeInvitationWork({
        id: 'synthetic-invitation-b',
        githubLogin: 'synthetic-student',
      }),
    ]);
    const github = githubClientMock();
    const worker = new RepositoryProvisionWorker(jobs, state, github, {
      enrollExternalRepository: jest.fn(),
    });

    const result = await worker.runNext('worker-empty-team', PROVISION_NOW);

    expect(result.kind).toBe('SUCCEEDED');
    expect(state.prepareInvitations.mock.calls[0]?.[4]).toEqual([]);
    expect(github.revokeCollaborator.mock.calls).toEqual([
      [PROVISION_REPOSITORY.name, 'synthetic-leader'],
      [PROVISION_REPOSITORY.name, 'synthetic-student'],
    ]);
    expect(github.ensureCollaborator.mock.calls).toHaveLength(0);
  });

  it('회수 뒤 재가입한 팀원은 다시 초대한다', async () => {
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    state.loadContext.mockResolvedValue(
      provisionContext({
        repository: PROVISION_REPOSITORY,
        currentRepositorySource: RepositorySource.ORG_PROVISIONED,
        currentMemberGithubLogins: ['synthetic-student'],
      }),
    );
    state.findInvitationWork.mockResolvedValue([
      grantInvitationWork({
        id: 'synthetic-invitation-rejoined',
        githubLogin: 'synthetic-student',
      }),
    ]);
    const github = githubClientMock();
    const worker = new RepositoryProvisionWorker(jobs, state, github, {
      enrollExternalRepository: jest.fn(),
    });

    await worker.runNext('worker-rejoin', PROVISION_NOW);

    expect(github.revokeCollaborator.mock.calls).toHaveLength(0);
    expect(github.ensureCollaborator.mock.calls).toEqual([
      [PROVISION_REPOSITORY.name, 'synthetic-student'],
    ]);
  });

  it('회수 전에도 lease를 갱신한다', async () => {
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
    const worker = new RepositoryProvisionWorker(jobs, state, github, {
      enrollExternalRepository: jest.fn(),
    });

    await worker.runNext('worker-revoke-lease', PROVISION_NOW);

    expect(jobs.renewLease.mock.calls).toHaveLength(1);
    expect(jobs.renewLease).toHaveBeenCalledWith(
      'synthetic-job-id',
      'worker-revoke-lease',
      'synthetic-request-id',
      PROVISION_NOW,
    );
    expect(jobs.renewLease.mock.invocationCallOrder[0] ?? 0).toBeLessThan(
      github.revokeCollaborator.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('DB에 저장된 repository가 있으면 생성 없이 실패 대상만 처리한다', async () => {
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
        status: RepositoryInvitationStatus.FAILED_RETRYABLE,
      }),
    ]);
    const github = githubClientMock();
    const worker = new RepositoryProvisionWorker(jobs, state, github, {
      enrollExternalRepository: jest.fn(),
    });

    await worker.runNext('worker-b', PROVISION_NOW);

    expect(state.loadContext.mock.calls).toHaveLength(1);
    expect(github.findRepository.mock.calls).toHaveLength(0);
    expect(github.createRepository.mock.calls).toHaveLength(0);
    expect(github.ensureCollaborator.mock.calls).toEqual([
      [PROVISION_REPOSITORY.name, 'synthetic-student'],
    ]);
  });

  it('현재 연결 저장소에만 초대를 보내고 이전 저장소의 성공 초대는 쓰지 않는다', async () => {
    const currentRepository = {
      ...PROVISION_REPOSITORY,
      id: 'synthetic-current-repository-id',
      githubRepositoryId: 222_333_444n,
      name: 'synthetic-current-repo',
    };
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    state.loadContext.mockResolvedValue(
      provisionContext({
        repository: currentRepository,
        currentRepositorySource: RepositorySource.ORG_PROVISIONED,
      }),
    );
    state.findInvitationWork.mockResolvedValue([
      grantInvitationWork({
        id: 'synthetic-current-invitation',
        githubLogin: 'synthetic-student',
      }),
    ]);
    const github = githubClientMock();
    github.ensureCollaborator.mockResolvedValue(
      COLLABORATOR_OUTCOMES.SUCCEEDED,
    );
    const worker = new RepositoryProvisionWorker(jobs, state, github, {
      enrollExternalRepository: jest.fn(),
    });

    const result = await worker.runNext('worker-current-link', PROVISION_NOW);

    expect(result).toEqual({
      kind: 'SUCCEEDED',
      jobId: 'synthetic-job-id',
      repositoryId: currentRepository.id,
    });
    expect(state.prepareInvitations.mock.calls).toEqual([
      [
        'synthetic-job-id',
        'worker-current-link',
        'synthetic-request-id',
        currentRepository.id,
        [...CURRENT_MEMBER_GITHUB_LOGINS],
      ],
    ]);
    expect(state.findInvitationWork.mock.calls).toEqual([
      [
        'synthetic-job-id',
        'worker-current-link',
        'synthetic-request-id',
        currentRepository.id,
      ],
    ]);
    expect(github.ensureCollaborator.mock.calls).toEqual([
      [currentRepository.name, 'synthetic-student'],
    ]);
    expect(state.completeInvitation.mock.calls[0]?.[0]).toMatchObject({
      invitationId: 'synthetic-current-invitation',
      repositoryId: currentRepository.id,
      status: RepositoryInvitationStatus.SUCCEEDED,
    });
    expect(state.completeJob.mock.calls[0]?.[3]).toBe(currentRepository.id);
    expect(github.createRepository.mock.calls).toHaveLength(0);
  });

  it('원래 NEW 이벤트여도 현재 행이 EXTERNAL_PUBLIC이면 관리형 초대를 건너뛴다', async () => {
    const currentRepository = {
      ...OWN_PROVISION_REPOSITORY,
      id: 'synthetic-external-current-id',
    };
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    state.loadContext.mockResolvedValue(
      provisionContext({
        repository: currentRepository,
        currentRepositorySource: RepositorySource.EXTERNAL_PUBLIC,
      }),
    );
    const github = githubClientMock();
    const worker = new RepositoryProvisionWorker(jobs, state, github, {
      enrollExternalRepository: jest.fn(),
    });

    const result = await worker.runNext('worker-new-external', PROVISION_NOW);

    expect(result).toEqual({
      kind: 'SUCCEEDED',
      jobId: 'synthetic-job-id',
      repositoryId: currentRepository.id,
    });
    expect(state.prepareInvitations.mock.calls).toHaveLength(0);
    expect(github.ensureCollaborator.mock.calls).toHaveLength(0);
    expect(github.revokeCollaborator.mock.calls).toHaveLength(0);
    expect(github.findPublicRepository.mock.calls).toHaveLength(0);
    expect(github.createRepository.mock.calls).toHaveLength(0);
    expect(state.completeJob.mock.calls).toEqual([
      [
        'synthetic-job-id',
        'worker-new-external',
        'synthetic-request-id',
        currentRepository.id,
        PROVISION_NOW,
      ],
    ]);
  });

  it('원래 OWN 이벤트여도 현재 행이 ORG_PROVISIONED이면 현재 저장소에 초대한다', async () => {
    const currentRepository = {
      ...PROVISION_REPOSITORY,
      id: 'synthetic-managed-current-id',
      name: 'synthetic-managed-current',
    };
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    state.loadContext.mockResolvedValue(
      ownProvisionContext({
        repository: currentRepository,
        currentRepositorySource: RepositorySource.ORG_PROVISIONED,
      }),
    );
    state.findInvitationWork.mockResolvedValue([
      grantInvitationWork({
        id: 'synthetic-managed-current-invitation',
        githubLogin: 'synthetic-student',
      }),
    ]);
    const github = githubClientMock();
    github.ensureCollaborator.mockResolvedValue(
      COLLABORATOR_OUTCOMES.SUCCEEDED,
    );
    const worker = new RepositoryProvisionWorker(jobs, state, github, {
      enrollExternalRepository: jest.fn(),
    });

    const result = await worker.runNext('worker-own-managed', PROVISION_NOW);

    expect(result).toEqual({
      kind: 'SUCCEEDED',
      jobId: 'synthetic-job-id',
      repositoryId: currentRepository.id,
    });
    expect(state.prepareInvitations.mock.calls).toEqual([
      [
        'synthetic-job-id',
        'worker-own-managed',
        'synthetic-request-id',
        currentRepository.id,
        [...CURRENT_MEMBER_GITHUB_LOGINS],
      ],
    ]);
    expect(github.ensureCollaborator.mock.calls).toEqual([
      [currentRepository.name, 'synthetic-student'],
    ]);
    expect(github.findPublicRepository.mock.calls).toHaveLength(0);
    expect(state.completeJob.mock.calls).toEqual([
      [
        'synthetic-job-id',
        'worker-own-managed',
        'synthetic-request-id',
        currentRepository.id,
        PROVISION_NOW,
        new Date(
          PROVISION_NOW.getTime() +
            DEFAULT_PROVISION_INVITATION_RECONCILIATION_INTERVAL_MS,
        ),
        MEMBERSHIP_FINGERPRINT,
      ],
    ]);
  });

  it('생성 직후 중단된 재시도는 같은 이름의 원격 저장소를 이어 쓴다', async () => {
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    state.loadContext
      .mockResolvedValueOnce(provisionContext())
      .mockResolvedValueOnce(
        provisionContext({
          repository: PROVISION_REPOSITORY,
          currentRepositorySource: RepositorySource.ORG_PROVISIONED,
        }),
      );
    const github = githubClientMock();
    github.findRepository.mockResolvedValue({
      githubRepositoryId: PROVISION_REPOSITORY.githubRepositoryId,
      name: PROVISION_REPOSITORY.name,
      url: PROVISION_REPOSITORY.url,
      nameWithOwner: `synthetic-org/${PROVISION_REPOSITORY.name}`,
      visibility: PROVISION_REPOSITORY.visibility,
      description: buildRepositoryOwnershipMarker('synthetic-application-id'),
    });
    const worker = new RepositoryProvisionWorker(jobs, state, github, {
      enrollExternalRepository: jest.fn(),
    });

    await worker.runNext('worker-c', PROVISION_NOW);

    expect(github.createRepository.mock.calls).toHaveLength(0);
    expect(
      state.recordRepository.mock.calls[0]?.[0].metadata.githubRepositoryId,
    ).toBe(PROVISION_REPOSITORY.githubRepositoryId);
  });

  it('현재 요청 context는 백필된 teamId와 함께 성공한다', async () => {
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
    const worker = new RepositoryProvisionWorker(jobs, state, github, {
      enrollExternalRepository: jest.fn(),
    });

    const result = await worker.runNext(
      'worker-legacy-null-team',
      PROVISION_NOW,
    );

    expect(result).toEqual({
      kind: 'SUCCEEDED',
      jobId: 'synthetic-job-id',
      repositoryId: PROVISION_REPOSITORY.id,
    });
  });
});

describe('RepositoryProvisionWorker OWN connection', () => {
  it('설정 조직 OWN 저장소는 기록된 관리형 source로 초대하고 재조회를 남긴다', async () => {
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    const repositoryUrl =
      'https://github.com/synthetic-org/synthetic-existing-repo';
    const claimed = ownProvisionContext({
      requestedRepositoryUrl: repositoryUrl,
    });
    const provisioned = {
      ...OWN_PROVISION_REPOSITORY,
      name: 'synthetic-existing-repo',
      url: repositoryUrl,
      visibility: 'PRIVATE' as const,
    };
    const recordedFingerprint = 'recorded-org-own-fingerprint';
    state.loadContext.mockResolvedValueOnce(claimed).mockResolvedValueOnce({
      ...claimed,
      repository: provisioned,
      currentRepositorySource: RepositorySource.ORG_PROVISIONED,
      membershipFingerprint: recordedFingerprint,
    });
    state.recordRepository.mockResolvedValue(provisioned);
    state.findInvitationWork.mockResolvedValue([
      grantInvitationWork({
        id: 'synthetic-org-own-invitation',
        githubLogin: 'synthetic-student',
      }),
    ]);
    const github = githubClientMock();
    github.findRepository.mockResolvedValue({
      githubRepositoryId: provisioned.githubRepositoryId,
      name: provisioned.name,
      url: repositoryUrl,
      nameWithOwner: `synthetic-org/${provisioned.name}`,
      visibility: 'PRIVATE',
      description: null,
    });
    github.ensureCollaborator.mockResolvedValue(COLLABORATOR_OUTCOMES.PENDING);
    const enrollExternalRepository = jest.fn();
    const worker = new RepositoryProvisionWorker(jobs, state, github, {
      enrollExternalRepository,
    });

    const result = await worker.runNext('worker-org-own', PROVISION_NOW);

    expect(result).toEqual({
      kind: 'SUCCEEDED',
      jobId: 'synthetic-job-id',
      repositoryId: provisioned.id,
    });
    expect(github.findRepository).toHaveBeenCalledWith(provisioned.name);
    expect(github.findPublicRepository).not.toHaveBeenCalled();
    expect(enrollExternalRepository).not.toHaveBeenCalled();

    expect(state.recordRepository.mock.calls[0]?.[0].source).toBe(
      RepositorySource.ORG_PROVISIONED,
    );
    expect(state.prepareInvitations.mock.calls).toEqual([
      [
        'synthetic-job-id',
        'worker-org-own',
        'synthetic-request-id',
        provisioned.id,
        [...CURRENT_MEMBER_GITHUB_LOGINS],
      ],
    ]);
    expect(github.ensureCollaborator.mock.calls).toEqual([
      [provisioned.name, 'synthetic-student'],
    ]);
    expect(state.completeInvitation.mock.calls[0]?.[0]).toMatchObject({
      invitationId: 'synthetic-org-own-invitation',
      repositoryId: provisioned.id,
      status: RepositoryInvitationStatus.PENDING,
    });
    expect(state.completeJob.mock.calls).toEqual([
      [
        'synthetic-job-id',
        'worker-org-own',
        'synthetic-request-id',
        provisioned.id,
        PROVISION_NOW,
        new Date(
          PROVISION_NOW.getTime() +
            DEFAULT_PROVISION_INVITATION_RECONCILIATION_INTERVAL_MS,
        ),
        recordedFingerprint,
      ],
    ]);
    expect(state.loadContext.mock.calls).toHaveLength(2);
  });

  it('OWN이 조직 저장소로 기록된 뒤 팀을 못 읽으면 초대 없이 최종 실패한다', async () => {
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    const repositoryUrl =
      'https://github.com/synthetic-org/synthetic-existing-repo';
    const claimed = ownProvisionContext({
      requestedRepositoryUrl: repositoryUrl,
    });
    const provisioned = {
      ...OWN_PROVISION_REPOSITORY,
      name: 'synthetic-existing-repo',
      url: repositoryUrl,
      visibility: 'PRIVATE' as const,
    };
    state.loadContext
      .mockResolvedValueOnce(claimed)
      .mockRejectedValueOnce(
        new RepositoryProvisionFailure(
          PROVISION_MEMBERSHIP_UNAVAILABLE_ERROR_CODE,
          false,
        ),
      );
    state.recordRepository.mockResolvedValue(provisioned);
    const github = githubClientMock();
    github.findRepository.mockResolvedValue({
      githubRepositoryId: provisioned.githubRepositoryId,
      name: provisioned.name,
      url: repositoryUrl,
      nameWithOwner: `synthetic-org/${provisioned.name}`,
      visibility: 'PRIVATE',
      description: null,
    });
    const worker = new RepositoryProvisionWorker(jobs, state, github, {
      enrollExternalRepository: jest.fn(),
    });

    const result = await worker.runNext(
      'worker-org-own-no-team',
      PROVISION_NOW,
    );

    expect(result).toEqual({
      kind: 'FAILED_FINAL',
      jobId: 'synthetic-job-id',
      errorCode: PROVISION_MEMBERSHIP_UNAVAILABLE_ERROR_CODE,
    });
    expect(state.recordRepository.mock.calls).toHaveLength(1);
    expect(state.prepareInvitations.mock.calls).toHaveLength(0);
    expect(github.ensureCollaborator.mock.calls).toHaveLength(0);
    expect(state.completeJob.mock.calls).toHaveLength(0);
    expect(state.loadContext.mock.calls).toHaveLength(2);
    expect(state.failJob.mock.calls[0]?.[0]).toMatchObject({
      final: true,
      errorCode: PROVISION_MEMBERSHIP_UNAVAILABLE_ERROR_CODE,
      expectedMembershipFingerprint: undefined,
    });
  });

  it('OWN 승인은 저장소를 만들지 않고 학생 URL을 그대로 기록한다', async () => {
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    const claimed = ownProvisionContext();
    state.loadContext.mockResolvedValueOnce(claimed).mockResolvedValueOnce({
      ...claimed,
      repository: OWN_PROVISION_REPOSITORY,
      currentRepositorySource: RepositorySource.EXTERNAL_PUBLIC,
    });
    state.recordRepository.mockResolvedValue(OWN_PROVISION_REPOSITORY);
    const github = githubClientMock();
    github.findPublicRepository.mockResolvedValue({
      githubRepositoryId: OWN_PROVISION_REPOSITORY.githubRepositoryId,
      name: OWN_PROVISION_REPOSITORY.name,
      nameWithOwner: 'synthetic-student/synthetic-own-repo',
      url: 'https://github.com/Synthetic-Student/synthetic-own-repo',
      visibility: 'PUBLIC',
      archived: false,
      defaultBranch: 'main',
      description: null,
    });
    const enrollExternalRepository = jest.fn().mockResolvedValue(undefined);
    const worker = new RepositoryProvisionWorker(jobs, state, github, {
      enrollExternalRepository,
    });

    const result = await worker.runNext('worker-own', PROVISION_NOW);

    expect(result).toEqual({
      kind: 'SUCCEEDED',
      jobId: 'synthetic-job-id',
      repositoryId: OWN_PROVISION_REPOSITORY.id,
    });
    expect(github.createRepository.mock.calls).toHaveLength(0);
    expect(github.findRepository.mock.calls).toHaveLength(0);
    expect(github.findPublicRepository.mock.calls).toEqual([
      ['synthetic-student', 'synthetic-own-repo'],
    ]);
    expect(state.recordRepository.mock.calls[0]?.[0].metadata).toEqual({
      githubRepositoryId: OWN_PROVISION_REPOSITORY.githubRepositoryId,
      name: 'synthetic-own-repo',
      nameWithOwner: 'synthetic-student/synthetic-own-repo',
      url: OWN_REPOSITORY_URL,
      visibility: 'PUBLIC',
      archived: false,
      defaultBranch: 'main',
      description: null,
    });

    expect(state.recordRepository.mock.calls[0]?.[0].source).toBe(
      RepositorySource.EXTERNAL_PUBLIC,
    );
    expect(enrollExternalRepository.mock.calls).toEqual([
      [
        {
          applicantGithubId: 9_000_000_730_101n,
          githubRepositoryId: OWN_PROVISION_REPOSITORY.githubRepositoryId,
          nameWithOwner: 'synthetic-student/synthetic-own-repo',
          defaultBranch: 'main',
          archived: false,
          observedAt: PROVISION_NOW,
        },
      ],
    ]);
  });

  it('OWN 승인은 협업자 초대·회수·공개 전환을 시도하지 않는다', async () => {
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    const claimed = ownProvisionContext();
    state.loadContext.mockResolvedValueOnce(claimed).mockResolvedValueOnce({
      ...claimed,
      repository: OWN_PROVISION_REPOSITORY,
      currentRepositorySource: RepositorySource.EXTERNAL_PUBLIC,
    });
    state.recordRepository.mockResolvedValue(OWN_PROVISION_REPOSITORY);
    const github = githubClientMock();
    github.findPublicRepository.mockResolvedValue({
      githubRepositoryId: OWN_PROVISION_REPOSITORY.githubRepositoryId,
      name: OWN_PROVISION_REPOSITORY.name,
      nameWithOwner: 'synthetic-student/synthetic-own-repo',
      url: OWN_REPOSITORY_URL,
      visibility: 'PUBLIC',
      archived: false,
      defaultBranch: 'main',
      description: null,
    });
    const worker = new RepositoryProvisionWorker(jobs, state, github, {
      enrollExternalRepository: jest.fn(),
    });

    await worker.runNext('worker-own-no-write', PROVISION_NOW);

    expect(github.ensureCollaborator.mock.calls).toHaveLength(0);

    expect(github.revokeCollaborator.mock.calls).toHaveLength(0);
    expect(state.prepareInvitations.mock.calls).toHaveLength(0);
    expect(state.findInvitationWork.mock.calls).toHaveLength(0);
    expect(state.completeInvitation.mock.calls).toHaveLength(0);
    expect(state.failInvitation.mock.calls).toHaveLength(0);

    expect(state.completeJob.mock.calls).toEqual([
      [
        'synthetic-job-id',
        'worker-own-no-write',
        'synthetic-request-id',
        OWN_PROVISION_REPOSITORY.id,
        PROVISION_NOW,
      ],
    ]);
  });

  it('편입 뒤 job 완료가 실패해도 재시도에서 같은 저장소로 수렴한다', async () => {
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    const claimed = ownProvisionContext();
    const recorded = ownProvisionContext({
      repository: OWN_PROVISION_REPOSITORY,
      currentRepositorySource: RepositorySource.EXTERNAL_PUBLIC,
    });
    state.loadContext
      .mockResolvedValueOnce(claimed)
      .mockResolvedValueOnce(recorded)
      .mockResolvedValueOnce(recorded);
    state.recordRepository.mockResolvedValue(OWN_PROVISION_REPOSITORY);
    state.completeJob
      .mockRejectedValueOnce(new Error('synthetic completion failure'))
      .mockResolvedValueOnce(undefined);
    const github = githubClientMock();
    github.findPublicRepository.mockResolvedValue({
      githubRepositoryId: OWN_PROVISION_REPOSITORY.githubRepositoryId,
      name: OWN_PROVISION_REPOSITORY.name,
      nameWithOwner: 'synthetic-student/synthetic-own-repo',
      url: OWN_REPOSITORY_URL,
      visibility: 'PUBLIC',
      archived: false,
      defaultBranch: 'main',
      description: null,
    });
    const enrollExternalRepository = jest.fn().mockResolvedValue(undefined);
    const worker = new RepositoryProvisionWorker(jobs, state, github, {
      enrollExternalRepository,
    });

    await expect(
      worker.runNext('worker-own-first', PROVISION_NOW),
    ).resolves.toMatchObject({
      kind: 'FAILED_RETRYABLE',
    });
    await expect(
      worker.runNext('worker-own-retry', PROVISION_NOW),
    ).resolves.toEqual({
      kind: 'SUCCEEDED',
      jobId: 'synthetic-job-id',
      repositoryId: OWN_PROVISION_REPOSITORY.id,
    });

    expect(state.recordRepository.mock.calls).toHaveLength(1);

    expect(github.findPublicRepository.mock.calls).toHaveLength(1);
    expect(enrollExternalRepository).toHaveBeenCalledTimes(1);
    expect(state.failJob.mock.calls).toHaveLength(1);
  });

  it('재시도 중 URL이 다른 GitHub 저장소 id로 바뀌면 편입하지 않는다', async () => {
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    state.loadContext.mockResolvedValue(
      ownProvisionContext({
        repository: OWN_PROVISION_REPOSITORY,
        currentRepositorySource: RepositorySource.EXTERNAL_PUBLIC,
      }),
    );
    const github = githubClientMock();
    github.findPublicRepository.mockResolvedValue({
      githubRepositoryId: OWN_PROVISION_REPOSITORY.githubRepositoryId + 1n,
      name: OWN_PROVISION_REPOSITORY.name,
      nameWithOwner: 'synthetic-student/synthetic-own-repo',
      url: OWN_REPOSITORY_URL,
      visibility: 'PUBLIC',
      archived: false,
      defaultBranch: 'main',
      description: null,
    });
    const enrollExternalRepository = jest.fn();
    const worker = new RepositoryProvisionWorker(jobs, state, github, {
      enrollExternalRepository,
    });

    await expect(
      worker.runNext('worker-own-mismatch', PROVISION_NOW),
    ).resolves.toEqual({
      kind: 'SUCCEEDED',
      jobId: 'synthetic-job-id',
      repositoryId: OWN_PROVISION_REPOSITORY.id,
    });

    expect(github.findPublicRepository.mock.calls).toHaveLength(0);
    expect(enrollExternalRepository).not.toHaveBeenCalled();
    expect(state.completeJob.mock.calls).toHaveLength(1);
  });

  it('OWN + 존재하지 않는 저장소는 명확한 최종 실패다', async () => {
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    state.loadContext.mockResolvedValue(ownProvisionContext());
    const github = githubClientMock();
    github.findPublicRepository.mockResolvedValue(null);
    const worker = new RepositoryProvisionWorker(jobs, state, github, {
      enrollExternalRepository: jest.fn(),
    });

    const result = await worker.runNext('worker-own-missing', PROVISION_NOW);

    expect(result).toEqual({
      kind: 'FAILED_FINAL',
      jobId: 'synthetic-job-id',
      errorCode: PROVISION_ERROR_CODES.OWN_REPOSITORY_NOT_FOUND,
    });
    expect(github.createRepository.mock.calls).toHaveLength(0);
    expect(state.recordRepository.mock.calls).toHaveLength(0);
  });

  it('OWN + 이상한 URL은 거부한다', async () => {
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    state.loadContext.mockResolvedValue(
      ownProvisionContext({
        requestedRepositoryUrl: 'https://gitlab.com/synthetic/repo',
      }),
    );
    const github = githubClientMock();
    const worker = new RepositoryProvisionWorker(jobs, state, github, {
      enrollExternalRepository: jest.fn(),
    });

    const result = await worker.runNext('worker-own-bad-url', PROVISION_NOW);

    expect(result).toEqual({
      kind: 'FAILED_FINAL',
      jobId: 'synthetic-job-id',
      errorCode: PROVISION_ERROR_CODES.OWN_REPOSITORY_URL_INVALID,
    });
    expect(github.findPublicRepository.mock.calls).toHaveLength(0);
    expect(github.createRepository.mock.calls).toHaveLength(0);
  });
});
