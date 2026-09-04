import { SubmissionStatus } from '@prisma/client';
import { MilestoneDocumentRecord } from '../milestone-documents.repository';

/**
 * 학생 뷰 — 이 서류에 붙은 최신 판정의 **사유와 시각**. 화면이 「왜 되돌아왔는가」를 말하는 데
 * 쓴다.
 *
 * ⚠ `decision`을 따로 싣지 않는다. 예전 주석은 그 이유를 「판정 → 상태 매핑이 1:1이라 옆의
 * `status`에 같은 뜻이 이미 있다」고 적었지만 **그것은 사실이 아니다**(#1097): 재제출은 상태를
 * `SUBMITTED`로 되돌리는데 판정 이력은 되돌아가지 않아, 보완 요청에 응한 서류는 상태가
 * `SUBMITTED`인 채 최신 판정이 `CHANGES_REQUESTED`로 남는다.
 *
 * 그래도 싣지 않는 것은, 화면이 잠금을 정할 때 필요한 것이 판정 값이 아니라 **「학생이 아직
 * 응해야 하는가」**이고 그 답이 정확히 `status`이기 때문이다. `CHANGES_REQUESTED`면 아직 응하지
 * 않은 것, `SUBMITTED`면 이미 응해 교직원 차례인 것이다 — 서버의 마감 판단
 * (`domain/milestone-document-submission-window.ts`의 `isChangeRequestResubmissionOpen`)도 같은
 * 두 값을 본다. 「첫 검토 대기」와 「재검토 대기」의 구분은 옆의 `revision`이 맡는다.
 *
 * 여기에 `decision`을 더하려면 그 값으로 **무엇을 다르게 그릴지**부터 정해야 한다. 쓰는 데
 * 없이 실으면 화면마다 다른 근거로 같은 잠금을 계산하기 시작한다.
 */
export interface MilestoneDocumentViewerReviewResponseDto {
  readonly comment: string | null;
  readonly reviewedAt: string;
  /**
   * 이 보완 요청에 **언제까지** 응할 수 있는가. 승인·반려면 null이고, 이 값이 생기기 전에
   * 저장된 보완 요청도 null이다.
   *
   * 위에서 `decision`을 싣지 않은 근거(「그 값으로 무엇을 다르게 그릴지부터 정해야 한다」)를
   * 이 필드는 통과한다 — 화면이 **잠금과 문구 둘 다** 이 값으로 정한다. 마감 뒤 재제출 창을
   * 이 시각에 닫고(`isMilestoneDocumentDeadlineLocked`), 닫히기 전에는 「언제까지」를 적는다.
   * 기한을 말하지 않고 잠그면 학생은 어제까지였다는 사실을 모른 채 버튼이 사라진 것만 본다.
   */
  readonly resubmissionDueAt: string | null;
}

/**
 * 학생 뷰 — 이 서류 항목을 내(팀)가 제출했는지. 행이 없으면 미제출(submitted:false)이고,
 * 그때는 `status`·`review`도 함께 null이다(판정은 제출에 붙는다).
 */
export interface MilestoneDocumentViewerSubmissionResponseDto {
  readonly submitted: boolean;
  readonly submittedAt: string | null;
  /** 현재 제출본 번호. 두 번째부터는 화면이 「재검토 대기」로 구분한다. */
  readonly revision: number | null;
  /**
   * 최신 판정이 옮겨 놓은 제출 상태 — 그리고 재제출이 `SUBMITTED`로 되돌려 놓는 값. 미제출이면
   * null. 화면의 마감 잠금(`isMilestoneDocumentDeadlineLocked`)이 이 값을 본다.
   */
  readonly status: SubmissionStatus | null;
  readonly hasCurrentFile: boolean;
  /** 아직 아무도 판정하지 않았으면 null. */
  readonly review: MilestoneDocumentViewerReviewResponseDto | null;
  /**
   * 목록에는 이력을 싣지 않는다. 이력이 있으면 전용 cursor endpoint에서 읽어야 하며,
   * 그 endpoint의 전체 이력을 이 응답이 모두 포함하지 않았음을 명시한다.
   */
  readonly history: {
    readonly hasHistory: boolean;
    readonly isComplete: boolean;
  };
}

/** 교직원 뷰 — 이 서류 항목의 팀 제출 집계("6 / 8팀 제출"). */
export interface MilestoneDocumentTeamSubmissionCountResponseDto {
  readonly submitted: number;
  readonly total: number;
}

export interface MilestoneDocumentViewerResponseDto {
  readonly viewerSubmission?: MilestoneDocumentViewerSubmissionResponseDto;
  readonly teamSubmissionCount?: MilestoneDocumentTeamSubmissionCountResponseDto;
}

/**
 * `GET /milestones/:milestoneId/documents` 응답의 서류 항목 하나.
 *
 * ⚠ `required`·`viewerSubmission.submitted`는 ADR-004의 boolean `is` 접두사 규칙에 어긋나지만
 * **이미 발행돼 학생·편집 화면이 쓰는 계약**이라 그대로 둔다(`submitted`를 `isSubmitted`로
 * 바꾸면 학생 화면이 조용히 「전부 미제출」로 보인다). 이번에 더한 `status`·`review`는 boolean이
 * 아니라 접두사 규칙의 대상이 아니다 — 새 boolean을 더할 일이 생기면 그때는 `is`/`has`를 쓴다.
 * 수합 표 응답
 * (`MilestoneDocumentCollectionDocumentResponseDto.isRequired`,
 * `MilestoneDocumentCollectionCellResponseDto.isSubmitted`)이 규칙을 따르는 것은 그쪽이 아직
 * 발행 전이기 때문이다 — 이름이 비슷하다고 여기까지 함께 바꾸면 화면이 조용히 깨진다.
 */
export class MilestoneDocumentResponseDto {
  id: string;
  milestoneId: string;
  name: string;
  required: boolean;
  sortOrder: number;
  hasTemplateFile: boolean;
  templateFileName: string | null;
  /** 학생 뷰에서만 채워진다. */
  viewerSubmission?: MilestoneDocumentViewerSubmissionResponseDto;
  /** 교직원 뷰에서만 채워진다. */
  teamSubmissionCount?: MilestoneDocumentTeamSubmissionCountResponseDto;

  private constructor(
    record: MilestoneDocumentRecord,
    viewer: MilestoneDocumentViewerResponseDto,
  ) {
    this.id = record.id;
    this.milestoneId = record.milestoneId;
    this.name = record.name;
    this.required = record.required;
    this.sortOrder = record.sortOrder;
    this.hasTemplateFile = record.templateFileId !== null;
    this.templateFileName = record.templateFileName;
    this.viewerSubmission = viewer.viewerSubmission;
    this.teamSubmissionCount = viewer.teamSubmissionCount;
  }

  static from(
    record: MilestoneDocumentRecord,
    viewer: MilestoneDocumentViewerResponseDto = {},
  ): MilestoneDocumentResponseDto {
    return new MilestoneDocumentResponseDto(record, viewer);
  }
}
