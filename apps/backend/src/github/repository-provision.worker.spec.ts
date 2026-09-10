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
} from '../../test/repository-provision-worker.fixture';
import { DEFAULT_PROVISION_INVITATION_RECONCILIATION_INTERVAL_MS } from './repository-provision.failure';
import { COLLABORATOR_OUTCOMES } from './github-app.client';
import { RepositoryProvisionWorker } from './repository-provision.worker';
import { buildRepositoryOwnershipMarker } from './repository-name';
import { PROVISION_ERROR_CODES } from './repository-provision.failure';

describe('RepositoryProvisionWorker success', () => {
  it('실행 가능한 job이 없으면 외부 호출을 하지 않는다', async () => {
    // Given: claim 가능한 job이 없다.
    const jobs = jobRepositoryMock();
    jobs.claimNext.mockResolvedValue(null);
    const state = provisionStateMock();
    const github = githubClientMock();
    const worker = new RepositoryProvisionWorker(jobs, state, github, {
      enrollExternalRepository: jest.fn(),
    });

    // When: worker를 한 번 실행한다.
    const result = await worker.runNext('worker-a', PROVISION_NOW);

    // Then: 빈 결과로 끝나고 상태나 GitHub를 건드리지 않는다.
    expect(result).toEqual({ kind: 'EMPTY' });
    expect(state.loadContext.mock.calls).toHaveLength(0);
    expect(github.findRepository.mock.calls).toHaveLength(0);
  });

  it('private 저장소를 먼저 기록하고 현재 팀원만 초대한다', async () => {
    // Given: 승인된 신청과 현재 팀원 두 명이 있다.
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    const github = githubClientMock();
    github.ensureCollaborator
      .mockResolvedValueOnce(COLLABORATOR_OUTCOMES.PENDING)
      .mockResolvedValueOnce(COLLABORATOR_OUTCOMES.SUCCEEDED);
    const worker = new RepositoryProvisionWorker(jobs, state, github, {
      enrollExternalRepository: jest.fn(),
    });

    // When: provision job을 실행한다.
    const result = await worker.runNext('worker-a', PROVISION_NOW);

    // Then: 저장소를 기록한 뒤 snapshot 초대와 job 완료로 수렴한다.
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
    // 권한 대상은 이벤트 snapshot이 아니라 현재 팀원 목록이다.
    expect(state.prepareInvitations.mock.calls[0]).toEqual([
      'synthetic-job-id',
      'worker-a',
      PROVISION_REPOSITORY.id,
      [...CURRENT_MEMBER_GITHUB_LOGINS],
    ]);
    expect(
      state.completeInvitation.mock.calls.map(([input]) => input.status),
    ).toEqual([
      RepositoryInvitationStatus.PENDING,
      RepositoryInvitationStatus.SUCCEEDED,
    ]);
    // 관리형 저장소는 완료하면서 다음 재조회 시각과 반영한 팀원 지문을 함께 남긴다.
    expect(state.completeJob.mock.calls).toEqual([
      [
        'synthetic-job-id',
        'worker-a',
        PROVISION_REPOSITORY.id,
        PROVISION_NOW,
        new Date(
          PROVISION_NOW.getTime() +
            DEFAULT_PROVISION_INVITATION_RECONCILIATION_INTERVAL_MS,
        ),
        MEMBERSHIP_FINGERPRINT,
      ],
    ]);
  });

  it('대기 초대가 하나도 없어도 다음 재조회 시각을 남긴다', async () => {
    // Given: 모든 초대가 즉시 수락되어 대기 상태가 남지 않는다.
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    const github = githubClientMock();
    github.ensureCollaborator.mockResolvedValue(
      COLLABORATOR_OUTCOMES.SUCCEEDED,
    );
    const worker = new RepositoryProvisionWorker(jobs, state, github, {
      enrollExternalRepository: jest.fn(),
    });

    // When: provision job을 실행한다.
    await worker.runNext('worker-recurring', PROVISION_NOW);

    // Then: 팀 이탈은 초대 상태를 바꾸지 않으므로 재조회 예약을 끊지 않는다.
    expect(state.completeJob.mock.calls[0]?.[4]).toEqual(
      new Date(
        PROVISION_NOW.getTime() +
          DEFAULT_PROVISION_INVITATION_RECONCILIATION_INTERVAL_MS,
      ),
    );
    expect(state.completeJob.mock.calls[0]?.[5]).toBe(MEMBERSHIP_FINGERPRINT);
  });

  it('이벤트 payload에 남아 있어도 팀에서 빠진 login은 초대하지 않고 회수한다', async () => {
    // Given: 승인 시점 snapshot에는 있지만 지금은 팀에 없는 login이 있다.
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    state.loadContext.mockResolvedValue(
      provisionContext({
        repository: PROVISION_REPOSITORY,
        currentMemberGithubLogins: ['synthetic-leader'],
        eventPayload: {
          applicationId: 'synthetic-application-id',
          programId: 'synthetic-program-id',
          teamId: null,
          requestedAt: PROVISION_NOW.toISOString(),
          collaboratorGithubLogins: ['synthetic-leader', 'synthetic-student'],
        },
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

    // When: job을 실행한다.
    await worker.runNext('worker-revoke', PROVISION_NOW);

    // Then: 이탈자는 회수만, 남은 팀원은 부여만 받는다.
    expect(state.prepareInvitations.mock.calls[0]?.[3]).toEqual([
      'synthetic-leader',
    ]);
    expect(github.revokeCollaborator.mock.calls).toEqual([
      [PROVISION_REPOSITORY.name, 'synthetic-student'],
    ]);
    expect(github.ensureCollaborator.mock.calls).toEqual([
      [PROVISION_REPOSITORY.name, 'synthetic-leader'],
    ]);
    expect(state.completeInvitation.mock.calls[0]?.[0]).toMatchObject({
      invitationId: 'synthetic-invitation-left',
      repositoryId: PROVISION_REPOSITORY.id,
      expectedStatus: RepositoryInvitationStatus.REVOKE_REQUIRED,
      status: RepositoryInvitationStatus.REVOKED,
    });
  });

  it('회수를 모두 끝낸 뒤에 부여를 진행한다', async () => {
    // Given: 회수 한 건과 부여 한 건이 함께 남아 있고 목록은 부여가 앞에 온다.
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    state.loadContext.mockResolvedValue(
      provisionContext({
        repository: PROVISION_REPOSITORY,
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

    // When: job을 실행한다.
    await worker.runNext('worker-order', PROVISION_NOW);

    // Then: 목록 순서와 무관하게 회수가 먼저 나간다.
    expect(
      github.revokeCollaborator.mock.invocationCallOrder[0] ?? 0,
    ).toBeLessThan(github.ensureCollaborator.mock.invocationCallOrder[0] ?? 0);
  });

  it('현재 팀원이 한 명도 없으면 모든 기존 권한을 회수한다', async () => {
    // Given: 팀원이 전부 빠져 live 목록이 비었다.
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

    // When: job을 실행한다.
    const result = await worker.runNext('worker-empty-team', PROVISION_NOW);

    // Then: 빈 목록을 snapshot fallback으로 되돌리지 않고 전원 회수한다.
    expect(result.kind).toBe('SUCCEEDED');
    expect(state.prepareInvitations.mock.calls[0]?.[3]).toEqual([]);
    expect(github.revokeCollaborator.mock.calls).toEqual([
      [PROVISION_REPOSITORY.name, 'synthetic-leader'],
      [PROVISION_REPOSITORY.name, 'synthetic-student'],
    ]);
    expect(github.ensureCollaborator.mock.calls).toHaveLength(0);
  });

  it('회수 뒤 재가입한 팀원은 다시 초대한다', async () => {
    // Given: 한 번 회수됐던 login이 팀에 다시 들어와 부여 대상으로 돌아왔다.
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    state.loadContext.mockResolvedValue(
      provisionContext({
        repository: PROVISION_REPOSITORY,
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

    // When: job을 실행한다.
    await worker.runNext('worker-rejoin', PROVISION_NOW);

    // Then: 회수 이력이 있어도 재가입자는 다시 초대된다.
    expect(github.revokeCollaborator.mock.calls).toHaveLength(0);
    expect(github.ensureCollaborator.mock.calls).toEqual([
      [PROVISION_REPOSITORY.name, 'synthetic-student'],
    ]);
  });

  it('회수 전에도 lease를 갱신한다', async () => {
    // Given: 회수 대상 한 건만 남아 있다.
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
    const worker = new RepositoryProvisionWorker(jobs, state, github, {
      enrollExternalRepository: jest.fn(),
    });

    // When: job을 실행한다.
    await worker.runNext('worker-revoke-lease', PROVISION_NOW);

    // Then: 네트워크 호출 전에 lease를 먼저 갱신한다.
    expect(jobs.renewLease.mock.calls).toHaveLength(1);
    expect(jobs.renewLease.mock.invocationCallOrder[0] ?? 0).toBeLessThan(
      github.revokeCollaborator.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('DB에 저장된 repository가 있으면 생성 없이 실패 대상만 처리한다', async () => {
    // Given: 저장소는 이미 기록됐고 재시도 대상 invitation 한 건만 있다.
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    state.loadContext.mockResolvedValue(
      provisionContext({ repository: PROVISION_REPOSITORY }),
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

    // When: job을 재시도한다.
    await worker.runNext('worker-b', PROVISION_NOW);

    // Then: repository를 다시 만들지 않고 실패 대상만 재처리한다.
    expect(github.findRepository.mock.calls).toHaveLength(0);
    expect(github.createRepository.mock.calls).toHaveLength(0);
    expect(github.ensureCollaborator.mock.calls).toEqual([
      [PROVISION_REPOSITORY.name, 'synthetic-student'],
    ]);
  });

  it('생성 직후 중단된 재시도는 같은 이름의 원격 저장소를 이어 쓴다', async () => {
    // Given: DB 기록은 없지만 이전 시도에서 원격 저장소가 생성됐다.
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
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

    // When: job을 다시 실행한다.
    await worker.runNext('worker-c', PROVISION_NOW);

    // Then: 원격 저장소를 새로 만들지 않고 DB 기록부터 계속한다.
    expect(github.createRepository.mock.calls).toHaveLength(0);
    expect(
      state.recordRepository.mock.calls[0]?.[0].metadata.githubRepositoryId,
    ).toBe(PROVISION_REPOSITORY.githubRepositoryId);
  });

  it('레거시 teamId null payload는 백필된 context teamId와 달라도 성공한다', async () => {
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
    const worker = new RepositoryProvisionWorker(jobs, state, github, {
      enrollExternalRepository: jest.fn(),
    });

    // When: provision job을 실행한다.
    const result = await worker.runNext(
      'worker-legacy-null-team',
      PROVISION_NOW,
    );

    // Then: 레거시 null payload를 거부하지 않고 완료한다.
    expect(result).toEqual({
      kind: 'SUCCEEDED',
      jobId: 'synthetic-job-id',
      repositoryId: PROVISION_REPOSITORY.id,
    });
  });
});

describe('RepositoryProvisionWorker OWN connection', () => {
  it('설정 조직 OWN 저장소는 App 접근으로 확인하고 외부 편입하지 않는다', async () => {
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    const repositoryUrl =
      'https://github.com/synthetic-org/synthetic-existing-repo';
    state.loadContext.mockResolvedValue(
      ownProvisionContext({
        eventPayload: {
          applicationId: 'synthetic-application-id',
          programId: 'synthetic-program-id',
          teamId: null,
          requestedAt: PROVISION_NOW.toISOString(),
          collaboratorGithubLogins: ['synthetic-student'],
          repositoryConnectionMode: 'OWN',
          repositoryUrl,
        },
      }),
    );
    const provisioned = {
      ...OWN_PROVISION_REPOSITORY,
      name: 'synthetic-existing-repo',
      url: repositoryUrl,
      visibility: 'PRIVATE' as const,
    };
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
    // 조직 안 저장소를 자기 것으로 연결해도 ORG_PROVISIONED다 — EXTERNAL_PUBLIC로
    // 잘못 찍으면 인벤토리 스윕이 관찰한 소유권과 충돌한다(#617 단계 D 회귀 가드).
    expect(state.recordRepository.mock.calls[0]?.[0].source).toBe(
      RepositorySource.ORG_PROVISIONED,
    );
  });

  it('OWN 승인은 저장소를 만들지 않고 학생 URL을 그대로 기록한다', async () => {
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    state.loadContext.mockResolvedValue(ownProvisionContext());
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
    // 조직 밖 저장소는 EXTERNAL_PUBLIC로 기록해야, 뒤이은 enrollExternalRepository의
    // updateMany(where: source: 'EXTERNAL_PUBLIC')가 이 행을 잡는다 — ORG_PROVISIONED로
    // 잘못 찍으면 조용히 no-op으로 끝나 수집 관찰 필드가 영영 갱신되지 않는다
    // (#617 단계 D에서 실제로 발견·수정한 회귀).
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
    state.loadContext.mockResolvedValue(ownProvisionContext());
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
    // 학생 소유 저장소의 협업자는 플랫폼 권한 밖이다 — 회수를 시도하지 않는다.
    expect(github.revokeCollaborator.mock.calls).toHaveLength(0);
    expect(state.prepareInvitations.mock.calls).toHaveLength(0);
    expect(state.findInvitationWork.mock.calls).toHaveLength(0);
    expect(state.completeInvitation.mock.calls).toHaveLength(0);
    expect(state.failInvitation.mock.calls).toHaveLength(0);
    // OWN은 관리형 재조회도 지문도 남기지 않는다(인자 4개).
    expect(state.completeJob.mock.calls).toEqual([
      [
        'synthetic-job-id',
        'worker-own-no-write',
        OWN_PROVISION_REPOSITORY.id,
        PROVISION_NOW,
      ],
    ]);
  });

  it('편입 뒤 job 완료가 실패해도 재시도에서 같은 저장소로 수렴한다', async () => {
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    state.loadContext
      .mockResolvedValueOnce(ownProvisionContext())
      .mockResolvedValueOnce(
        ownProvisionContext({ repository: OWN_PROVISION_REPOSITORY }),
      );
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
    expect(github.findPublicRepository.mock.calls).toHaveLength(2);
    expect(enrollExternalRepository).toHaveBeenCalledTimes(2);
    expect(state.failJob.mock.calls).toHaveLength(1);
  });

  it('재시도 중 URL이 다른 GitHub 저장소 id로 바뀌면 편입하지 않는다', async () => {
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    state.loadContext.mockResolvedValue(
      ownProvisionContext({ repository: OWN_PROVISION_REPOSITORY }),
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
      kind: 'FAILED_FINAL',
      jobId: 'synthetic-job-id',
      errorCode: PROVISION_ERROR_CODES.REPOSITORY_MISMATCH,
    });
    expect(enrollExternalRepository).not.toHaveBeenCalled();
    expect(state.completeJob.mock.calls).toHaveLength(0);
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
        eventPayload: {
          applicationId: 'synthetic-application-id',
          programId: 'synthetic-program-id',
          teamId: null,
          requestedAt: PROVISION_NOW.toISOString(),
          collaboratorGithubLogins: ['synthetic-leader', 'synthetic-student'],
          repositoryConnectionMode: 'OWN',
          repositoryUrl: 'https://gitlab.com/synthetic/repo',
        },
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
