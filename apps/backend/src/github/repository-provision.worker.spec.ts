import { RepositoryInvitationStatus } from '@prisma/client';
import {
  githubClientMock,
  jobRepositoryMock,
  OWN_PROVISION_REPOSITORY,
  OWN_REPOSITORY_URL,
  ownProvisionContext,
  PROVISION_NOW,
  PROVISION_REPOSITORY,
  provisionContext,
  provisionStateMock,
} from '../../test/repository-provision-worker.fixture';
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

  it('private 저장소를 먼저 기록하고 snapshot 대상만 초대한다', async () => {
    // Given: 승인된 신청과 두 collaborator snapshot이 있다.
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
    expect(state.prepareInvitations.mock.calls[0]).toEqual([
      'synthetic-job-id',
      'worker-a',
      PROVISION_REPOSITORY.id,
      ['synthetic-leader', 'synthetic-student'],
    ]);
    expect(
      state.completeInvitation.mock.calls.map(([input]) => input.status),
    ).toEqual([
      RepositoryInvitationStatus.PENDING,
      RepositoryInvitationStatus.SUCCEEDED,
    ]);
    expect(state.completeJob.mock.calls).toHaveLength(1);
  });

  it('DB에 저장된 repository가 있으면 생성 없이 실패 대상만 처리한다', async () => {
    // Given: 저장소는 이미 기록됐고 재시도 대상 invitation 한 건만 있다.
    const jobs = jobRepositoryMock();
    const state = provisionStateMock();
    state.loadContext.mockResolvedValue(
      provisionContext({ repository: PROVISION_REPOSITORY }),
    );
    state.findInvitationWork.mockResolvedValue([
      { id: 'synthetic-failed-invitation', githubLogin: 'synthetic-student' },
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

  it('OWN 승인은 협업자 초대·공개 전환을 시도하지 않는다', async () => {
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
    expect(state.prepareInvitations.mock.calls).toHaveLength(0);
    expect(state.findInvitationWork.mock.calls).toHaveLength(0);
    expect(state.completeInvitation.mock.calls).toHaveLength(0);
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
