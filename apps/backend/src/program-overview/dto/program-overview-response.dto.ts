import type { Role } from '@prisma/client';
import { ProgramOverviewView } from '../program-overview.service';

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
  /** 아래 4개 필드는 요청자(viewer) 전용 — 역할별로 한쪽만 채워진다. */
  viewerRole: Role | null;
  /** 학생 전용: "내 제출 N / M 서류"의 N. */
  viewerDocumentsCompleted: number | null;
  /** 학생 전용: "내 제출 N / M 서류"의 M. */
  viewerDocumentsTotal: number | null;
  /** 교직원 전용: "제출률"의 분자. 분모는 participantCount. */
  fullySubmittedParticipantCount: number | null;

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
    this.viewerRole = view.viewer.role;
    this.viewerDocumentsCompleted = view.viewer.myDocumentsCompleted;
    this.viewerDocumentsTotal = view.viewer.myDocumentsTotal;
    this.fullySubmittedParticipantCount =
      view.viewer.fullySubmittedParticipantCount;
  }

  static from(view: ProgramOverviewView): ProgramOverviewResponseDto {
    return new ProgramOverviewResponseDto(view);
  }
}
