import { Injectable } from '@nestjs/common';
import {
  ProgramTeamRepositoryEvidenceRepository,
  type TeamActivityScope,
} from './program-team-repository-evidence.repository';
import type {
  TeamActivityView,
  TeamRepositoryEvidenceView,
  RepositoryUrlHistoryCursor,
  RepositoryUrlHistoryPage,
} from '../domain/program-team-repository-evidence.types';
import {
  AccountStatus,
  ApplicationStatus,
  MilestoneDocumentKind,
  OutboxEventStatus,
  Prisma,
  RepositoryProvisionJobStatus,
  type ProgramCategory,
} from '@prisma/client';
import type { AuditLogTransactionWriter } from '../../prisma/audit-log-transaction-writer';
import { PrismaService } from '../../prisma/prisma.service';
import { requiredMilestonesApproved } from '../../milestone-documents/domain/milestone-completion';
import { publishBlockedReasons } from '../../github/domain/repository-publication';
import { repositoryUrlFromNameWithOwner } from '../../github/domain/repository-identity';
import { repositoryAccessSyncEventData } from '../../github/domain/repository-provision-event';
import { repositoryAccessSyncTargetWhere } from '../../prisma/repository-access-sync';
import {
  projectSubmissionCompletionTargets,
  submissionCompletionTargetSelect,
} from '../../submissions/domain/submission-completion-projection';
import {
  STUDENT_MEMBER_WHERE,
  USER_PROFILE_NAME_SELECT,
  resolveUserProfileName,
} from '../../prisma/user-profile-read';
import type {
  TeamApplicationView,
  TeamRepositoryProvisioningJobStatus,
  TeamRepositoryProvisioningSafeErrorClass,
} from '../domain/program-teams.types';

export interface TeamStudentActor {
  readonly id: string;
  readonly name: string | null;
  readonly nickname: string;
}

export interface TeamProgramRecord {
  readonly id: string;
  readonly name: string;
  readonly category: ProgramCategory;
  readonly applicationStartAt: Date;
  readonly applicationEndAt: Date;
  readonly teamMinSize: number;
  readonly teamMaxSize: number;
}

export interface TeamMembershipRecord {
  readonly teamId: string;
  readonly userId: string;
}

export interface CreateTeamRecordInput {
  readonly programId: string;
  readonly name: string;
  readonly joinCodeDigest: string;
  readonly leaderId: string;
}

export interface CreatedTeamRecord {
  readonly id: string;
  readonly name: string;
}

export interface TeamDetailRecord {
  readonly id: string;
  readonly name: string;
  readonly leaderId: string;
  readonly programId: string;
  readonly teamMinSize: number;
  readonly teamMaxSize: number;
  readonly hasApplication: boolean;
  readonly members: readonly {
    readonly userId: string;
    readonly nickname: string;
    readonly name: string | null;
  }[];
}

export interface StaffTeamRecord {
  readonly id: string;
  readonly name: string;
  readonly leaderId: string;
  readonly members: readonly {
    readonly userId: string;
    readonly nickname: string;
    readonly name: string | null;
  }[];
}

export interface StaffTeamDetailRecord extends TeamRepositoryEvidenceView {
  readonly id: string;
  readonly name: string;
  readonly leaderId: string;
  readonly members: readonly {
    readonly userId: string;
    readonly nickname: string;
    readonly name: string | null;
  }[];
  readonly application: TeamApplicationView | null;
}

export class TeamMembershipConflictError extends Error {
  override readonly name = 'TeamMembershipConflictError';
}

export class JoinCodeDigestConflictError extends Error {
  override readonly name = 'JoinCodeDigestConflictError';
}

export type TeamLeaveResult =
  'removed' | 'not-found' | 'last-member-with-application';

export type TeamRemoveMemberResult =
  | 'removed'
  | 'actor-not-in-team'
  | 'not-leader'
  | 'self-target'
  | 'target-not-found';

export type StaffRemoveMemberResult =
  'removed' | 'forbidden' | 'not-found' | 'last-member-with-application';

export type StaffTransferLeaderResult =
  'transferred' | 'unchanged' | 'forbidden' | 'not-found';

export type TeamRenameResult = 'renamed' | 'not-found' | 'forbidden';

export interface TeamRenameAuditEvent {
  readonly teamId: string;
  readonly programName: string;
  readonly previousName: string;
  readonly nextName: string;
}

export type RecordTeamRenameAudit = (
  store: TeamMembershipAuditStore,
  event: TeamRenameAuditEvent,
) => Promise<void>;

export interface TeamActorAuthority {
  readonly id: string;
  readonly isStaff: boolean;
}

export type TeamMembershipOperation = 'LEAVE' | 'REMOVE' | 'TRANSFER_LEADER';

export interface TeamMembershipAuditEvent {
  readonly teamId: string;
  readonly programName: string;
  readonly teamName: string;
  readonly operation: TeamMembershipOperation;

  readonly removedUserId: string | null;
  readonly previousLeaderId: string;
  readonly nextLeaderId: string | null;
}

export interface TeamMembershipAuditStore {
  readonly auditLogWriter: AuditLogTransactionWriter;
}

export type RecordTeamMembershipAudit = (
  store: TeamMembershipAuditStore,
  event: TeamMembershipAuditEvent,
) => Promise<void>;

export interface ProgramTeamsCreateStore {
  readonly auditLogWriter: AuditLogTransactionWriter;
  findMembershipByProgramUser(
    programId: string,
    userId: string,
  ): Promise<TeamMembershipRecord | null>;
  createTeamWithLeader(
    input: CreateTeamRecordInput,
  ): Promise<CreatedTeamRecord>;
}

@Injectable()
export class ProgramTeamsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findActiveStudentByGithubId(
    githubId: bigint,
  ): Promise<TeamStudentActor | null> {
    const user = await this.prisma.user.findFirst({
      where: {
        githubId,
        accountStatus: AccountStatus.ACTIVE,
        ...STUDENT_MEMBER_WHERE,
      },
      select: {
        id: true,
        nickname: true,
        ...USER_PROFILE_NAME_SELECT,
      },
    });
    return user
      ? {
          id: user.id,
          nickname: user.nickname,
          name: resolveUserProfileName(user),
        }
      : null;
  }

  async findActorAuthorityByGithubId(
    githubId: bigint,
  ): Promise<TeamActorAuthority | null> {
    const user = await this.prisma.user.findUnique({
      where: { githubId },
      select: {
        id: true,
        hasStaffAccess: true,
        hasAdminAccess: true,
        accountStatus: true,
      },
    });
    if (user?.accountStatus !== AccountStatus.ACTIVE) return null;
    return {
      id: user.id,
      isStaff: user.hasStaffAccess || user.hasAdminAccess,
    };
  }

  async renameTeam(
    programId: string,
    teamId: string,
    actor: TeamActorAuthority,
    name: string,
    recordAudit: RecordTeamRenameAudit,
  ): Promise<TeamRenameResult> {
    return this.prisma.$transaction(async (tx) => {
      await lockTeamRow(tx, teamId);

      const team = await tx.team.findUnique({
        where: { id: teamId },
        select: {
          programId: true,
          name: true,
          leaderId: true,
          program: { select: { name: true } },
        },
      });
      if (!team || team.programId !== programId) return 'not-found';
      if (!actor.isStaff && team.leaderId !== actor.id) return 'forbidden';
      if (team.name === name) return 'renamed';

      await tx.team.update({ where: { id: teamId }, data: { name } });
      await recordAudit(
        { auditLogWriter: tx },
        {
          teamId,
          programName: team.program.name,
          previousName: team.name,
          nextName: name,
        },
      );
      return 'renamed';
    });
  }

  findProgramById(programId: string): Promise<TeamProgramRecord | null> {
    return this.prisma.program.findUnique({
      where: { id: programId },
      select: {
        id: true,
        name: true,
        category: true,
        applicationStartAt: true,
        applicationEndAt: true,
        teamMinSize: true,
        teamMaxSize: true,
      },
    });
  }

  async findTeamDetailForUser(
    programId: string,
    userId: string,
  ): Promise<TeamDetailRecord | null> {
    const membership = await this.prisma.teamMember.findUnique({
      where: {
        programId_userId: { programId, userId },
      },
      select: {
        team: {
          select: {
            id: true,
            name: true,
            leaderId: true,
            programId: true,
            program: {
              select: { teamMinSize: true, teamMaxSize: true },
            },
            applications: { select: { id: true }, take: 1 },
            members: {
              select: {
                userId: true,
                user: {
                  select: {
                    nickname: true,
                    ...USER_PROFILE_NAME_SELECT,
                  },
                },
              },
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            },
          },
        },
      },
    });
    if (!membership) return null;
    const team = membership.team;
    return {
      id: team.id,
      name: team.name,
      leaderId: team.leaderId,
      programId: team.programId,
      teamMinSize: team.program.teamMinSize,
      teamMaxSize: team.program.teamMaxSize,
      hasApplication: team.applications.length > 0,
      members: team.members.map((member) => ({
        userId: member.userId,
        nickname: member.user.nickname,
        name: resolveUserProfileName(member.user),
      })),
    };
  }

  async listStaffTeams(programId: string): Promise<StaffTeamRecord[]> {
    const teams = await this.prisma.team.findMany({
      where: { programId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        leaderId: true,
        members: {
          select: {
            userId: true,
            user: {
              select: {
                nickname: true,
                ...USER_PROFILE_NAME_SELECT,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    return teams.map((team) => ({
      id: team.id,
      name: team.name,
      leaderId: team.leaderId,
      members: team.members.map((member) => ({
        userId: member.userId,
        nickname: member.user.nickname,
        name: resolveUserProfileName(member.user),
      })),
    }));
  }

  async findStaffTeamDetail(
    programId: string,
    teamId: string,
  ): Promise<StaffTeamDetailRecord | null> {
    const team = await this.prisma.team.findFirst({
      where: { id: teamId, programId },
      select: {
        id: true,
        name: true,
        leaderId: true,
        members: {
          select: {
            userId: true,
            user: {
              select: {
                githubId: true,
                nickname: true,
                ...USER_PROFILE_NAME_SELECT,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!team) return null;

    const application = await this.prisma.application.findFirst({
      where: { programId, teamId },
      select: {
        id: true,
        status: true,
        updatedAt: true,
        repositoryConnectionMode: true,
        repositoryUrl: true,
        isRepositoryPublicationPlanned: true,

        repository: {
          select: {
            id: true,
            nameWithOwner: true,
            visibility: true,
            lastSuccessAt: true,
            failureCount: true,
          },
        },
        program: {
          select: {
            id: true,
            startAt: true,
            repositoryProvisioningEnabled: true,
            endAt: true,
            milestones: {
              select: {
                id: true,
                submissionType: true,
                documents: {
                  where: {
                    required: true,
                    kind: MilestoneDocumentKind.DOCUMENT,
                  },
                  select: { id: true },
                },
              },
            },
          },
        },
        milestoneDocumentSubmissions: {
          select: submissionCompletionTargetSelect,
        },
      },
    });

    let applicationView: TeamApplicationView | null = null;
    if (application) {
      const [outbox, job] = await Promise.all([
        this.prisma.outboxEvent.findUnique({
          where: { idempotencyKey: `repository-provision:${application.id}` },
          select: { status: true, createdAt: true },
        }),
        this.prisma.repositoryProvisionJob.findUnique({
          where: { applicationId: application.id },
          select: {
            status: true,
            updatedAt: true,
            lastErrorCode: true,
            repositoryId: true,
          },
        }),
      ]);
      const repository = application.repository;
      const completionTargets = projectSubmissionCompletionTargets(
        application.milestoneDocumentSubmissions,
      );
      const blockedReasons = repository
        ? publishBlockedReasons(
            {
              visibility: repository.visibility,
              provisionStatus:
                job?.repositoryId === repository.id ? job.status : null,
              requiredMilestonesApproved: requiredMilestonesApproved(
                application.program.milestones,
                completionTargets.submissions,
                completionTargets.documentSubmissions,
              ),
              isRepositoryPublicationPlanned:
                application.isRepositoryPublicationPlanned,
              programEndAt: application.program.endAt,
            },
            new Date(),
          )
        : [];
      applicationView = {
        id: application.id,
        status: application.status,
        repositoryConnectionMode: application.repositoryConnectionMode,
        repository: repository
          ? {
              id: repository.id,
              url: repositoryUrlFromNameWithOwner(repository.nameWithOwner),
              visibility: repository.visibility,
              publishEligible: blockedReasons.length === 0,
              blockedReasons,
            }
          : null,
        repositoryProvisioning:
          repository &&
          application.repositoryUrl ===
            repositoryUrlFromNameWithOwner(repository.nameWithOwner) &&
          job?.repositoryId === repository.id &&
          job.status === RepositoryProvisionJobStatus.SUCCEEDED
            ? {
                enabled: application.program.repositoryProvisioningEnabled,
                jobStatus: 'SUCCEEDED',
                updatedAt: job.updatedAt,
                safeErrorClass: null,
              }
            : resolveTeamRepositoryProvisioning(
                application.status,
                application.program.repositoryProvisioningEnabled,
                application.updatedAt,
                outbox ?? undefined,
                job ?? undefined,
              ),
      };
    }

    return {
      id: team.id,
      name: team.name,
      leaderId: team.leaderId,
      members: team.members.map((member) => ({
        userId: member.userId,
        nickname: member.user.nickname,
        name: resolveUserProfileName(member.user),
      })),
      application: applicationView,
      repositoryContributions: application
        ? await new ProgramTeamRepositoryEvidenceRepository(
            this.prisma,
          ).contributions(application, team.members)
        : null,
      repositoryUrlHistory: application
        ? await new ProgramTeamRepositoryEvidenceRepository(
            this.prisma,
          ).history({ programId, teamId, applicationId: application.id })
        : { items: [], nextCursor: null },
    };
  }

  async findStaffRepositoryUrlHistory(
    programId: string,
    teamId: string,
    cursor?: RepositoryUrlHistoryCursor,
  ): Promise<RepositoryUrlHistoryPage | null> {
    const team = await this.prisma.team.findFirst({
      where: { id: teamId, programId },
      select: { id: true },
    });
    if (!team) return null;
    const application = await this.prisma.application.findFirst({
      where: { programId, teamId },
      select: { id: true },
    });
    if (!application) return { items: [], nextCursor: null };
    return new ProgramTeamRepositoryEvidenceRepository(this.prisma).history(
      { programId, teamId, applicationId: application.id },
      cursor,
    );
  }

  async findTeamActivityScope(
    programId: string,
    teamId: string,
  ): Promise<TeamActivityScope | null> {
    const team = await this.prisma.team.findFirst({
      where: { id: teamId, programId },
      select: {
        leaderId: true,
        program: { select: { startAt: true, endAt: true } },
        members: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: {
            userId: true,
            user: { select: { githubId: true, nickname: true } },
          },
        },
        applications: {
          where: { programId },
          take: 1,
          select: {
            id: true,
            status: true,
            repository: {
              select: {
                id: true,
                nameWithOwner: true,
                lastSuccessAt: true,
                failureCount: true,
              },
            },
          },
        },
      },
    });
    if (!team) return null;
    const { applications, ...scope } = team;
    return { ...scope, application: applications[0] ?? null };
  }

  readTeamActivity(
    team: TeamActivityScope,
  ): Promise<Omit<TeamActivityView, 'canEditRepositoryUrl'>> {
    return new ProgramTeamRepositoryEvidenceRepository(this.prisma).activity(
      team,
    );
  }

  withCreateTransaction<T>(
    operation: (store: ProgramTeamsCreateStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((tx) =>
      operation(new PrismaProgramTeamsCreateStore(tx)),
    );
  }

  async leave(
    programId: string,
    userId: string,
    recordAudit: RecordTeamMembershipAudit,
  ): Promise<TeamLeaveResult> {
    return this.prisma.$transaction(async (tx) => {
      const membership = await tx.teamMember.findUnique({
        where: { programId_userId: { programId, userId } },
        select: { teamId: true },
      });
      if (!membership) return 'not-found';

      await lockTeamRow(tx, membership.teamId);

      const lockedMembership = await tx.teamMember.findUnique({
        where: { programId_userId: { programId, userId } },
        select: TEAM_MEMBERSHIP_CONTEXT_SELECT,
      });
      if (!lockedMembership || lockedMembership.teamId !== membership.teamId) {
        return 'not-found';
      }

      const now = new Date();
      const teamId = lockedMembership.teamId;
      const previousLeaderId = lockedMembership.team.leaderId;
      const [memberCount, application] = await Promise.all([
        tx.teamMember.count({ where: { teamId } }),
        tx.application.findFirst({ where: { teamId }, select: { id: true } }),
      ]);

      if (memberCount <= 1) {
        if (application !== null) return 'last-member-with-application';

        await tx.teamMember.delete({
          where: { teamId_userId: { teamId, userId } },
        });
        await tx.teamInvitation.deleteMany({ where: { teamId, programId } });
        await tx.team.delete({ where: { id: teamId } });
        await recordAudit(
          { auditLogWriter: tx },
          membershipAuditEvent(lockedMembership, {
            operation: 'LEAVE',
            removedUserId: userId,
            previousLeaderId,
            nextLeaderId: null,
          }),
        );
        return 'removed';
      }

      let nextLeaderId = previousLeaderId;
      if (previousLeaderId === userId) {
        const successor = await tx.teamMember.findFirst({
          where: { teamId, userId: { not: userId } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { userId: true },
        });
        if (!successor) {
          throw new Error(
            'team member count and roster disagree inside the team lock',
          );
        }
        nextLeaderId = successor.userId;

        await tx.team.update({
          where: { id: teamId },
          data: { leaderId: nextLeaderId },
        });
      }

      await tx.teamMember.delete({
        where: { teamId_userId: { teamId, userId } },
      });

      await enqueueRepositoryAccessSyncEvents(tx, teamId, now);
      await recordAudit(
        { auditLogWriter: tx },
        membershipAuditEvent(lockedMembership, {
          operation: 'LEAVE',
          removedUserId: userId,
          previousLeaderId,
          nextLeaderId,
        }),
      );
      return 'removed';
    });
  }

  async removeMember(
    programId: string,
    actorUserId: string,
    targetUserId: string,
    recordAudit: RecordTeamMembershipAudit,
  ): Promise<TeamRemoveMemberResult> {
    return this.prisma.$transaction(async (tx) => {
      const actorMembership = await tx.teamMember.findUnique({
        where: { programId_userId: { programId, userId: actorUserId } },
        select: { teamId: true },
      });
      if (!actorMembership) return 'actor-not-in-team';

      await lockTeamRow(tx, actorMembership.teamId);

      const lockedActor = await tx.teamMember.findUnique({
        where: { programId_userId: { programId, userId: actorUserId } },
        select: TEAM_MEMBERSHIP_CONTEXT_SELECT,
      });
      if (!lockedActor || lockedActor.teamId !== actorMembership.teamId) {
        return 'actor-not-in-team';
      }

      const now = new Date();
      const teamId = lockedActor.teamId;
      const leaderId = lockedActor.team.leaderId;

      if (leaderId !== actorUserId) return 'not-leader';
      if (targetUserId === actorUserId) return 'self-target';

      const targetMembership = await tx.teamMember.findUnique({
        where: { programId_userId: { programId, userId: targetUserId } },
        select: { teamId: true },
      });
      if (!targetMembership || targetMembership.teamId !== teamId) {
        return 'target-not-found';
      }

      await tx.teamMember.delete({
        where: { teamId_userId: { teamId, userId: targetUserId } },
      });

      await enqueueRepositoryAccessSyncEvents(tx, teamId, now);
      await recordAudit(
        { auditLogWriter: tx },
        membershipAuditEvent(lockedActor, {
          operation: 'REMOVE',
          removedUserId: targetUserId,
          previousLeaderId: leaderId,
          nextLeaderId: leaderId,
        }),
      );
      return 'removed';
    });
  }

  async removeMemberForStaff(
    programId: string,
    teamId: string,
    actorUserId: string,
    targetUserId: string,
    recordAudit: RecordTeamMembershipAudit,
  ): Promise<StaffRemoveMemberResult> {
    return this.prisma.$transaction(async (tx) => {
      const team = await tx.team.findUnique({
        where: { id: teamId },
        select: { programId: true },
      });
      if (!team || team.programId !== programId) return 'not-found';

      await lockTeamRow(tx, teamId);

      if (!(await isActiveStaff(tx, actorUserId))) return 'forbidden';

      const target = await tx.teamMember.findUnique({
        where: { programId_userId: { programId, userId: targetUserId } },
        select: TEAM_MEMBERSHIP_CONTEXT_SELECT,
      });
      if (!target || target.teamId !== teamId) return 'not-found';

      const now = new Date();
      const previousLeaderId = target.team.leaderId;
      const [memberCount, application] = await Promise.all([
        tx.teamMember.count({ where: { teamId } }),
        tx.application.findFirst({ where: { teamId }, select: { id: true } }),
      ]);

      if (memberCount <= 1) {
        if (application !== null) return 'last-member-with-application';
        await tx.teamMember.delete({
          where: { teamId_userId: { teamId, userId: targetUserId } },
        });
        await tx.teamInvitation.deleteMany({ where: { teamId, programId } });
        await tx.team.delete({ where: { id: teamId } });
        await recordAudit(
          { auditLogWriter: tx },
          membershipAuditEvent(target, {
            operation: 'REMOVE',
            removedUserId: targetUserId,
            previousLeaderId,
            nextLeaderId: null,
          }),
        );
        return 'removed';
      }

      let nextLeaderId = previousLeaderId;
      if (previousLeaderId === targetUserId) {
        const successor = await tx.teamMember.findFirst({
          where: { teamId, userId: { not: targetUserId } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { userId: true },
        });
        if (!successor) {
          throw new Error(
            'team member count and roster disagree inside the team lock',
          );
        }
        nextLeaderId = successor.userId;

        await tx.team.update({
          where: { id: teamId },
          data: { leaderId: nextLeaderId },
        });
      }

      await tx.teamMember.delete({
        where: { teamId_userId: { teamId, userId: targetUserId } },
      });
      await enqueueRepositoryAccessSyncEvents(tx, teamId, now);
      await recordAudit(
        { auditLogWriter: tx },
        membershipAuditEvent(target, {
          operation: 'REMOVE',
          removedUserId: targetUserId,
          previousLeaderId,
          nextLeaderId,
        }),
      );
      return 'removed';
    });
  }

  async transferLeaderForStaff(
    programId: string,
    teamId: string,
    actorUserId: string,
    targetUserId: string,
    recordAudit: RecordTeamMembershipAudit,
  ): Promise<StaffTransferLeaderResult> {
    return this.prisma.$transaction(async (tx) => {
      const team = await tx.team.findUnique({
        where: { id: teamId },
        select: { programId: true },
      });
      if (!team || team.programId !== programId) return 'not-found';

      await lockTeamRow(tx, teamId);

      if (!(await isActiveStaff(tx, actorUserId))) return 'forbidden';

      const target = await tx.teamMember.findUnique({
        where: { programId_userId: { programId, userId: targetUserId } },
        select: TEAM_MEMBERSHIP_CONTEXT_SELECT,
      });
      if (!target || target.teamId !== teamId) return 'not-found';

      const previousLeaderId = target.team.leaderId;
      if (previousLeaderId === targetUserId) return 'unchanged';

      await tx.team.update({
        where: { id: teamId },
        data: { leaderId: targetUserId },
      });

      await recordAudit(
        { auditLogWriter: tx },
        membershipAuditEvent(target, {
          operation: 'TRANSFER_LEADER',
          removedUserId: null,
          previousLeaderId,
          nextLeaderId: targetUserId,
        }),
      );
      return 'transferred';
    });
  }
}

async function isActiveStaff(
  tx: Pick<Prisma.TransactionClient, 'user'>,
  userId: string,
): Promise<boolean> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: {
      hasStaffAccess: true,
      hasAdminAccess: true,
      accountStatus: true,
    },
  });
  if (user?.accountStatus !== AccountStatus.ACTIVE) return false;
  return user.hasStaffAccess || user.hasAdminAccess;
}

const TEAM_MEMBERSHIP_CONTEXT_SELECT = {
  teamId: true,
  team: {
    select: {
      leaderId: true,
      name: true,
      program: { select: { name: true } },
    },
  },
} as const;

interface TeamMembershipContext {
  readonly teamId: string;
  readonly team: {
    readonly leaderId: string;
    readonly name: string;
    readonly program: { readonly name: string };
  };
}

function membershipAuditEvent(
  context: TeamMembershipContext,
  change: Omit<TeamMembershipAuditEvent, 'teamId' | 'programName' | 'teamName'>,
): TeamMembershipAuditEvent {
  return {
    teamId: context.teamId,
    programName: context.team.program.name,
    teamName: context.team.name,
    ...change,
  };
}

type AccessSyncTx = Pick<
  Prisma.TransactionClient,
  'application' | 'outboxEvent'
>;

async function enqueueRepositoryAccessSyncEvents(
  tx: AccessSyncTx,
  teamId: string,
  now: Date,
): Promise<void> {
  const applications = await tx.application.findMany({
    where: repositoryAccessSyncTargetWhere(teamId),
    select: { id: true },
  });
  if (applications.length === 0) return;
  await tx.outboxEvent.createMany({
    data: applications.map((application) =>
      repositoryAccessSyncEventData(application.id, teamId, now),
    ),
    skipDuplicates: true,
  });
}

function lockTeamRow(
  tx: Pick<Prisma.TransactionClient, '$queryRaw'>,
  teamId: string,
): Promise<LockedTeamRow[]> {
  return tx.$queryRaw<LockedTeamRow[]>(
    Prisma.sql`SELECT "id" FROM "Team" WHERE "id" = ${teamId} FOR UPDATE`,
  );
}

type TeamsTx = Pick<
  Prisma.TransactionClient,
  'team' | 'teamMember' | 'auditLog'
>;

interface LockedTeamRow {
  readonly id: string;
}

class PrismaProgramTeamsCreateStore implements ProgramTeamsCreateStore {
  constructor(private readonly tx: TeamsTx) {}

  get auditLogWriter(): AuditLogTransactionWriter {
    return this.tx;
  }

  async findMembershipByProgramUser(
    programId: string,
    userId: string,
  ): Promise<TeamMembershipRecord | null> {
    const row = await this.tx.teamMember.findUnique({
      where: { programId_userId: { programId, userId } },
      select: { teamId: true, userId: true },
    });
    return row;
  }

  async createTeamWithLeader(
    input: CreateTeamRecordInput,
  ): Promise<CreatedTeamRecord> {
    try {
      const team = await this.tx.team.create({
        data: {
          programId: input.programId,
          name: input.name,
          joinCodeDigest: input.joinCodeDigest,
          leaderId: input.leaderId,
        },
        select: { id: true, name: true },
      });
      await this.tx.teamMember.create({
        data: {
          teamId: team.id,
          programId: input.programId,
          userId: input.leaderId,
        },
      });
      return team;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const target = error.meta?.target;
        const fields = Array.isArray(target)
          ? target.map(String)
          : typeof target === 'string'
            ? [target]
            : [];
        if (fields.some((field) => field.includes('joinCodeDigest'))) {
          throw new JoinCodeDigestConflictError();
        }
        throw new TeamMembershipConflictError();
      }
      throw error;
    }
  }
}

interface TeamProvisionOutbox {
  readonly status: OutboxEventStatus;
  readonly createdAt: Date;
}

interface TeamProvisionJob {
  readonly status: RepositoryProvisionJobStatus;
  readonly updatedAt: Date;
  readonly lastErrorCode: string | null;
}

function resolveTeamRepositoryProvisioning(
  applicationStatus: ApplicationStatus,
  enabled: boolean,
  applicationUpdatedAt: Date,
  outbox: TeamProvisionOutbox | undefined,
  job: TeamProvisionJob | undefined,
): TeamApplicationView['repositoryProvisioning'] {
  const anomalous = (): TeamApplicationView['repositoryProvisioning'] => ({
    enabled,
    jobStatus: 'ANOMALOUS',
    updatedAt: applicationUpdatedAt,
    safeErrorClass: 'UNKNOWN',
  });
  if (applicationStatus !== ApplicationStatus.APPROVED) {
    if (outbox || job) {
      return anomalous();
    }
    return {
      enabled,
      jobStatus: enabled ? 'NOT_REQUESTED' : 'DISABLED',
      updatedAt: applicationUpdatedAt,
      safeErrorClass: null,
    };
  }

  if (
    (job && !outbox) ||
    (job && outbox?.status !== OutboxEventStatus.PROCESSED) ||
    (!job && outbox?.status === OutboxEventStatus.PROCESSED)
  ) {
    return anomalous();
  }

  if (job && outbox?.status === OutboxEventStatus.PROCESSED) {
    const jobStatus = mapTeamProvisionJobStatus(job.status);
    return {
      enabled,
      jobStatus,
      updatedAt: job.updatedAt,
      safeErrorClass:
        jobStatus === 'RETRYABLE_FAILED' || jobStatus === 'FAILED'
          ? normalizeTeamSafeErrorClass(job.lastErrorCode)
          : null,
    };
  }

  if (enabled && outbox) {
    if (
      outbox.status === OutboxEventStatus.PENDING ||
      outbox.status === OutboxEventStatus.PROCESSING
    ) {
      return {
        enabled,
        jobStatus: 'PENDING',
        updatedAt: outbox.createdAt,
        safeErrorClass: null,
      };
    }
    if (outbox.status === OutboxEventStatus.FAILED) {
      return {
        enabled,
        jobStatus: 'FAILED',
        updatedAt: outbox.createdAt,
        safeErrorClass: 'UNKNOWN',
      };
    }
  }

  if (!outbox && !job) {
    return {
      enabled,
      jobStatus: enabled ? 'ANOMALOUS' : 'DISABLED',
      updatedAt: applicationUpdatedAt,
      safeErrorClass: enabled ? 'UNKNOWN' : null,
    };
  }
  return anomalous();
}

function mapTeamProvisionJobStatus(
  status: RepositoryProvisionJobStatus,
): TeamRepositoryProvisioningJobStatus {
  switch (status) {
    case RepositoryProvisionJobStatus.PENDING:
      return 'PENDING';
    case RepositoryProvisionJobStatus.PROCESSING:
      return 'PROCESSING';
    case RepositoryProvisionJobStatus.SUCCEEDED:
      return 'SUCCEEDED';
    case RepositoryProvisionJobStatus.FAILED_RETRYABLE:
      return 'RETRYABLE_FAILED';
    case RepositoryProvisionJobStatus.FAILED_FINAL:
      return 'FAILED';
  }
}

function normalizeTeamSafeErrorClass(
  errorCode: string | null,
): TeamRepositoryProvisioningSafeErrorClass {
  switch (errorCode) {
    case 'GITHUB_OPERATIONS_CONFIGURATION':
    case 'GITHUB_OPERATIONS_INSTALLATION_NOT_FOUND':
    case 'GITHUB_OPERATIONS_ORGANIZATION_MISMATCH':
    case 'GITHUB_OPERATIONS_AUTHENTICATION':
    case 'GITHUB_OPERATIONS_PERMISSION':
      return 'AUTH';
    case 'GITHUB_OPERATIONS_RATE_LIMITED':
    case 'GITHUB_OPERATIONS_INVITATION_LIMIT':
      return 'RATE_LIMIT';
    case 'GITHUB_OPERATIONS_INVALID_INPUT':
    case 'REPOSITORY_PROVISION_APPLICATION_NOT_APPROVED':
    case 'REPOSITORY_PROVISION_FEATURE_DISABLED':
    case 'REPOSITORY_PROVISION_INVALID_EVENT':
    case 'REPOSITORY_PROVISION_REPOSITORY_MISMATCH':
      return 'UPSTREAM_REJECTED';
    case 'GITHUB_OPERATIONS_UPSTREAM':
    case 'GITHUB_OPERATIONS_INVALID_RESPONSE':
    case 'REPOSITORY_PROVISION_INTERNAL':
    case null:
    default:
      return 'UNKNOWN';
  }
}
