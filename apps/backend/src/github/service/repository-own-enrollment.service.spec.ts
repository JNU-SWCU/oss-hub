import type { ConsentsService } from '../../consents/consents.service';
import type { CollectionIncrementalRepository } from '../repository/collection-incremental.repository';
import { RepositoryOwnEnrollmentService } from './repository-own-enrollment.service';

const INPUT = {
  applicantGithubId: 9_000_000_730_101n,
  githubRepositoryId: 9_000_000_730_102n,
  nameWithOwner: 'synthetic-student/synthetic-own-repo',
  defaultBranch: 'main',
  archived: false,
  observedAt: new Date('2026-08-09T14:00:00.000Z'),
} as const;

describe('RepositoryOwnEnrollmentService', () => {
  it('현재 동의를 확인한 뒤 external 수집 큐에 편입한다', async () => {
    const order: string[] = [];
    const consents: Pick<ConsentsService, 'requireCurrent'> = {
      requireCurrent: jest.fn(() => {
        order.push('consent');
        return Promise.resolve();
      }),
    };
    const enrollment: Pick<
      CollectionIncrementalRepository,
      'enrollExternalRepository'
    > = {
      enrollExternalRepository: jest.fn(() => {
        order.push('enrollment');
        return Promise.resolve();
      }),
    };
    const service = new RepositoryOwnEnrollmentService(consents, enrollment);

    await service.enrollExternalRepository(INPUT);

    expect(order).toEqual(['consent', 'enrollment']);
    expect(consents.requireCurrent).toHaveBeenCalledWith(
      INPUT.applicantGithubId,
    );
    expect(enrollment.enrollExternalRepository).toHaveBeenCalledWith({
      githubRepositoryId: INPUT.githubRepositoryId,
      nameWithOwner: INPUT.nameWithOwner,
      defaultBranch: INPUT.defaultBranch,
      archived: INPUT.archived,
      observedAt: INPUT.observedAt,
    });
  });

  it('현재 동의가 없으면 수집 행을 만들지 않는다', async () => {
    const missingConsent = new Error('synthetic current consent missing');
    const consents: Pick<ConsentsService, 'requireCurrent'> = {
      requireCurrent: jest.fn().mockRejectedValue(missingConsent),
    };
    const enrollment: Pick<
      CollectionIncrementalRepository,
      'enrollExternalRepository'
    > = { enrollExternalRepository: jest.fn() };
    const service = new RepositoryOwnEnrollmentService(consents, enrollment);

    await expect(service.enrollExternalRepository(INPUT)).rejects.toBe(
      missingConsent,
    );
    expect(enrollment.enrollExternalRepository).not.toHaveBeenCalled();
  });
});
