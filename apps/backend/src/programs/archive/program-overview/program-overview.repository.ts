import {
  authorityLabel,
  type AuthorityLabel,
} from '../../../users/domain/authority-label';
import { Injectable } from '@nestjs/common';
import { AccountStatus, MilestoneDocumentKind } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

export interface ProgramOverviewRecord {
  programId: string;
  name: string;
  trackType: string | null;
  lifecycle: string;
  milestoneCount: number;
  boardPostCount: number;

  participantCount: number;
  teamCount: number;
  connectedRepositoryCount: number;
}

export interface CurrentSubmissionMilestone {
  milestoneId: string;
  documentIds: string[];
  requiredDocumentIds: string[];
}

export interface ViewerIdentity {
  userId: string;
  role: AuthorityLabel | null;
}

export interface PublicTeamMemberRow {
  userId: string;

  displayName: string;
  isLeader: boolean;
}

export interface PublicTeamRow {
  teamId: string;
  name: string;
  members: PublicTeamMemberRow[];
}

export interface MilestoneSchedule {
  milestoneId: string;
  label: string;
  dueAt: Date;
}

export interface MilestoneDocumentCatalogEntry {
  milestoneId: string;

  title: string;
  documentIds: string[];
  requiredDocumentIds: string[];
}

const CURRENT_MILESTONE_SELECT = {
  id: true,
  documents: {
    where: { kind: MilestoneDocumentKind.DOCUMENT },
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
        trackType: true,
        lifecycle: true,
        _count: { select: { milestones: true, boardPosts: true, teams: true } },
      },
    });
    if (!program) {
      return null;
    }

    const [teamMemberRows, connectedRepositoryCount] = await Promise.all([
      this.prisma.teamMember.findMany({
        where: { programId },
        select: { userId: true },
        distinct: ['userId'],
      }),
      this.prisma.githubRepository.count({ where: { programId } }),
    ]);
    const participantIds = new Set<string>(
      teamMemberRows.map((row) => row.userId),
    );

    return {
      programId: program.id,
      name: program.name,
      trackType: program.trackType,
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
      select: {
        id: true,
        hasStaffAccess: true,
        hasAdminAccess: true,
        profile: { select: { memberKind: true } },
      },
    });
    if (user === null) {
      return null;
    }
    return {
      userId: user.id,
      role: authorityLabel({
        memberKind: user.profile?.memberKind ?? null,
        hasStaffAccess: user.hasStaffAccess,
        hasAdminAccess: user.hasAdminAccess,
      }),
    };
  }

  async findCurrentSubmissionMilestone(
    programId: string,
    now: Date,
  ): Promise<CurrentSubmissionMilestone | null> {
    const upcoming = await this.prisma.milestone.findFirst({
      where: {
        programId,
        dueAt: { gte: now },
        documents: { some: { kind: MilestoneDocumentKind.DOCUMENT } },
      },
      orderBy: { dueAt: 'asc' },
      select: CURRENT_MILESTONE_SELECT,
    });
    const milestone =
      upcoming ??
      (await this.prisma.milestone.findFirst({
        where: {
          programId,
          documents: { some: { kind: MilestoneDocumentKind.DOCUMENT } },
        },
        orderBy: { dueAt: 'desc' },
        select: CURRENT_MILESTONE_SELECT,
      }));
    return milestone ? toCurrentSubmissionMilestone(milestone) : null;
  }

  async findMilestoneSchedules(
    programId: string,
  ): Promise<MilestoneSchedule[]> {
    const milestones = await this.prisma.milestone.findMany({
      where: { programId },
      orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, dueAt: true },
    });
    return milestones.map((milestone) => ({
      milestoneId: milestone.id,
      label: milestone.name,
      dueAt: milestone.dueAt,
    }));
  }

  async findMilestoneDocumentCatalog(
    programId: string,
  ): Promise<MilestoneDocumentCatalogEntry[]> {
    const milestones = await this.prisma.milestone.findMany({
      where: { programId },
      orderBy: { dueAt: 'asc' },
      select: {
        id: true,
        name: true,
        documents: {
          where: { kind: MilestoneDocumentKind.DOCUMENT },
          select: { id: true, required: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
    return milestones.map((milestone) => ({
      milestoneId: milestone.id,
      title: milestone.name,
      documentIds: milestone.documents.map((document) => document.id),
      requiredDocumentIds: milestone.documents
        .filter((document) => document.required)
        .map((document) => document.id),
    }));
  }

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

  async findSubmittedDocumentIds(
    applicationId: string,
    documentIds: string[],
  ): Promise<Set<string>> {
    if (documentIds.length === 0) {
      return new Set();
    }
    const rows = await this.prisma.milestoneDocumentSubmission.groupBy({
      by: ['milestoneDocumentId'],
      where: { applicationId, milestoneDocumentId: { in: documentIds } },
    });
    return new Set(rows.map((row) => row.milestoneDocumentId));
  }

  async countFullySubmittedParticipants(
    programId: string,
    requiredDocumentIds: string[],
  ): Promise<number> {
    const result = await this.countFullySubmittedParticipantsForKeys(
      programId,
      new Map([['current', requiredDocumentIds]]),
    );
    return result.get('current') ?? 0;
  }

  async countFullySubmittedTeamsByMilestone(
    programId: string,
    milestones: readonly {
      milestoneId: string;
      requiredDocumentIds: string[];
    }[],
  ): Promise<Map<string, number>> {
    if (milestones.length === 0) {
      return new Map();
    }
    return this.countFullySubmittedTeamsForKeys(
      programId,
      new Map(milestones.map((m) => [m.milestoneId, m.requiredDocumentIds])),
    );
  }

  private async countFullySubmittedParticipantsForKeys(
    programId: string,
    requiredDocumentIdsByKey: ReadonlyMap<string, string[]>,
  ): Promise<Map<string, number>> {
    const keys = [...requiredDocumentIdsByKey.keys()];
    const applications = await this.prisma.application.findMany({
      where: { programId },
      select: { id: true, teamId: true },
    });
    if (applications.length === 0) {
      return new Map(keys.map((key) => [key, 0]));
    }

    const applicationIds = applications.map((application) => application.id);
    const submittedDocumentIdsByApplication =
      await this.loadSubmittedDocumentIdsByApplication(
        applicationIds,
        requiredDocumentIdsByKey,
      );

    const memberCountByTeam = await this.loadMemberCountByTeam(
      programId,
      applications,
    );

    const result = new Map<string, number>();
    for (const key of keys) {
      const requiredDocumentIds = requiredDocumentIdsByKey.get(key) ?? [];
      const fullySubmitted = applications.filter((application) =>
        this.hasAllRequiredDocuments(
          submittedDocumentIdsByApplication.get(application.id),
          requiredDocumentIds,
        ),
      );
      result.set(
        key,
        fullySubmitted.reduce(
          (total, application) =>
            total +
            (application.teamId
              ? (memberCountByTeam.get(application.teamId) ?? 0)
              : 1),
          0,
        ),
      );
    }
    return result;
  }

  private async countFullySubmittedTeamsForKeys(
    programId: string,
    requiredDocumentIdsByKey: ReadonlyMap<string, string[]>,
  ): Promise<Map<string, number>> {
    const keys = [...requiredDocumentIdsByKey.keys()];

    const applications = await this.prisma.application.findMany({
      where: { programId },
      select: { id: true, teamId: true },
    });
    if (applications.length === 0) {
      return new Map(keys.map((key) => [key, 0]));
    }

    const applicationIds = applications.map((application) => application.id);
    const submittedDocumentIdsByApplication =
      await this.loadSubmittedDocumentIdsByApplication(
        applicationIds,
        requiredDocumentIdsByKey,
      );

    const result = new Map<string, number>();
    for (const key of keys) {
      const requiredDocumentIds = requiredDocumentIdsByKey.get(key) ?? [];
      const completedTeamIds = new Set<string>();
      for (const application of applications) {
        if (
          this.hasAllRequiredDocuments(
            submittedDocumentIdsByApplication.get(application.id),
            requiredDocumentIds,
          )
        ) {
          if (application.teamId) {
            completedTeamIds.add(application.teamId);
          } else {
            completedTeamIds.add(`application:${application.id}`);
          }
        }
      }
      result.set(key, completedTeamIds.size);
    }
    return result;
  }

  private async loadSubmittedDocumentIdsByApplication(
    applicationIds: readonly string[],
    requiredDocumentIdsByKey: ReadonlyMap<string, string[]>,
  ): Promise<Map<string, Set<string>>> {
    const allRequiredDocumentIds = Array.from(
      new Set([...requiredDocumentIdsByKey.values()].flat()),
    );
    if (allRequiredDocumentIds.length === 0) {
      return new Map();
    }

    const rows = await this.prisma.milestoneDocumentSubmission.groupBy({
      by: ['milestoneDocumentId', 'applicationId'],
      where: {
        applicationId: { in: [...applicationIds] },
        milestoneDocumentId: { in: allRequiredDocumentIds },
      },
    });

    const submittedDocumentIdsByApplication = new Map<string, Set<string>>();
    for (const row of rows) {
      const set =
        submittedDocumentIdsByApplication.get(row.applicationId) ??
        new Set<string>();
      set.add(row.milestoneDocumentId);
      submittedDocumentIdsByApplication.set(row.applicationId, set);
    }
    return submittedDocumentIdsByApplication;
  }

  private hasAllRequiredDocuments(
    submitted: Set<string> | undefined,
    requiredDocumentIds: readonly string[],
  ): boolean {
    if (requiredDocumentIds.length === 0) {
      return true;
    }
    if (!submitted) {
      return false;
    }
    return requiredDocumentIds.every((documentId) => submitted.has(documentId));
  }

  private async loadMemberCountByTeam(
    programId: string,
    applications: readonly { id: string; teamId: string | null }[],
  ): Promise<Map<string, number>> {
    const teamIds = applications
      .map((application) => application.teamId)
      .filter((teamId): teamId is string => teamId !== null);
    if (teamIds.length === 0) {
      return new Map();
    }

    const memberCounts = await this.prisma.teamMember.groupBy({
      by: ['teamId'],
      where: { programId, teamId: { in: teamIds } },
      _count: { teamId: true },
    });
    return new Map(memberCounts.map((row) => [row.teamId, row._count.teamId]));
  }

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
