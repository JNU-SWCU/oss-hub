import { Injectable } from '@nestjs/common';
import { AccountStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** 프로그램 상세 화면 상단 요약 — 팩트 바가 쓰는 공개 집계값만 담는다. */
export interface ProgramOverviewRecord {
  programId: string;
  name: string;
  category: string;
  lifecycle: string;
  milestoneCount: number;
  boardPostCount: number;
  /** 팀 소속 인원 + 개인형 신청자를 합친 distinct 인원 수. */
  participantCount: number;
  teamCount: number;
  connectedRepositoryCount: number;
}

/**
 * 서류 항목이 걸린 "현재 제출 마일스톤" — 실제 순번(no) 필드가 스키마에 없어 dueAt으로
 * 대신 판정한다: 서류가 있는 마일스톤 중 dueAt이 아직 지나지 않은 것 중 가장 이른 것을
 * 고르고, 전부 지났으면 가장 최근에 지난 것으로 대체한다. 프로토타입의 "마일스톤 #3"이
 * 시드 데이터에서 이 규칙과 일치한다(#619 program-detail.md).
 */
export interface CurrentSubmissionMilestone {
  milestoneId: string;
  documentIds: string[];
  requiredDocumentIds: string[];
}

export interface ViewerIdentity {
  userId: string;
  role: Role | null;
}

/** #619 공개 팀 목록 — 저장소 URL·학번·연락처·이메일은 절대 select하지 않는다. */
export interface PublicTeamMemberRow {
  userId: string;
  /** 표시명은 GitHub nickname만 쓴다 — 실명(profile.name)은 공개 로스터에 노출하지 않는다. */
  displayName: string;
  isLeader: boolean;
}

export interface PublicTeamRow {
  teamId: string;
  name: string;
  members: PublicTeamMemberRow[];
}

const CURRENT_MILESTONE_SELECT = {
  id: true,
  documents: {
    select: { id: true, required: true },
    orderBy: { sortOrder: 'asc' as const },
  },
} as const;

type CurrentMilestoneSelection = {
  id: string;
  documents: { id: string; required: boolean }[];
};

function toCurrentSubmissionMilestone(
  milestone: CurrentMilestoneSelection,
): CurrentSubmissionMilestone {
  return {
    milestoneId: milestone.id,
    documentIds: milestone.documents.map((document) => document.id),
    requiredDocumentIds: milestone.documents
      .filter((document) => document.required)
      .map((document) => document.id),
  };
}

@Injectable()
export class ProgramOverviewRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByProgramId(
    programId: string,
  ): Promise<ProgramOverviewRecord | null> {
    const program = await this.prisma.program.findUnique({
      where: { id: programId },
      select: {
        id: true,
        name: true,
        category: true,
        lifecycle: true,
        _count: { select: { milestones: true, boardPosts: true, teams: true } },
      },
    });
    if (!program) {
      return null;
    }

    const [teamMemberRows, individualApplicantRows, connectedRepositoryCount] =
      await Promise.all([
        this.prisma.teamMember.findMany({
          where: { programId },
          select: { userId: true },
          distinct: ['userId'],
        }),
        this.prisma.application.findMany({
          where: { programId, teamId: null },
          select: { applicantId: true },
          distinct: ['applicantId'],
        }),
        this.prisma.repository.count({ where: { programId } }),
      ]);
    const participantIds = new Set<string>([
      ...teamMemberRows.map((row) => row.userId),
      ...individualApplicantRows.map((row) => row.applicantId),
    ]);

    return {
      programId: program.id,
      name: program.name,
      category: program.category,
      lifecycle: program.lifecycle,
      milestoneCount: program._count.milestones,
      boardPostCount: program._count.boardPosts,
      participantCount: participantIds.size,
      teamCount: program._count.teams,
      connectedRepositoryCount,
    };
  }

  async programExists(programId: string): Promise<boolean> {
    const count = await this.prisma.program.count({
      where: { id: programId },
    });
    return count > 0;
  }

  async findViewerIdentity(githubId: bigint): Promise<ViewerIdentity | null> {
    const user = await this.prisma.user.findFirst({
      where: { githubId, accountStatus: AccountStatus.ACTIVE },
      select: { id: true, role: true },
    });
    return user ? { userId: user.id, role: user.role } : null;
  }

  async findCurrentSubmissionMilestone(
    programId: string,
    now: Date,
  ): Promise<CurrentSubmissionMilestone | null> {
    const upcoming = await this.prisma.milestone.findFirst({
      where: { programId, dueAt: { gte: now }, documents: { some: {} } },
      orderBy: { dueAt: 'asc' },
      select: CURRENT_MILESTONE_SELECT,
    });
    const milestone =
      upcoming ??
      (await this.prisma.milestone.findFirst({
        where: { programId, documents: { some: {} } },
        orderBy: { dueAt: 'desc' },
        select: CURRENT_MILESTONE_SELECT,
      }));
    return milestone ? toCurrentSubmissionMilestone(milestone) : null;
  }

  /**
   * 학생 뷰어 본인의 신청(Application)을 찾는다: 본인이 신청자인 행을 먼저 찾고
   * (개인형 · 팀 리더가 신청서를 낸 경우), 없으면 소속 팀의 신청으로 대체한다
   * (신청자가 아닌 팀원도 팀 신청 기준으로 제출 현황을 본다).
   */
  async findViewerApplicationId(
    programId: string,
    userId: string,
  ): Promise<string | null> {
    const direct = await this.prisma.application.findFirst({
      where: { programId, applicantId: userId },
      select: { id: true },
      orderBy: { submittedAt: 'desc' },
    });
    if (direct) {
      return direct.id;
    }

    const membership = await this.prisma.teamMember.findUnique({
      where: { programId_userId: { programId, userId } },
      select: { teamId: true },
    });
    if (!membership) {
      return null;
    }

    const teamApplication = await this.prisma.application.findFirst({
      where: { programId, teamId: membership.teamId },
      select: { id: true },
      orderBy: { submittedAt: 'desc' },
    });
    return teamApplication?.id ?? null;
  }

  async countSubmittedDocuments(
    applicationId: string,
    documentIds: string[],
  ): Promise<number> {
    if (documentIds.length === 0) {
      return 0;
    }
    return this.prisma.milestoneDocumentSubmission.count({
      where: { applicationId, milestoneDocumentId: { in: documentIds } },
    });
  }

  /**
   * "제출 완료" 판정 기준은 필수 서류(required) 전건 제출이다 — 선택 서류는 완료 여부에
   * 영향을 주지 않는다. 반환값은 완료한 신청에 속한 참여 학생 수의 합(팀이면 팀원 수,
   * 개인형이면 1)이다. requiredDocumentIds가 비어 있으면(필수 서류 없음) 모든 신청을
   * 완료로 간주한다(vacuous true).
   *
   * 쿼리 수는 프로그램의 신청 건수와 무관하게 상수다: 신청 목록 조회 1 + 제출 groupBy 1
   * (+ 팀원 수 groupBy 1, 팀형 신청이 있을 때만) = 최대 3.
   */
  async countFullySubmittedParticipants(
    programId: string,
    requiredDocumentIds: string[],
  ): Promise<number> {
    const applications = await this.prisma.application.findMany({
      where: { programId },
      select: { id: true, teamId: true },
    });
    if (applications.length === 0) {
      return 0;
    }

    if (requiredDocumentIds.length === 0) {
      return this.sumParticipants(programId, applications);
    }

    const applicationIds = applications.map((application) => application.id);
    const submissionCounts =
      await this.prisma.milestoneDocumentSubmission.groupBy({
        by: ['applicationId'],
        where: {
          applicationId: { in: applicationIds },
          milestoneDocumentId: { in: requiredDocumentIds },
        },
        _count: { milestoneDocumentId: true },
      });
    const submittedCountByApplication = new Map(
      submissionCounts.map((row) => [
        row.applicationId,
        row._count.milestoneDocumentId,
      ]),
    );
    const fullySubmitted = applications.filter(
      (application) =>
        (submittedCountByApplication.get(application.id) ?? 0) ===
        requiredDocumentIds.length,
    );
    return this.sumParticipants(programId, fullySubmitted);
  }

  private async sumParticipants(
    programId: string,
    applications: readonly { id: string; teamId: string | null }[],
  ): Promise<number> {
    const teamIds = applications
      .map((application) => application.teamId)
      .filter((teamId): teamId is string => teamId !== null);
    if (teamIds.length === 0) {
      return applications.length;
    }

    const memberCounts = await this.prisma.teamMember.groupBy({
      by: ['teamId'],
      where: { programId, teamId: { in: teamIds } },
      _count: { teamId: true },
    });
    const memberCountByTeam = new Map(
      memberCounts.map((row) => [row.teamId, row._count.teamId]),
    );
    return applications.reduce(
      (total, application) =>
        total +
        (application.teamId
          ? (memberCountByTeam.get(application.teamId) ?? 0)
          : 1),
      0,
    );
  }

  /**
   * #619 공개 팀 목록 — dedicated public query: 명시적 select만 쓰고 팀명·인원·멤버
   * nickname·팀장 여부만 반환한다. `Repository`(저장소 URL)·`TeamMember.phone/email`·
   * `User.studentId`는 이 select에 절대 포함하지 않는다(프로토타입 문구 "팀 구성과
   * 인원만 공개됩니다 · 저장소는 비공개"). 표시명은 실명(profile.name)이 아니라
   * GitHub nickname만 쓴다 — 프로그램 내 다른 참가자 전원에게 노출되는 로스터라
   * 실명보다 넓은 공개 범위를 전제로 보수적으로 최소화한다.
   */
  async listPublicTeams(programId: string): Promise<PublicTeamRow[]> {
    const teams = await this.prisma.team.findMany({
      where: { programId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        leaderId: true,
        members: {
          select: { userId: true, user: { select: { nickname: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    return teams.map((team) => ({
      teamId: team.id,
      name: team.name,
      members: team.members.map((member) => ({
        userId: member.userId,
        displayName: member.user.nickname,
        isLeader: member.userId === team.leaderId,
      })),
    }));
  }
}
