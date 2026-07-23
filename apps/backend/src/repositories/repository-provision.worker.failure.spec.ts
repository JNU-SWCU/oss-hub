import { ApplicationStatus } from '@prisma/client';
import {
  githubClientMock,
  jobRepositoryMock,
  PROVISION_NOW,
  PROVISION_REPOSITORY,
  provisionContext,
  provisionStateMock,
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
    const worker = new RepositoryProvisionWorker(jobs, state, github, OPTIONS);

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
    const worker = new RepositoryProvisionWorker(jobs, state, github, OPTIONS);

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
    const worker = new RepositoryProvisionWorker(jobs, state, github, OPTIONS);

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
      visibility: 'PUBLIC',
      description: buildRepositoryOwnershipMarker('synthetic-application-id'),
    });
    const worker = new RepositoryProvisionWorker(jobs, state, github, OPTIONS);

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
      visibility: 'PUBLIC',
      description: buildRepositoryOwnershipMarker('synthetic-application-id'),
    });
    const worker = new RepositoryProvisionWorker(jobs, state, github, OPTIONS);

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
    const worker = new RepositoryProvisionWorker(jobs, state, github, OPTIONS);

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
    const worker = new RepositoryProvisionWorker(jobs, state, github, OPTIONS);

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
      { id: 'synthetic-failed-invitation', githubLogin: 'synthetic-student' },
    ]);
    const github = githubClientMock();
    github.ensureCollaborator.mockRejectedValue(
      new GithubOperationsError(GITHUB_OPERATIONS_ERROR_CODES.UPSTREAM, true),
    );
    const worker = new RepositoryProvisionWorker(jobs, state, github, OPTIONS);

    // When: job을 실행한다.
    const result = await worker.runNext('worker-e', PROVISION_NOW);

    // Then: 저장소 생성 없이 실패 invitation과 job만 재시도 가능 상태가 된다.
    expect(result.kind).toBe('FAILED_RETRYABLE');
    expect(github.createRepository.mock.calls).toHaveLength(0);
    expect(state.failInvitation.mock.calls[0]?.[0]).toMatchObject({
      invitationId: 'synthetic-failed-invitation',
      final: false,
      errorCode: GITHUB_OPERATIONS_ERROR_CODES.UPSTREAM,
    });
  });
});
