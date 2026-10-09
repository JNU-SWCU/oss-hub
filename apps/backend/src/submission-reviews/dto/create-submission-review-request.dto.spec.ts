import { ReviewDecision } from '@prisma/client';
import { DomainException } from '../../common/error-code';
import { CreateSubmissionReviewRequestDto } from './create-submission-review-request.dto';
import { SubmissionReviewsErrorCode } from '../domain/submission-reviews-error-code.enum';

describe('CreateSubmissionReviewRequestDto', () => {
  it.each([ReviewDecision.CHANGES_REQUESTED, ReviewDecision.REJECTED] as const)(
    '%s는 비어 있지 않은 comment를 요구한다',
    (decision) => {
      const dto = Object.assign(new CreateSubmissionReviewRequestDto(), {
        revision: 2,
        decision,
        comment: '   ',
      });

      try {
        dto.toInput();
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

    const input = dto.toInput();

    expect(input).toEqual({
      revision: 2,
      decision: ReviewDecision.APPROVED,
      comment: '확인했습니다',
    });
  });
});
