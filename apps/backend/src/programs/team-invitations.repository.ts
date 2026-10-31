import { Injectable } from '@nestjs/common';
import type { AuditLogTransactionWriter } from '../platform/audit-log-transaction-writer.types';
import { PlatformRepository } from '../platform/platform.repository';
import {
  AccountStatus,
  MemberKind,
  Prisma,
  TeamInvitationStatus,
} from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import {
  STUDENT_MEMBER_WHERE,
  USER_PROFILE_NAME_SELECT,
  resolveUserProfileName,
  userProfileNameWhere,
} from '../platform/user-profile-read.config';
import { repositoryAccessSyncEventData } from '../github/repository-provision-event.config';

interface TeamInvitationRecord {
  id: string;
  teamId: string;
  programId: string;
  inviteeId: string;
  invitedById: string;
  status: TeamInvitationStatus;
  invitedAt: Date;
  respondedAt: Date | null;
}

export interface TeamInvitationInvitee {
  readonly id: string;
  readonly nickname: string;
  readonly name: string | null;
  readonly avatarUrl: string | null;
}

export interface SentTeamInvitationRecord extends TeamInvitationRecord {
  readonly invitee: TeamInvitationInvitee;
}

export interface ReceivedTeamInvitationRecord extends TeamInvitationRecord {
  readonly preparation?: true;
  readonly teamName: string;
  readonly programName: string;
  readonly invitedByDisplayName: string;
  readonly memberCount: number;
  readonly teamMaxSize: number;
}

export interface TeamContextRecord {
  readonly teamId: string;
  readonly programId: string;
  readonly leaderId: string;
  readonly teamMaxSize: number;
}

export interface CreateInvitationInput {
  readonly teamId: string;

  readonly actorId: string;
  readonly inviteeId: string;
}

export type CreateInvitationOutcome =
  | { readonly kind: 'team-not-found' }
  | { readonly kind: 'not-team-leader' }
  | { readonly kind: 'not-team-member' }
  | { readonly kind: 'invitee-already-in-team' }
  | { readonly kind: 'team-full' }
  | { readonly kind: 'already-invited' }
  | {
      readonly kind: 'ok';
      readonly invitation: SentTeamInvitationRecord;
    };

export type CancelInvitationOutcome =
  | { readonly kind: 'not-found' }
  | { readonly kind: 'not-team-leader' }
  | { readonly kind: 'not-pending' }
  | { readonly kind: 'ok' };

export type DeclineInvitationOutcome =
  | { readonly kind: 'not-found' }
  | { readonly kind: 'not-pending' }
  | { readonly kind: 'ok' };

export interface InvitationCandidateRecord {
  readonly id: string;
  readonly nickname: string;
  readonly name: string | null;
  readonly avatarUrl: string | null;
}

export type InviteeEligibility = 'eligible' | 'not-found' | 'not-eligible';

export type AcceptInvitationOutcome =
  | { readonly kind: 'not-found' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'not-pending' }
  | { readonly kind: 'already-in-team' }
  | { readonly kind: 'team-full' }
  | { readonly kind: 'invitee-not-eligible' }
  | {
      readonly kind: 'ok';
      readonly teamId: string;
      readonly programId: string;
    };

type AcceptInvitationOkContext = {
  readonly teamId: string;
  readonly programId: string;
  readonly teamName: string;
  readonly programName: string;
};

export interface AcceptedInvitationResult {
  readonly teamId: string;
  readonly programId: string;
}

const TEAM_INVITEE_SELECT = {
  id: true,
  nickname: true,
  ...USER_PROFILE_NAME_SELECT,
  avatarUrl: true,
} as const satisfies Prisma.UserSelect;

const SENT_TEAM_INVITATION_SELECT = {
  id: true,
  teamId: true,
  programId: true,
  inviteeId: true,
  invitedById: true,
  status: true,
  invitedAt: true,
  respondedAt: true,
  invitee: { select: TEAM_INVITEE_SELECT },
} as const satisfies Prisma.TeamInvitationSelect;

type SentTeamInvitationRow = Prisma.TeamInvitationGetPayload<{
  select: typeof SENT_TEAM_INVITATION_SELECT;
}>;

function toSentTeamInvitationRecord(
  invitation: SentTeamInvitationRow,
): SentTeamInvitationRecord {
  return {
    id: invitation.id,
    teamId: invitation.teamId,
    programId: invitation.programId,
    inviteeId: invitation.inviteeId,
    invitedById: invitation.invitedById,
    status: invitation.status,
    invitedAt: invitation.invitedAt,
    respondedAt: invitation.respondedAt,
    invitee: {
      id: invitation.invitee.id,
      nickname: invitation.invitee.nickname,
      name: resolveUserProfileName(invitation.invitee),
      avatarUrl: invitation.invitee.avatarUrl,
    },
  };
}

interface LockedTeamRow {
  readonly id: string;
}

function lockTeamRow(
  tx: Pick<Prisma.TransactionClient, '$queryRaw'>,
  teamId: string,
): Promise<LockedTeamRow[]> {
  return tx.$queryRaw<LockedTeamRow[]>(
    Prisma.sql`SELECT "id" FROM "Team" WHERE "id" = ${teamId} FOR UPDATE`,
  );
}

@Injectable()
export class TeamInvitationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findUserIdByGithubId(githubId: bigint): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { githubId },
      select: { id: true },
    });
    return user?.id ?? null;
  }

  async findByInviteeId(
    inviteeId: string,
  ): Promise<ReceivedTeamInvitationRecord[]> {
    const invitations = await this.prisma.teamInvitation.findMany({
      where: { inviteeId },
      orderBy: { invitedAt: 'desc' },
      include: {
        team: {
          select: {
            name: true,
            program: { select: { name: true, teamMaxSize: true } },
            _count: { select: { members: true } },
          },
        },
        invitedBy: {
          select: { nickname: true, ...USER_PROFILE_NAME_SELECT },
        },
      },
    });

    const official = invitations.map((invitation) => ({
      id: invitation.id,
      teamId: invitation.teamId,
      programId: invitation.programId,
      inviteeId: invitation.inviteeId,
      invitedById: invitation.invitedById,
      status: invitation.status,
      invitedAt: invitation.invitedAt,
      respondedAt: invitation.respondedAt,
      teamName: invitation.team.name,
      programName: invitation.team.program.name,

      invitedByDisplayName:
        resolveUserProfileName(invitation.invitedBy)?.trim() ||
        invitation.invitedBy.nickname,
      memberCount: invitation.team._count.members,
      teamMaxSize: invitation.team.program.teamMaxSize,
    }));
    const preparations =
      await this.prisma.applicationPreparationParticipant.findMany({
        where: {
          userId: inviteeId,
          status: 'PENDING',
          preparation: { leaderId: { not: inviteeId } },
        },
        select: {
          id: true,
          programId: true,
          userId: true,
          status: true,
          invitedAt: true,
          respondedAt: true,
          preparation: {
            select: {
              id: true,
              name: true,
              leaderId: true,
              leader: {
                select: { nickname: true, ...USER_PROFILE_NAME_SELECT },
              },
              program: { select: { name: true, teamMaxSize: true } },
              _count: {
                select: { participants: { where: { status: 'ACCEPTED' } } },
              },
            },
          },
        },
      });
    const temporary: ReceivedTeamInvitationRecord[] = preparations.map(
      (row) => ({
        preparation: true,
        id: row.id,
        programId: row.programId,
        teamId: row.preparation.id,
        inviteeId: row.userId,
        invitedById: row.preparation.leaderId,
        status: row.status,
        invitedAt: row.invitedAt,
        respondedAt: row.respondedAt,
        teamName: row.preparation.name,
        programName: row.preparation.program.name,
        invitedByDisplayName:
          resolveUserProfileName(row.preparation.leader)?.trim() ||
          row.preparation.leader.nickname,
        memberCount: row.preparation._count.participants,
        teamMaxSize: row.preparation.program.teamMaxSize,
      }),
    );
    return [...official, ...temporary].sort(
      (left, right) => right.invitedAt.getTime() - left.invitedAt.getTime(),
    );
  }

  async findByTeamId(teamId: string): Promise<SentTeamInvitationRecord[]> {
    const invitations = await this.prisma.teamInvitation.findMany({
      where: { teamId },
      orderBy: { invitedAt: 'desc' },
      select: SENT_TEAM_INVITATION_SELECT,
    });
    return invitations.map(toSentTeamInvitationRecord);
  }

  async findTeamContext(teamId: string): Promise<TeamContextRecord | null> {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: {
        id: true,
        programId: true,
        leaderId: true,
        program: { select: { teamMaxSize: true } },
      },
    });
    if (!team) return null;
    return {
      teamId: team.id,
      programId: team.programId,
      leaderId: team.leaderId,
      teamMaxSize: team.program.teamMaxSize,
    };
  }

  async isTeamMember(teamId: string, userId: string): Promise<boolean> {
    const member = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
      select: { userId: true },
    });
    return member !== null;
  }

  async isActiveStaff(userId: string): Promise<boolean> {
    return isActiveStaffActor(this.prisma, userId);
  }

  async getInviteeEligibility(userId: string): Promise<InviteeEligibility> {
    return getInviteeEligibility(this.prisma, userId);
  }

  async searchCandidates(
    programId: string,
    query: string,
    excludeUserId: string,
  ): Promise<InvitationCandidateRecord[]> {
    return TeamInvitationsRepository.searchInvitationCandidates(
      this.prisma,
      programId,
      query,
      excludeUserId,
    );
  }

  async createInvitation(
    input: CreateInvitationInput,
    now: Date = new Date(),
  ): Promise<CreateInvitationOutcome> {
    const creation = this.prisma.$transaction<CreateInvitationOutcome>(
      async (tx) => {
        await lockTeamRow(tx, input.teamId);

        const team = await tx.team.findUnique({
          where: { id: input.teamId },
          select: {
            id: true,
            programId: true,
            leaderId: true,
            program: { select: { teamMaxSize: true } },
          },
        });
        if (!team) return { kind: 'team-not-found' };

        const actorIsStaff = await isActiveStaffActor(tx, input.actorId);
        if (!actorIsStaff) {
          if (team.leaderId !== input.actorId) {
            return { kind: 'not-team-leader' };
          }
          const actorMembership = await tx.teamMember.findUnique({
            where: {
              teamId_userId: { teamId: team.id, userId: input.actorId },
            },
            select: { userId: true },
          });
          if (!actorMembership) return { kind: 'not-team-member' };
        }

        const inviteeMembership = await tx.teamMember.findUnique({
          where: {
            programId_userId: {
              programId: team.programId,
              userId: input.inviteeId,
            },
          },
          select: { userId: true },
        });
        if (inviteeMembership) return { kind: 'invitee-already-in-team' };

        const memberCount = await tx.teamMember.count({
          where: { teamId: team.id },
        });
        if (memberCount >= team.program.teamMaxSize) {
          return { kind: 'team-full' };
        }

        const invitation = await tx.teamInvitation.create({
          data: {
            teamId: team.id,
            programId: team.programId,
            inviteeId: input.inviteeId,
            invitedById: input.actorId,
            invitedAt: now,
          },
          select: SENT_TEAM_INVITATION_SELECT,
        });
        return {
          kind: 'ok',
          invitation: toSentTeamInvitationRecord(invitation),
        };
      },
    );
    try {
      return await creation;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2002' || error.code === '23505')
      ) {
        return { kind: 'already-invited' };
      }
      throw error;
    }
  }

  async cancelPendingInvitationAsLeader(
    invitationId: string,
    actorId: string,
    now: Date = new Date(),
  ): Promise<CancelInvitationOutcome> {
    return this.prisma.$transaction<CancelInvitationOutcome>(async (tx) => {
      const invitation = await tx.teamInvitation.findUnique({
        where: { id: invitationId },
        select: { teamId: true },
      });
      if (!invitation) return { kind: 'not-found' };

      await lockTeamRow(tx, invitation.teamId);

      const locked = await tx.teamInvitation.findUnique({
        where: { id: invitationId },
        select: { status: true, team: { select: { leaderId: true } } },
      });
      if (!locked) return { kind: 'not-found' };

      if (
        locked.team.leaderId !== actorId &&
        !(await isActiveStaffActor(tx, actorId))
      ) {
        return { kind: 'not-team-leader' };
      }
      if (locked.status !== TeamInvitationStatus.PENDING) {
        return { kind: 'not-pending' };
      }

      const closed = await tx.teamInvitation.updateMany({
        where: { id: invitationId, status: TeamInvitationStatus.PENDING },
        data: { status: TeamInvitationStatus.DECLINED, respondedAt: now },
      });
      if (closed.count === 0) return { kind: 'not-pending' };
      return { kind: 'ok' };
    });
  }

  async declinePendingInvitationAsInvitee(
    invitationId: string,
    inviteeId: string,
    now: Date = new Date(),
  ): Promise<DeclineInvitationOutcome> {
    const closed = await this.prisma.teamInvitation.updateMany({
      where: {
        id: invitationId,
        inviteeId,
        status: TeamInvitationStatus.PENDING,
      },
      data: { status: TeamInvitationStatus.DECLINED, respondedAt: now },
    });
    if (closed.count > 0) return { kind: 'ok' };

    const own = await this.prisma.teamInvitation.findFirst({
      where: { id: invitationId, inviteeId },
      select: { id: true },
    });
    return own ? { kind: 'not-pending' } : { kind: 'not-found' };
  }

  async withAcceptTransaction(
    invitationId: string,
    inviteeId: string,
    now: Date = new Date(),
    onOk?: AcceptInvitationOnOk,
  ): Promise<AcceptInvitationOutcome> {
    return TeamInvitationsRepository.acceptTeamInvitationTransaction(
      this.prisma,
      invitationId,
      inviteeId,
      now,
      onOk,
    );
  }

  static async searchInvitationCandidates(
    prisma: Pick<PrismaService, 'user'>,
    programId: string,
    query: string,
    excludeUserId: string,
  ): Promise<InvitationCandidateRecord[]> {
    const users = await prisma.user.findMany({
      where: {
        id: { not: excludeUserId },
        ...STUDENT_MEMBER_WHERE,
        accountStatus: AccountStatus.ACTIVE,
        OR: [
          { nickname: { contains: query, mode: 'insensitive' } },
          userProfileNameWhere(query),
        ],
        teamMemberships: { none: { programId } },
      },
      select: {
        id: true,
        nickname: true,
        ...USER_PROFILE_NAME_SELECT,
        avatarUrl: true,
      },
      orderBy: { nickname: 'asc' },
      take: 20,
    });
    return users.map((user) => ({
      id: user.id,
      nickname: user.nickname,
      name: resolveUserProfileName(user),
      avatarUrl: user.avatarUrl,
    }));
  }

  static async acceptTeamInvitationTransaction(
    prisma: PrismaService,
    invitationId: string,
    inviteeId: string,
    now: Date,
    onOk?: AcceptInvitationOnOk,
  ): Promise<AcceptInvitationOutcome> {
    const acceptance = prisma.$transaction<AcceptInvitationOutcome>(
      async (tx) => {
        const invitation = await tx.teamInvitation.findUnique({
          where: { id: invitationId },
          select: {
            id: true,
            teamId: true,
            programId: true,
            inviteeId: true,
            team: {
              select: {
                name: true,
                program: { select: { teamMaxSize: true, name: true } },
              },
            },
          },
        });
        if (!invitation) return { kind: 'not-found' };
        if (invitation.inviteeId !== inviteeId) return { kind: 'forbidden' };

        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "Program" WHERE "id" = ${invitation.programId} FOR UPDATE`,
        );
        await tx.$queryRaw<LockedTeamRow[]>(
          Prisma.sql`SELECT "id" FROM "Team" WHERE "id" = ${invitation.teamId} FOR UPDATE`,
        );

        const currentInvitation = await tx.teamInvitation.findUnique({
          where: { id: invitationId },
          select: { status: true },
        });

        if (!currentInvitation) return { kind: 'not-found' };
        if (currentInvitation.status !== TeamInvitationStatus.PENDING) {
          return { kind: 'not-pending' };
        }

        const teamId = invitation.teamId;
        const programId = invitation.programId;

        await tx.$queryRaw<readonly LockedUserRow[]>(
          Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${inviteeId} FOR UPDATE`,
        );
        const invitee = await tx.user.findUnique({
          where: { id: inviteeId },
          select: {
            id: true,
            accountStatus: true,
            profile: { select: { memberKind: true } },
          },
        });
        if (
          !invitee ||
          invitee.profile?.memberKind !== MemberKind.STUDENT ||
          invitee.accountStatus !== AccountStatus.ACTIVE
        ) {
          return { kind: 'invitee-not-eligible' };
        }

        const existingMembership = await tx.teamMember.findUnique({
          where: { programId_userId: { programId, userId: inviteeId } },
          select: { userId: true },
        });
        if (existingMembership) return { kind: 'already-in-team' };
        const preparation =
          await tx.applicationPreparationParticipant.findFirst({
            where: {
              programId,
              userId: inviteeId,
              status: TeamInvitationStatus.ACCEPTED,
            },
            select: { id: true },
          });
        if (preparation !== null) return { kind: 'already-in-team' };

        const maxSize = invitation.team.program.teamMaxSize;
        const memberCount = await tx.teamMember.count({ where: { teamId } });
        if (memberCount >= maxSize) return { kind: 'team-full' };

        const updated = await tx.teamInvitation.updateMany({
          where: { id: invitationId, status: TeamInvitationStatus.PENDING },
          data: { status: TeamInvitationStatus.ACCEPTED, respondedAt: now },
        });
        if (updated.count === 0) return { kind: 'not-pending' };

        await tx.teamMember.create({
          data: { teamId, programId, userId: inviteeId },
        });

        await tx.teamInvitation.updateMany({
          where: {
            programId,
            inviteeId,
            status: TeamInvitationStatus.PENDING,
            id: { not: invitationId },
          },
          data: { status: TeamInvitationStatus.DECLINED, respondedAt: now },
        });

        await enqueueRepositoryAccessSyncEvents(tx, teamId, now);

        if (onOk) {
          await onOk(
            { auditLogWriter: tx },
            {
              teamId,
              programId,
              teamName: invitation.team.name,
              programName: invitation.team.program.name,
            },
          );
        }

        return { kind: 'ok', teamId, programId };
      },
    );
    try {
      return await acceptance;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return { kind: 'already-in-team' };
      }
      throw error;
    }
  }
}

async function isActiveStaffActor(
  db: Pick<Prisma.TransactionClient, 'user'>,
  userId: string,
): Promise<boolean> {
  const user = await db.user.findUnique({
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

async function getInviteeEligibility(
  prisma: Pick<PrismaService, 'user'>,
  userId: string,
): Promise<InviteeEligibility> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      accountStatus: true,
      profile: { select: { memberKind: true } },
    },
  });
  if (!user) return 'not-found';
  return user.profile?.memberKind === MemberKind.STUDENT &&
    user.accountStatus === AccountStatus.ACTIVE
    ? 'eligible'
    : 'not-eligible';
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
    where: PlatformRepository.repositoryAccessSyncTargetWhere(teamId),
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

interface LockedUserRow {
  readonly id: string;
}

type AcceptInvitationOkStore = {
  readonly auditLogWriter: AuditLogTransactionWriter;
};

export type AcceptInvitationOnOk = (
  store: AcceptInvitationOkStore,
  names: AcceptInvitationOkContext,
) => Promise<void>;
