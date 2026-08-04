import { MilestoneSubmissionType } from '@prisma/client';
import { MilestoneDocumentRecord } from '../milestone-documents.repository';

/** 학생 뷰 — 이 서류 항목을 내(팀)가 제출했는지. 행이 없으면 미제출(submitted:false). */
export interface MilestoneDocumentViewerSubmissionView {
  readonly submitted: boolean;
  readonly submittedAt: string | null;
}

/** 교직원 뷰 — 이 서류 항목의 팀 제출 집계("6 / 8팀 제출"). */
export interface MilestoneDocumentTeamSubmissionCountView {
  readonly submitted: number;
  readonly total: number;
}

export interface MilestoneDocumentViewerView {
  readonly viewerSubmission?: MilestoneDocumentViewerSubmissionView;
  readonly teamSubmissionCount?: MilestoneDocumentTeamSubmissionCountView;
}

/** `GET /milestones/:milestoneId/documents` 응답의 서류 항목 하나. */
export class MilestoneDocumentResponseDto {
  id: string;
  milestoneId: string;
  name: string;
  required: boolean;
  sortOrder: number;
  submissionType: MilestoneSubmissionType;
  hasTemplateFile: boolean;
  /** 학생 뷰에서만 채워진다. */
  viewerSubmission?: MilestoneDocumentViewerSubmissionView;
  /** 교직원 뷰에서만 채워진다. */
  teamSubmissionCount?: MilestoneDocumentTeamSubmissionCountView;

  private constructor(
    record: MilestoneDocumentRecord,
    viewer: MilestoneDocumentViewerView,
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
    viewer: MilestoneDocumentViewerView = {},
  ): MilestoneDocumentResponseDto {
    return new MilestoneDocumentResponseDto(record, viewer);
  }
}
