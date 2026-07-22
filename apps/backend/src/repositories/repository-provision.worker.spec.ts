import { RepositoryInvitationStatus } from '@prisma/client';
import {
  githubClientMock,
  jobRepositoryMock,
  PROVISION_NOW,
  PROVISION_REPOSITORY,
  provisionContext,
  provisionStateMock,
} from '../../test/repository-provision-worker.fixture';
import { COLLABORATOR_OUTCOMES } from './github-app.client';
import { RepositoryProvisionWorker } from './repository-provision.worker';

describe('RepositoryProvisionWorker success', () => {
  it('실행 가능한 job이 없으면 외부 호출을 하지 않는다', async () => {
    // Given: claim 가능한 job이 없다.
    const jobs = jobRepositoryMock();
    jobs.claimNext.mockResolvedValue(null);
    const state = provisionStateMock();
    const github = githubClientMock();
    const worker = new RepositoryProvisionWorker(jobs, state, github);

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
    const worker = new RepositoryProvisionWorker(jobs, state, github);

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
    const worker = new RepositoryProvisionWorker(jobs, state, github);

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
    });
    const worker = new RepositoryProvisionWorker(jobs, state, github);

    // When: job을 다시 실행한다.
    await worker.runNext('worker-c', PROVISION_NOW);

    // Then: 원격 저장소를 새로 만들지 않고 DB 기록부터 계속한다.
    expect(github.createRepository.mock.calls).toHaveLength(0);
    expect(
      state.recordRepository.mock.calls[0]?.[0].metadata.githubRepositoryId,
    ).toBe(PROVISION_REPOSITORY.githubRepositoryId);
  });
});
