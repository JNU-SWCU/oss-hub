import {
  RepositoryProvisionJobStatus,
  RepositoryVisibility,
  ReviewDecision,
  SubmissionStatus,
} from '@prisma/client';
import { DomainException } from '../common/error-code';
import {
  GITHUB_OPERATIONS_ERROR_CODES,
  GithubOperationsError,
} from '../repositories/github-app.error';
import type { RepositoriesService } from '../repositories/repositories.service';
import type {
  SubmissionReviewTransactionStore,
  SubmissionReviewsRepositoryPort,
} from './submission-reviews.repository';
import { SubmissionReviewsErrorCode } from './submission-reviews-error-code.enum';
import { SubmissionReviewsService } from './submission-reviews.service';

const REVIEWED_AT = new Date('2026-07-23T00:00:00.000Z');

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
      // Given: 최신 revision이 아직 검토되지 않았다.
      const { store, repository, repositories } = reviewDependencies();
      const service = new SubmissionReviewsService(repository, repositories);

      // When: 교직원이 판정을 저장한다.
      const result = await service.review(
        'reviewer-1',
        'submission-1',
        { revision: 2, decision, comment },
        REVIEWED_AT,
      );

      // Then: Review와 Submission 상태가 같은 트랜잭션에서 갱신된다.
      expect(store.createReview.mock.calls).toEqual([
        [
          {
            submissionRevisionId: 'revision-2',
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
    // Given: 서버 최신 revision은 2다.
    const { store, repository, repositories } = reviewDependencies();
    const service = new SubmissionReviewsService(repository, repositories);

    // When: revision 1 판정을 요청한다.
    const review = service.review('reviewer-1', 'submission-1', {
      revision: 1,
      decision: ReviewDecision.APPROVED,
      comment: null,
    });

    // Then: Review를 만들지 않고 409 도메인 오류를 반환한다.
    await expect(review).rejects.toMatchObject({
      errorCode: { code: SubmissionReviewsErrorCode.STALE_REVISION },
    });
    expect(store.createReview.mock.calls).toHaveLength(0);
  });

  it('이미 검토된 revision의 중복 판정을 거부한다', async () => {
    // Given: 최신 revision에 Review가 존재한다.
    const { target, store, repository, repositories } = reviewDependencies();
    store.findReviewTarget.mockResolvedValue({
      ...target,
      revision: { ...target.revision, reviewId: 'existing-review' },
    });
    const service = new SubmissionReviewsService(repository, repositories);

    // When: 같은 revision을 다시 판정한다.
    const review = service.review('reviewer-1', 'submission-1', {
      revision: 2,
      decision: ReviewDecision.APPROVED,
      comment: null,
    });

    // Then: 중복 Review 오류로 거부한다.
    await expect(review).rejects.toMatchObject({
      errorCode: { code: SubmissionReviewsErrorCode.ALREADY_REVIEWED },
    });
  });
});

describe('SubmissionReviewsService.publishRepository', () => {
  it('모든 마일스톤 승인 뒤 별도 액션으로 저장소를 공개한다', async () => {
    // Given: provision 성공 및 모든 마일스톤 승인이 확인됐다.
    const { repository, repositories } = reviewDependencies();
    repository.findPublishEligibility.mockResolvedValue({
      repositoryId: 'repository-1',
      visibility: RepositoryVisibility.PRIVATE,
      provisionStatus: RepositoryProvisionJobStatus.SUCCEEDED,
      requiredMilestonesApproved: true,
    });
    repositories.publish.mockResolvedValue({
      id: 'repository-1',
      githubRepositoryId: 123n,
      name: 'synthetic-repository',
      url: 'https://github.com/synthetic-org/synthetic-repository',
      visibility: RepositoryVisibility.PUBLIC,
      publishedAt: REVIEWED_AT,
    });
    const service = new SubmissionReviewsService(repository, repositories);

    // When: 공개 버튼 액션을 실행한다.
    const result = await service.publishRepository('repository-1', REVIEWED_AT);

    // Then: #121 서비스에 repository id를 위임해 공개 상태로 수렴한다.
    expect(repositories.publish).toHaveBeenCalledWith(
      { repositoryId: 'repository-1' },
      REVIEWED_AT,
    );
    expect(result).toEqual({
      repositoryId: 'repository-1',
      visibility: RepositoryVisibility.PUBLIC,
      publishedAt: REVIEWED_AT,
    });
  });

  it('필수 마일스톤 미승인 상태에서는 GitHub 호출을 막는다', async () => {
    // Given: 저장소 준비는 끝났지만 미승인 제출이 있다.
    const { repository, repositories } = reviewDependencies();
    repository.findPublishEligibility.mockResolvedValue({
      repositoryId: 'repository-1',
      visibility: RepositoryVisibility.PRIVATE,
      provisionStatus: RepositoryProvisionJobStatus.SUCCEEDED,
      requiredMilestonesApproved: false,
    });
    const service = new SubmissionReviewsService(repository, repositories);

    // When: 공개 전환을 요청한다.
    const publish = service.publishRepository('repository-1');

    // Then: 공개 조건 오류이며 외부 API는 호출하지 않는다.
    await expect(publish).rejects.toMatchObject({
      errorCode: {
        code: SubmissionReviewsErrorCode.REQUIRED_MILESTONES_NOT_APPROVED,
      },
    });
    expect(repositories.publish).not.toHaveBeenCalled();
  });

  it('GitHub 공개 실패는 검토 트랜잭션과 분리된 502 오류다', async () => {
    // Given: 공개 조건은 충족했지만 외부 공개 호출이 실패한다.
    const { repository, repositories } = reviewDependencies();
    repository.findPublishEligibility.mockResolvedValue({
      repositoryId: 'repository-1',
      visibility: RepositoryVisibility.PRIVATE,
      provisionStatus: RepositoryProvisionJobStatus.SUCCEEDED,
      requiredMilestonesApproved: true,
    });
    repositories.publish.mockRejectedValue(
      new GithubOperationsError(GITHUB_OPERATIONS_ERROR_CODES.UPSTREAM, true),
    );
    const service = new SubmissionReviewsService(repository, repositories);

    // When: 공개 전환을 요청한다.
    const publish = service.publishRepository('repository-1');

    // Then: 별도 재시도 가능한 공개 실패로 변환한다.
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
    });
    const internalError = new Error('synthetic database failure');
    repositories.publish.mockRejectedValue(internalError);
    const service = new SubmissionReviewsService(repository, repositories);

    await expect(service.publishRepository('repository-1')).rejects.toBe(
      internalError,
    );
  });
});
