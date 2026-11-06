import { CreateSubmissionReviewRequestDto } from './dto/create-submission-review-request.dto';
import { SubmissionsService } from './submissions.service';

const service = Object.create(
  SubmissionsService.prototype,
) as SubmissionsService;

describe('SubmissionReviewsService.reviewInputFromRequest', () => {
  it.each(['APPROVED', 'REJECTED', 'CHANGES_REQUESTED'] as const)(
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
      decision: 'APPROVED',
      comment: '  확인했습니다  ',
    });

    const input = service.reviewInputFromRequest(dto);

    expect(input).toEqual({
      revision: 2,
      decision: 'APPROVED',
      comment: '확인했습니다',
    });
  });
});
