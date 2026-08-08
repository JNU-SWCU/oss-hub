import { MilestoneSubmissionType } from '@prisma/client';
import { MilestoneDocumentRecord } from '../milestone-documents.repository';

/** 학생 뷰 — 이 서류 항목을 내(팀)가 제출했는지. 행이 없으면 미제출(submitted:false). */
export interface MilestoneDocumentViewerSubmissionResponseDto {
  readonly submitted: boolean;
  readonly submittedAt: string | null;
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
 * **이미 발행돼 학생·편집 화면이 쓰는 계약**이라 그대로 둔다. 수합 표 응답
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
  submissionType: MilestoneSubmissionType;
  hasTemplateFile: boolean;
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
    this.submissionType = record.submissionType;
    this.hasTemplateFile = record.templateFileId !== null;
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
