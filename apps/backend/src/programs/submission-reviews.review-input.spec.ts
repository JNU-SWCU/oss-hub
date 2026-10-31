import { ReviewDecision } from '@prisma/client';
import { DomainException } from '../platform/error-code.error';
import { CreateSubmissionReviewRequestDto } from './dto/create-submission-review-request.dto';
import { SubmissionReviewsService } from './submission-reviews.service';
import { SubmissionReviewsErrorCode } from './submission-reviews-error-code.error';

const service = Object.create(
  SubmissionReviewsService.prototype,
) as SubmissionReviewsService;

describe('SubmissionReviewsService.reviewInputFromRequest', () => {
  it.each([ReviewDecision.CHANGES_REQUESTED, ReviewDecision.REJECTED] as const)(
    '%s는 비어 있지 않은 comment를 요구한다',
    (decision) => {
      const dto = Object.assign(new CreateSubmissionReviewRequestDto(), {
        revision: 2,
        decision,
        comment: '   ',
      });

      try {
        service.reviewInputFromRequest(dto);
        throw new Error('DomainException이 발생해야 합니다.');
      } catch (error) {
        if (!(error instanceof DomainException)) {
          throw error;
        }
        expect(error.errorCode.code).toBe(
          SubmissionReviewsErrorCode.COMMENT_REQUIRED,
        );
      }
    },
  );

  it('승인 comment는 선택이며 입력된 값은 trim한다', () => {
    const dto = Object.assign(new CreateSubmissionReviewRequestDto(), {
      revision: 2,
      decision: ReviewDecision.APPROVED,
      comment: '  확인했습니다  ',
    });

    const input = service.reviewInputFromRequest(dto);

    expect(input).toEqual({
      revision: 2,
      decision: ReviewDecision.APPROVED,
      comment: '확인했습니다',
    });
  });
});
