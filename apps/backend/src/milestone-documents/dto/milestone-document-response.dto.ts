import { SubmissionStatus } from '@prisma/client';
import { MilestoneDocumentRecord } from '../milestone-documents.repository';

/**
 * 학생 뷰 — 이 서류에 붙은 최신 판정. `decision`을 따로 싣지 않는 것은 같은 뜻이 옆의
 * `status`에 이미 있기 때문이다(판정 → 상태 매핑은 1:1이다). 여기 있는 것은 화면이 「왜
 * 되돌아왔는가」를 말하기 위해 필요한 사유와 시각이다.
 */
export interface MilestoneDocumentViewerReviewResponseDto {
  readonly comment: string | null;
  readonly reviewedAt: string;
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
  /** 최신 판정이 옮겨 놓은 제출 상태. 미제출이면 null. */
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
