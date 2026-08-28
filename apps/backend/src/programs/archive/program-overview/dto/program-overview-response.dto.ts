import type { AuthorityLabel } from '../../../../common/authority-label';
import {
  ProgramOverviewMilestoneDocument,
  ProgramOverviewRemainingMilestone,
  ProgramOverviewView,
} from '../program-overview.service';

export class RemainingMilestoneResponseDto {
  readonly label: string;
  readonly dueAt: string;

  private constructor(milestone: ProgramOverviewRemainingMilestone) {
    this.label = milestone.label;
    this.dueAt = milestone.dueAt.toISOString();
  }

  static from(
    milestone: ProgramOverviewRemainingMilestone,
  ): RemainingMilestoneResponseDto {
    return new RemainingMilestoneResponseDto(milestone);
  }
}

/**
 * 마일스톤별 서류 분해 — 프론트 `ProgramScopeMilestoneDocsSummary`와 동일 계약
 * (`milestoneId` / `title` / `completed` / `total`).
 */
export class MilestoneDocumentSummaryResponseDto {
  readonly milestoneId: string;
  readonly title: string;
  readonly completed: number;
  readonly total: number;

  private constructor(entry: ProgramOverviewMilestoneDocument) {
    this.milestoneId = entry.milestoneId;
    this.title = entry.title;
    this.completed = entry.completed;
    this.total = entry.total;
  }

  static from(
    entry: ProgramOverviewMilestoneDocument,
  ): MilestoneDocumentSummaryResponseDto {
    return new MilestoneDocumentSummaryResponseDto(entry);
  }
}

/** `GET /programs/:programId/overview` 응답. */
export class ProgramOverviewResponseDto {
  programId: string;
  name: string;
  category: string;
  lifecycle: string;
  milestoneCount: number;
  boardPostCount: number;
  /** 참여 학생 수(공개) — TeamMember distinct. */
  participantCount: number;
  teamCount: number;
  connectedRepositoryCount: number;
  remainingMilestones: RemainingMilestoneResponseDto[];
  /** 아래 viewer 필드는 요청자 전용 — 역할별로 한쪽만 채워진다. */
  viewerRole: AuthorityLabel | null;
  /**
   * 학생 전용: "내 제출물" 부모 합계 N.
   * 범위는 **프로그램 전체 서류** 합(현재 마일스톤만이 아님).
   */
  viewerDocumentsCompleted: number | null;
  /** 학생 전용: "내 제출물" 부모 합계 M — 프로그램 전체 서류 수. */
  viewerDocumentsTotal: number | null;
  /** 교직원 전용: 팩트 바 "제출률"의 분자. 분모는 participantCount. */
  fullySubmittedParticipantCount: number | null;
  /**
   * 마일스톤별 서류 분해(viewer 전용, 서류 0개 마일스톤은 뺀다).
   * 프론트 `programScopeSidebarGroups({ milestoneDocuments })` 입력과 동일 키.
   */
  milestoneDocuments: MilestoneDocumentSummaryResponseDto[];

  private constructor(view: ProgramOverviewView) {
    this.programId = view.programId;
    this.name = view.name;
    this.category = view.category;
    this.lifecycle = view.lifecycle;
    this.milestoneCount = view.milestoneCount;
    this.boardPostCount = view.boardPostCount;
    this.participantCount = view.participantCount;
    this.teamCount = view.teamCount;
    this.connectedRepositoryCount = view.connectedRepositoryCount;
    this.remainingMilestones = view.remainingMilestones.map((milestone) =>
      RemainingMilestoneResponseDto.from(milestone),
    );
    this.viewerRole = view.viewer.role;
    this.viewerDocumentsCompleted = view.viewer.myDocumentsCompleted;
    this.viewerDocumentsTotal = view.viewer.myDocumentsTotal;
    this.fullySubmittedParticipantCount =
      view.viewer.fullySubmittedParticipantCount;
    this.milestoneDocuments = view.viewer.milestoneDocuments.map((entry) =>
      MilestoneDocumentSummaryResponseDto.from(entry),
    );
  }

  static from(view: ProgramOverviewView): ProgramOverviewResponseDto {
    return new ProgramOverviewResponseDto(view);
  }
}
