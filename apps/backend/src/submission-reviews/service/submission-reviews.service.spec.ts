import {
  RepositoryProvisionJobStatus,
  RepositoryVisibility,
  ReviewDecision,
  SubmissionStatus,
} from '@prisma/client';
import { DomainException } from '../../common/error-code';
import {
  GITHUB_OPERATIONS_ERROR_CODES,
  GithubOperationsError,
} from '../../github/domain/github-app.error';
import type { RepositoriesService } from '../../github/service/repositories.service';
import type {
  SubmissionReviewTransactionStore,
  SubmissionReviewsRepositoryPort,
} from '../repository/submission-reviews.repository';
import { SubmissionReviewsErrorCode } from '../domain/submission-reviews-error-code.enum';
import { SubmissionReviewsService } from './submission-reviews.service';

const REVIEWED_AT = new Date('2026-07-23T00:00:00.000Z');
const PROGRAM_ENDED_AT = new Date('2026-07-01T00:00:00.000Z');
const ACTOR_GITHUB_ID = 9_600_000_000_100_001n;
const authority = {
  assertActiveStaff: jest.fn().mockResolvedValue({ actorId: 'reviewer-1' }),
};

function reviewDependencies() {
  const target = {
    id: 'submission-1',
    currentRevision: 2,
    status: SubmissionStatus.SUBMITTED,
    revision: { id: 'revision-2', reviewId: null },
  };
  const store = {
    findReviewTarget: jest.fn().mockResolvedValue(target),
    createReview: jest.fn().mockResolvedValue({ id: 'review-1' }),
    transitionSubmission: jest.fn().mockResolvedValue(true),
  } as jest.Mocked<SubmissionReviewTransactionStore>;
  const repository = {
    findReviewContext: jest.fn(),
    findPublishEligibility: jest.fn(),
    withTransaction: jest.fn(
      async (
        operation: (
          transaction: SubmissionReviewTransactionStore,
        ) => Promise<unknown>,
      ) => operation(store),
    ),
  } as jest.Mocked<SubmissionReviewsRepositoryPort>;
  const repositories = {
    publish: jest.fn(),
  } as jest.Mocked<Pick<RepositoriesService, 'publish'>>;
  return { target, store, repository, repositories };
}

it.each(['context', 'review', 'publishRepository'] as const)(
  '%s는 업무 조회와 GitHub 호출 전에 모듈 권한 오류로 거부한다',
  async (method) => {
    const { store, repository, repositories } = reviewDependencies();
    const deniedAuthority = {
      assertActiveStaff: jest.fn((_actor: bigint, forbidden: () => Error) =>
        Promise.reject(forbidden()),
      ),
    };
    const service = new SubmissionReviewsService(
      repository,
      repositories,
      deniedAuthority,
    );
    const result =
      method === 'context'
        ? service.context('submission-1', ACTOR_GITHUB_ID)
        : method === 'review'
          ? service.review(ACTOR_GITHUB_ID, 'submission-1', {
              revision: 2,
              decision: ReviewDecision.APPROVED,
              comment: null,
            })
          : service.publishRepository('repository-1', ACTOR_GITHUB_ID);
    await expect(result).rejects.toMatchObject({
      errorCode: {
        code: 'SUB_002',
        status: 403,
        message: '승인된 교직원 또는 관리자만 제출을 검토할 수 있습니다.',
      },
    });
    expect(deniedAuthority.assertActiveStaff).toHaveBeenCalledWith(
      ACTOR_GITHUB_ID,
      expect.any(Function),
    );
    expect(repository.findReviewContext.mock.calls).toHaveLength(0);
    expect(repository.findPublishEligibility.mock.calls).toHaveLength(0);
    expect(repository.withTransaction.mock.calls).toHaveLength(0);
    expect(store.createReview.mock.calls).toHaveLength(0);
    expect(repositories.publish).not.toHaveBeenCalled();
  },
);

describe('SubmissionReviewsService.review', () => {
  it.each([
    [ReviewDecision.APPROVED, SubmissionStatus.APPROVED, null],
    [
      ReviewDecision.CHANGES_REQUESTED,
      SubmissionStatus.CHANGES_REQUESTED,
      '보완해 주세요',
    ],
    [ReviewDecision.REJECTED, SubmissionStatus.REJECTED, '요건 미충족'],
  ] as const)(
    '%s 판정을 현재 제출 상태로 원자적으로 반영한다',
    async (decision, expectedStatus, comment) => {
      const { store, repository, repositories } = reviewDependencies();
      const service = new SubmissionReviewsService(
        repository,
        repositories,
        authority,
      );

      const result = await service.review(
        ACTOR_GITHUB_ID,
        'submission-1',
        { revision: 2, decision, comment },
        REVIEWED_AT,
      );

      expect(store.createReview.mock.calls).toEqual([
        [
          {
            submissionHistoryId: 'revision-2',
            milestoneDocumentSubmissionId: 'submission-1',
            revision: 2,
            reviewerId: 'reviewer-1',
            decision,
            comment,
            reviewedAt: REVIEWED_AT,
          },
        ],
      ]);
      expect(store.transitionSubmission.mock.calls).toEqual([
        [
          {
            submissionId: 'submission-1',
            expectedRevision: 2,
            nextStatus: expectedStatus,
          },
        ],
      ]);
      expect(result).toEqual({
        reviewId: 'review-1',
        submissionStatus: expectedStatus,
      });
    },
  );

  it('요청 revision이 최신이 아니면 stale 오류로 거부한다', async () => {
    const { store, repository, repositories } = reviewDependencies();
    const service = new SubmissionReviewsService(
      repository,
      repositories,
      authority,
    );

    const review = service.review(ACTOR_GITHUB_ID, 'submission-1', {
      revision: 1,
      decision: ReviewDecision.APPROVED,
      comment: null,
    });

    await expect(review).rejects.toMatchObject({
      errorCode: { code: SubmissionReviewsErrorCode.STALE_REVISION },
    });
    expect(store.createReview.mock.calls).toHaveLength(0);
  });

  it('이미 검토된 revision의 중복 판정을 거부한다', async () => {
    const { target, store, repository, repositories } = reviewDependencies();
    store.findReviewTarget.mockResolvedValue({
      ...target,
      revision: { ...target.revision, reviewId: 'existing-review' },
    });
    const service = new SubmissionReviewsService(
      repository,
      repositories,
      authority,
    );

    const review = service.review(ACTOR_GITHUB_ID, 'submission-1', {
      revision: 2,
      decision: ReviewDecision.APPROVED,
      comment: null,
    });

    await expect(review).rejects.toMatchObject({
      errorCode: { code: SubmissionReviewsErrorCode.ALREADY_REVIEWED },
    });
  });
});

describe('SubmissionReviewsService.publishRepository', () => {
  it('모든 마일스톤 승인 뒤 별도 액션으로 저장소를 공개한다', async () => {
    const { repository, repositories } = reviewDependencies();
    repository.findPublishEligibility.mockResolvedValue({
      repositoryId: 'repository-1',
      visibility: RepositoryVisibility.PRIVATE,
      provisionStatus: RepositoryProvisionJobStatus.SUCCEEDED,
      requiredMilestonesApproved: true,
      isRepositoryPublicationPlanned: true,
      programEndAt: PROGRAM_ENDED_AT,
    });
    repositories.publish.mockResolvedValue({
      id: 'repository-1',
      githubRepositoryId: 123n,
      name: 'synthetic-repository',
      url: 'https://github.com/synthetic-org/synthetic-repository',
      visibility: RepositoryVisibility.PUBLIC,
      publishedAt: REVIEWED_AT,
    });
    const service = new SubmissionReviewsService(
      repository,
      repositories,
      authority,
    );

    const result = await service.publishRepository(
      'repository-1',
      ACTOR_GITHUB_ID,
      REVIEWED_AT,
    );

    expect(repositories.publish).toHaveBeenCalledWith(
      { repositoryId: 'repository-1' },
      ACTOR_GITHUB_ID,
      REVIEWED_AT,
    );
    expect(result).toEqual({
      repositoryId: 'repository-1',
      visibility: RepositoryVisibility.PUBLIC,
      publishedAt: REVIEWED_AT,
    });
  });

  it('필수 마일스톤 미승인 상태에서는 GitHub 호출을 막는다', async () => {
    const { repository, repositories } = reviewDependencies();
    repository.findPublishEligibility.mockResolvedValue({
      repositoryId: 'repository-1',
      visibility: RepositoryVisibility.PRIVATE,
      provisionStatus: RepositoryProvisionJobStatus.SUCCEEDED,
      requiredMilestonesApproved: false,
      isRepositoryPublicationPlanned: true,
      programEndAt: PROGRAM_ENDED_AT,
    });
    const service = new SubmissionReviewsService(
      repository,
      repositories,
      authority,
    );

    const publish = service.publishRepository(
      'repository-1',
      ACTOR_GITHUB_ID,
      REVIEWED_AT,
    );

    await expect(publish).rejects.toMatchObject({
      errorCode: {
        code: SubmissionReviewsErrorCode.REQUIRED_MILESTONES_NOT_APPROVED,
      },
    });
    expect(repositories.publish).not.toHaveBeenCalled();
  });

  it('지원서가 저장소 공개를 계획하지 않았으면 GitHub 호출을 막는다', async () => {
    const { repository, repositories } = reviewDependencies();
    repository.findPublishEligibility.mockResolvedValue({
      repositoryId: 'repository-1',
      visibility: RepositoryVisibility.PRIVATE,
      provisionStatus: RepositoryProvisionJobStatus.SUCCEEDED,
      requiredMilestonesApproved: true,
      isRepositoryPublicationPlanned: false,
      programEndAt: PROGRAM_ENDED_AT,
    });
    const service = new SubmissionReviewsService(
      repository,
      repositories,
      authority,
    );

    const publish = service.publishRepository(
      'repository-1',
      ACTOR_GITHUB_ID,
      REVIEWED_AT,
    );

    await expect(publish).rejects.toMatchObject({
      errorCode: {
        code: SubmissionReviewsErrorCode.REPOSITORY_PUBLICATION_NOT_PLANNED,
      },
    });
    expect(repositories.publish).not.toHaveBeenCalled();
  });

  it('프로그램이 아직 진행 중이면 GitHub 호출을 막는다', async () => {
    const { repository, repositories } = reviewDependencies();
    repository.findPublishEligibility.mockResolvedValue({
      repositoryId: 'repository-1',
      visibility: RepositoryVisibility.PRIVATE,
      provisionStatus: RepositoryProvisionJobStatus.SUCCEEDED,
      requiredMilestonesApproved: true,
      isRepositoryPublicationPlanned: true,
      programEndAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    const service = new SubmissionReviewsService(
      repository,
      repositories,
      authority,
    );

    const publish = service.publishRepository(
      'repository-1',
      ACTOR_GITHUB_ID,
      REVIEWED_AT,
    );

    await expect(publish).rejects.toMatchObject({
      errorCode: { code: SubmissionReviewsErrorCode.PROGRAM_NOT_ENDED },
    });
    expect(repositories.publish).not.toHaveBeenCalled();
  });

  it('GitHub 공개 실패는 검토 트랜잭션과 분리된 502 오류다', async () => {
    const { repository, repositories } = reviewDependencies();
    repository.findPublishEligibility.mockResolvedValue({
      repositoryId: 'repository-1',
      visibility: RepositoryVisibility.PRIVATE,
      provisionStatus: RepositoryProvisionJobStatus.SUCCEEDED,
      requiredMilestonesApproved: true,
      isRepositoryPublicationPlanned: true,
      programEndAt: PROGRAM_ENDED_AT,
    });
    repositories.publish.mockRejectedValue(
      new GithubOperationsError(GITHUB_OPERATIONS_ERROR_CODES.UPSTREAM, true),
    );
    const service = new SubmissionReviewsService(
      repository,
      repositories,
      authority,
    );

    const publish = service.publishRepository(
      'repository-1',
      ACTOR_GITHUB_ID,
      REVIEWED_AT,
    );

    await expect(publish).rejects.toBeInstanceOf(DomainException);
    await expect(publish).rejects.toMatchObject({
      errorCode: { code: SubmissionReviewsErrorCode.GITHUB_PUBLISH_FAILED },
    });
  });

  it('예상하지 않은 내부 오류를 GitHub 실패로 숨기지 않는다', async () => {
    const { repository, repositories } = reviewDependencies();
    repository.findPublishEligibility.mockResolvedValue({
      repositoryId: 'repository-1',
      visibility: RepositoryVisibility.PRIVATE,
      provisionStatus: RepositoryProvisionJobStatus.SUCCEEDED,
      requiredMilestonesApproved: true,
      isRepositoryPublicationPlanned: true,
      programEndAt: PROGRAM_ENDED_AT,
    });
    const internalError = new Error('synthetic database failure');
    repositories.publish.mockRejectedValue(internalError);
    const service = new SubmissionReviewsService(
      repository,
      repositories,
      authority,
    );

    await expect(
      service.publishRepository('repository-1', ACTOR_GITHUB_ID, REVIEWED_AT),
    ).rejects.toBe(internalError);
  });
});
