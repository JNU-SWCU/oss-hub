import { ReviewDecision } from '@prisma/client';
import { DomainException } from '../common/error-code';
import { CreateSubmissionReviewRequestDto } from './dto/create-submission-review-request.dto';
import { SubmissionReviewsErrorCode } from './submission-reviews-error-code.enum';

describe('CreateSubmissionReviewRequestDto', () => {
  it.each([ReviewDecision.CHANGES_REQUESTED, ReviewDecision.REJECTED] as const)(
    '%s는 비어 있지 않은 comment를 요구한다',
    (decision) => {
      // Given: 코멘트가 공백뿐인 보완/반려 판정이다.
      const dto = Object.assign(new CreateSubmissionReviewRequestDto(), {
        revision: 2,
        decision,
        comment: '   ',
      });

      // When: 도메인 입력으로 변환한다.
      try {
        dto.toInput();
        throw new Error('DomainException이 발생해야 합니다.');
      } catch (error) {
        // Then: 422 코멘트 필수 오류를 반환한다.
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
    // Given: 선택 코멘트가 포함된 승인 요청이다.
    const dto = Object.assign(new CreateSubmissionReviewRequestDto(), {
      revision: 2,
      decision: ReviewDecision.APPROVED,
      comment: '  확인했습니다  ',
    });

    // When: 도메인 입력으로 변환한다.
    const input = dto.toInput();

    // Then: 정규화된 코멘트를 사용한다.
    expect(input).toEqual({
      revision: 2,
      decision: ReviewDecision.APPROVED,
      comment: '확인했습니다',
    });
  });
});
