import { ReviewDecision } from '@prisma/client';
import { CreateSubmissionReviewRequestDto } from './dto/create-submission-review-request.dto';
import { SubmissionReviewsService } from './submission-reviews.service';

const service = Object.create(
  SubmissionReviewsService.prototype,
) as SubmissionReviewsService;

describe('SubmissionReviewsService.reviewInputFromRequest', () => {
  it.each(Object.values(ReviewDecision))(
    '%s 사유는 선택이고 입력된 사유는 보존한다',
    (decision) => {
      for (const comment of [undefined, '   ', '  다시 확인  ']) {
        const dto = Object.assign(new CreateSubmissionReviewRequestDto(), {
          revision: 2,
          decision,
          comment,
        });
        expect(service.reviewInputFromRequest(dto)).toEqual({
          revision: 2,
          decision,
          comment: comment?.trim() || null,
        });
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
