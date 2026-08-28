import { Injectable } from '@nestjs/common';
import { DomainException } from '../common/error-code';
import {
  type CreateMilestoneDocumentReviewInput,
  reviewDecisionToSubmissionStatus,
} from './domain/milestone-document-review';
import { MilestoneDocumentReviewResponseDto } from './dto/milestone-document-review-response.dto';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from './milestone-documents-error-code.enum';
import { MilestoneDocumentsRepository } from './milestone-documents.repository';

/**
 * 교직원 서류 제출물 판정(승인 · 보완 요청 · 반려).
 *
 * 판정은 `MilestoneDocumentReviewHistory`에 **쌓이고**, 그 최신 결과를
 * `MilestoneDocumentSubmission.status`가 반영한다. 이력을 쌓는 이유는 스키마 주석에 있다 —
 * 담당 교직원이 바뀌어도 지난 지적이 남아야 한다.
 */
@Injectable()
export class MilestoneDocumentReviewsService {
  constructor(private readonly repository: MilestoneDocumentsRepository) {}

  /**
   * `POST /milestones/:milestoneId/documents/:documentId/applications/:applicationId/reviews`
   *
   * 인가는 제출 파일 다운로드(`MilestoneDocumentFilesService.downloadSubmissionFile`)와 **같은
   * 4단계**를 그대로 따른다.
   * 1. ACTIVE + STAFF/ADMIN — MilestoneDocumentsStaffGuard가 endpoint 앞단에서 본다.
   * 2. 서류 항목이 이 마일스톤 소속인가.
   * 3. 신청이 이 마일스톤의 프로그램 소속인가 — 가드가 역할만 보므로(프로그램 단위 소유권
   *    컬럼이 스키마에 없다) 경로를 위조해 다른 프로그램의 제출을 판정하는 것을 여기서 막는다.
   * 4. 그 (서류, 신청) 제출이 실제로 있는가.
   *
   * 인가가 끝난 뒤 **5단계로 기대 버전 대조**가 붙는다 — 「판정해도 되는 사람인가」와 「이게
   * 그가 본 그 제출물인가」는 다른 질문이다. 뒤쪽은 잠금 아래에서만 답할 수 있어 트랜잭션
   * 안에 있다(그 자리의 주석에 근거를 적었다).
   *
   * **잠금**: 판정은 `MilestoneDocumentSubmission`을 바꾸므로 학생 재제출과 경합한다. 학생 제출
   * 경로(`upsertSubmission`)가 `MilestoneDocument` 행을 `FOR SHARE`로 잡으므로, 이쪽이 같은 행을
   * `FOR UPDATE`로 잡으면 둘 중 하나는 반드시 기다린다 — 「제출을 찾았다」와 「학생이 새 제출을
   * 커밋했다」를 실제로 직렬화하는 지점이다. 잠금이 없으면 방금 사라진(또는 방금 교체된) 제출에
   * 판정이 붙고, 학생 쪽은 낡은 판정을 못 본 채 재제출이 통과한다.
   *
   * 잠금 순서 규칙(`Program` → `Milestone` → `MilestoneDocument` id 오름차순, 원본은
   * `common/milestone-document-locks.ts`)에서 마지막 하나만 잡는다 — 서류 항목의 **집합**을
   * 바꾸지 않으므로 마일스톤 행까지 잡을 이유가 없다. 부분집합만 잡으니 교착도 만들지 않는다.
   *
   * 트랜잭션 경계는 서비스가 소유한다(ADR-003) — 「잠근다 → 제출을 찾는다 → 판정을 쌓는다 →
   * 상태를 옮긴다」가 한 트랜잭션이어야 한다. 갈라져 있으면 판정만 남고 상태가 옛것으로 남는
   * (또는 그 반대의) 절반 상태가 커밋된다.
   *
   * **판정 시각(`reviewedAt`)은 잠금을 얻은 뒤에 찍는다** — 그래서 `now`가 `Date`가 아니라
   * `() => Date`다. 요청이 들어온 시각을 미리 찍어 두면 두 교직원의 판정이 겹칠 때 **먼저
   * 시작했지만 잠금을 늦게 얻은** 요청이 옛 시각을 들고 마지막에 커밋한다. 그러면
   * `MilestoneDocumentSubmission.status`는 마지막 커밋을 반영하는데 「최신 판정」 조회
   * (`reviewedAt DESC`)는 다른 판정을 고르고, 화면의 상태·사유와 학생 쪽 재제출 규칙
   * (`isResubmissionAllowedAfter`)이 서로 다른 판정을 근거로 삼는다.
   */
  async review(
    reviewerId: string,
    milestoneId: string,
    documentId: string,
    applicationId: string,
    input: CreateMilestoneDocumentReviewInput,
    now: () => Date = () => new Date(),
  ): Promise<MilestoneDocumentReviewResponseDto> {
    // 2. 서류 항목이 이 마일스톤 소속인가.
    const documentContext =
      await this.repository.findDocumentContext(documentId);
    if (
      documentContext === null ||
      documentContext.milestoneId !== milestoneId
    ) {
      throw this.error(MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND);
    }

    // 3. 신청이 이 마일스톤의 프로그램 소속인가.
    const applicationProgramId =
      await this.repository.findApplicationProgramId(applicationId);
    if (applicationProgramId !== documentContext.programId) {
      throw this.error(MilestoneDocumentsErrorCode.SUBMISSION_NOT_FOUND);
    }

    const created = await this.repository.withTransaction(async (store) => {
      const locked = await store.lockDocument(documentId);
      // 잠금을 기다리는 동안 서류 항목이 지워졌거나 다른 마일스톤 것이 되었을 수 있다 —
      // 소속 확인도 잠금 뒤의 값으로 한 번 더 한다.
      if (locked === null || locked.milestoneId !== milestoneId) {
        throw this.error(MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND);
      }

      /*
       * 판정 시각은 **여기서** 찍는다 — 잠금을 얻은 뒤, 같은 트랜잭션 안이다.
       *
       * 왜 이 순서가 「최신 판정」 조회와 맞아떨어지는가: 같은 (서류, 신청)을 판정하는 두
       * 트랜잭션은 같은 `MilestoneDocument` 행을 `FOR UPDATE`로 잡으므로 한 줄로 선다. 뒤에
       * 선 쪽은 앞선 쪽이 **커밋해서 잠금을 놓은 뒤에야** 이 지점에 도달하므로, 시각을 찍는
       * 순간은 언제나 「앞 트랜잭션의 커밋 이후」다. 따라서 `reviewedAt` 오름차순 = 실제 커밋
       * 순서이고, `reviewedAt DESC`로 뽑은 「최신 판정」이 곧 `status`를 마지막에 쓴 그 판정이다.
       * (요청 시각을 미리 찍으면 이 대응이 깨진다 — 잠금을 기다린 쪽이 더 이른 시각을 들고
       * 나중에 커밋한다.)
       *
       * 동률(같은 밀리초)만 남는다: 앞 트랜잭션이 커밋한 그 밀리초 안에 뒤 트랜잭션이 시각을
       * 찍으면 `reviewedAt`이 같아진다. 그때는 리포지토리의 `reviewedAt DESC, id DESC`가 cuid의
       * 시간 접두사로 한 값을 **결정적으로** 고른다 — 조회할 때마다 답이 달라지지는 않는다.
       * 다만 밀리초 미만에서 cuid 순서가 커밋 순서와 같다는 보장은 없으므로(id는 DB가 아니라
       * 애플리케이션이 만든다), 이 동률 구간에서만 「최신 판정」이 `status`와 갈릴 수 있다.
       * 그 창을 완전히 닫으려면 순번을 DB가 부여해야 한다(스키마 변경).
       */
      const reviewedAt = now();

      // 4. 그 (서류, 신청) 제출이 있는가 — 잠금 아래에서 찾는다.
      const submission = await store.findSubmissionForReview(
        documentId,
        applicationId,
      );
      if (submission === null) {
        throw this.error(MilestoneDocumentsErrorCode.SUBMISSION_NOT_FOUND);
      }

      /*
       * 5. 이게 **검토자가 본 그 버전**인가 — 두 값을 잠금 아래에서 맞춰 본다.
       *
       * 잠금은 「누가 먼저인가」만 정한다. 표가 그려진 뒤 학생이 다시 냈다면 제출 행은 같은
       * id를 유지한 채 내용만 바뀌어 있고(제출은 upsert다), 다른 교직원이 먼저 판정했다면
       * 이력에 새 행이 붙어 있다. 어느 쪽이든 잠금은 아무 말도 하지 않으므로, 요청이 들고 온
       * 기대 버전과 실제를 여기서 대조해야 한다. 대조가 없으면 **교직원이 보지 못한 내용이
       * 승인되거나** 더 최신 판정이 조용히 덮인다.
       *
       * 두 값을 **둘 다** 보는 이유는 서로 다른 사건을 잡기 때문이다 — 재제출은 `revision`만
       * 움직이고(판정 이력은 그대로), 남의 판정은 최신 판정 id만 움직인다(제출은 그대로).
       * 하나만 보면 나머지 한 사건이 그대로 통과한다.
       *
       * 재제출 쪽 축이 `submittedAt`이 아니라 `revision`인 이유: `submittedAt`은 `TIMESTAMP(3)`
       * 이라 같은 팀의 두 사람이(또는 재시도가) 같은 밀리초 안에 다시 내면 값이 같고, upsert라
       * 행 id도 그대로다 — 대조가 통과하는데 내용은 바뀌어 있다. 리비전은 시계가 아니라 이 행에
       * 도달한 **쓰기 횟수**를 세므로 그 창이 없다(`upsertSubmission`이 잠금 아래에서 올린다).
       *
       * 검사가 **잠금 아래**여야 하는 이유: 잠금 전에 읽으면 읽은 뒤 커밋되는 재제출·판정을
       * 그대로 놓쳐 지금 고치려는 문제가 그대로 반복된다. 학생 제출 경로가 같은
       * `MilestoneDocument` 행을 `FOR SHARE`로 잡으므로, 이 지점에서 읽는 값은 「경합하던
       * 트랜잭션이 커밋을 끝낸 뒤」의 값이다.
       */
      if (submission.revision !== input.expectedRevision) {
        throw this.error(MilestoneDocumentsErrorCode.REVIEW_TARGET_CHANGED);
      }
      const latestReviewId = await store.findLatestReviewIdForSubmission(
        submission.id,
      );
      if (latestReviewId !== input.expectedLatestReviewId) {
        throw this.error(MilestoneDocumentsErrorCode.REVIEW_TARGET_CHANGED);
      }

      const review = await store.createReview({
        milestoneDocumentSubmissionId: submission.id,
        submissionHistoryId: submission.submissionHistoryId,
        revision: submission.revision,
        reviewerId,
        decision: input.decision,
        comment: input.comment,
        reviewedAt,
      });
      await store.updateSubmissionStatus(
        submission.id,
        reviewDecisionToSubmissionStatus(input.decision),
      );
      return review;
    });

    return MilestoneDocumentReviewResponseDto.from(created);
  }

  private error(code: MilestoneDocumentsErrorCode): DomainException {
    return new DomainException(MILESTONE_DOCUMENTS_ERROR_CODES[code]);
  }
}
