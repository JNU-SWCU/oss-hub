import type { Role } from '@prisma/client';
import {
  ProgramOverviewMilestoneDocumentBreakdown,
  ProgramOverviewNextMilestone,
  ProgramOverviewView,
} from '../program-overview.service';

/** 마감 카운트다운 — 아직 마감되지 않은 가장 이른 마일스톤. 역할과 무관하게 같은 값이다. */
export class NextMilestoneResponseDto {
  readonly label: string;
  readonly dueAt: string;

  private constructor(nextMilestone: ProgramOverviewNextMilestone) {
    this.label = nextMilestone.label;
    this.dueAt = nextMilestone.dueAt.toISOString();
  }

  static from(
    nextMilestone: ProgramOverviewNextMilestone,
  ): NextMilestoneResponseDto {
    return new NextMilestoneResponseDto(nextMilestone);
  }
}

/** 마일스톤별 서류 분해 — "내 제출물"/"서류 현황" 아래 중첩 뱃지로 쓰인다. */
export class MilestoneDocumentBreakdownResponseDto {
  readonly milestoneId: string;
  readonly milestoneTitle: string;
  readonly completed: number;
  readonly total: number;

  private constructor(entry: ProgramOverviewMilestoneDocumentBreakdown) {
    this.milestoneId = entry.milestoneId;
    this.milestoneTitle = entry.milestoneTitle;
    this.completed = entry.completed;
    this.total = entry.total;
  }

  static from(
    entry: ProgramOverviewMilestoneDocumentBreakdown,
  ): MilestoneDocumentBreakdownResponseDto {
    return new MilestoneDocumentBreakdownResponseDto(entry);
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
  /** 팀 소속 인원 + 개인형 신청자를 합친 참여 학생 수(공개). */
  participantCount: number;
  teamCount: number;
  connectedRepositoryCount: number;
  /** 마감 카운트다운(공개, 역할 무관). 다가오는 마일스톤이 없으면 null. */
  nextMilestone: NextMilestoneResponseDto | null;
  /** 아래 4개 필드는 요청자(viewer) 전용 — 역할별로 한쪽만 채워진다. */
  viewerRole: Role | null;
  /** 학생 전용: "내 제출 N / M 서류"의 N. */
  viewerDocumentsCompleted: number | null;
  /** 학생 전용: "내 제출 N / M 서류"의 M. */
  viewerDocumentsTotal: number | null;
  /** 교직원 전용: "제출률"의 분자. 분모는 participantCount. */
  fullySubmittedParticipantCount: number | null;
  /** 마일스톤별 서류 분해(viewer 전용, 서류 0개 마일스톤은 뺀다). */
  milestoneDocumentBreakdown: MilestoneDocumentBreakdownResponseDto[];

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
    this.nextMilestone = view.nextMilestone
      ? NextMilestoneResponseDto.from(view.nextMilestone)
      : null;
    this.viewerRole = view.viewer.role;
    this.viewerDocumentsCompleted = view.viewer.myDocumentsCompleted;
    this.viewerDocumentsTotal = view.viewer.myDocumentsTotal;
    this.fullySubmittedParticipantCount =
      view.viewer.fullySubmittedParticipantCount;
    this.milestoneDocumentBreakdown =
      view.viewer.milestoneDocumentBreakdown.map((entry) =>
        MilestoneDocumentBreakdownResponseDto.from(entry),
      );
  }

  static from(view: ProgramOverviewView): ProgramOverviewResponseDto {
    return new ProgramOverviewResponseDto(view);
  }
}
