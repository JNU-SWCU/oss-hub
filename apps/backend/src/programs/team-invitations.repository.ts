import { USER_AUTHORITY_SELECT } from '../platform/user-profile-read.config';
import { Injectable } from '@nestjs/common';
import { PlatformRepository } from '../platform/platform.repository';
import { AccountStatus, UserType, Prisma } from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import { TeamHistoryRepository } from './team-history.repository';
import {
  STUDENT_MEMBER_WHERE,
  USER_PROFILE_NAME_SELECT,
} from '../platform/user-profile-read.config';

interface TeamInvitationRecord {
  id: string;
  teamId: string;
  programId: string;
  inviteeId: string;
  invitedById: string;
  invitedAt: Date;
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
  | { readonly kind: 'ok' };

export type DeclineInvitationOutcome =
  { readonly kind: 'not-found' } | { readonly kind: 'ok' };

export interface InvitationCandidateRecord {
  readonly id: string;
  readonly nickname: string;
  readonly name: string | null;
  readonly avatarUrl: string | null;
}

export type StaffAuthorityRow = Prisma.UserGetPayload<{
  select: typeof USER_AUTHORITY_SELECT & { accountStatus: true };
}>;

export interface InviteeAccountRow {
  readonly accountStatus: AccountStatus;
  readonly type: UserType;
}

export type AcceptInvitationOutcome =
  | { readonly kind: 'not-found' }
  | { readonly kind: 'forbidden' }
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
} satisfies Prisma.UserSelect;

const SENT_TEAM_INVITATION_SELECT = {
  id: true,
  teamId: true,
  programId: true,
  inviteeId: true,
  invitedById: true,
  createdAt: true,
  invitee: { select: TEAM_INVITEE_SELECT },
} satisfies Prisma.TeamInvitationSelect;

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
    invitedAt: invitation.createdAt,
    invitee: {
      id: invitation.invitee.id,
      nickname: invitation.invitee.nickname,
      name: invitation.invitee.name ?? null,
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
    Prisma.sql`
      SELECT t."id" FROM "Team" t
      JOIN "Program" p ON p."id" = t."programId"
      WHERE t."id" = ${teamId} AND p."lifecycle" <> 'DELETED'
      FOR UPDATE OF t
    `,
  );
}

@Injectable()
export class TeamInvitationsRepository {
  constructor(
    private readonly history: TeamHistoryRepository,
    private readonly prisma: PrismaService,
    private readonly platformRepository: PlatformRepository,
  ) {}

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
      orderBy: { createdAt: 'desc' },
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
      invitedAt: invitation.createdAt,
      teamName: invitation.team.name,
      programName: invitation.team.program.name,

      invitedByDisplayName:
        invitation.invitedBy.name?.trim() || invitation.invitedBy.nickname,
      memberCount: invitation.team._count.members,
      teamMaxSize: invitation.team.program.teamMaxSize,
    }));
    return official;
  }

  async findByTeamId(teamId: string): Promise<SentTeamInvitationRecord[]> {
    const invitations = await this.prisma.teamInvitation.findMany({
      where: { teamId },
      orderBy: { createdAt: 'desc' },
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

  findStaffAuthority(userId: string): Promise<StaffAuthorityRow | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        accountStatus: true,
        ...USER_AUTHORITY_SELECT,
      },
    });
  }

  findInviteeAccount(userId: string): Promise<InviteeAccountRow | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        accountStatus: true,
        type: true,
      },
    });
  }

  async searchCandidates(
    programId: string,
    query: string,
    excludeUserId: string,
  ): Promise<InvitationCandidateRecord[]> {
    return this.searchInvitationCandidates(
      this.prisma,
      programId,
      query,
      excludeUserId,
    );
  }

  async isApplicationProgramAvailable(programId: string): Promise<boolean> {
    return (
      (await this.prisma.program.findUnique({
        where: { id: programId, lifecycle: 'PUBLISHED' },
        select: { id: true },
      })) !== null
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
          where: {
            id: input.teamId,
            program: { lifecycle: { not: 'DELETED' } },
          },
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
              user: {
                ...STUDENT_MEMBER_WHERE,
                accountStatus: AccountStatus.ACTIVE,
              },
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
            createdAt: now,
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

      if ((await lockTeamRow(tx, invitation.teamId)).length === 0)
        return { kind: 'not-found' };

      const locked = await tx.teamInvitation.findUnique({
        where: { id: invitationId },
        include: { team: { select: { leaderId: true } } },
      });
      if (!locked) return { kind: 'not-found' };

      if (
        locked.team.leaderId !== actorId &&
        !(await isActiveStaffActor(tx, actorId))
      ) {
        return { kind: 'not-team-leader' };
      }

      const closed = await tx.teamInvitation.deleteMany({
        where: { id: invitationId },
      });
      if (closed.count === 0) return { kind: 'not-found' };
      await this.history.recordInvitationClosed(
        tx,
        locked,
        'INVITATION_CANCELLED',
        actorId,
        now,
      );
      return { kind: 'ok' };
    });
  }

  async declinePendingInvitationAsInvitee(
    invitationId: string,
    inviteeId: string,
    now: Date = new Date(),
  ): Promise<DeclineInvitationOutcome> {
    return this.prisma.$transaction<DeclineInvitationOutcome>(async (tx) => {
      const invitation = await tx.teamInvitation.findFirst({
        where: { id: invitationId, inviteeId },
      });
      if (!invitation) return { kind: 'not-found' };
      if ((await lockTeamRow(tx, invitation.teamId)).length === 0)
        return { kind: 'not-found' };
      const closed = await tx.teamInvitation.deleteMany({
        where: {
          id: invitationId,
          inviteeId,
        },
      });
      if (closed.count === 0) return { kind: 'not-found' };
      await this.history.recordInvitationClosed(
        tx,
        invitation,
        'INVITATION_DECLINED',
        inviteeId,
        now,
      );
      return { kind: 'ok' };
    });
  }

  async withAcceptTransaction(
    invitationId: string,
    inviteeId: string,
    now: Date = new Date(),
    onOk?: AcceptInvitationOnOk,
  ): Promise<AcceptInvitationOutcome> {
    return this.acceptTeamInvitationTransaction(
      this.prisma,
      invitationId,
      inviteeId,
      now,
      onOk,
    );
  }

  async searchInvitationCandidates(
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
          this.platformRepository.userProfileNameWhere(query),
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
      name: user.name ?? null,
      avatarUrl: user.avatarUrl,
    }));
  }

  async acceptTeamInvitationTransaction(
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
            invitedById: true,
            createdAt: true,
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

        const programs = await tx.$queryRaw<LockedTeamRow[]>(
          Prisma.sql`SELECT "id" FROM "Program" WHERE "id" = ${invitation.programId} AND "lifecycle" <> 'DELETED' FOR UPDATE`,
        );
        if (programs.length === 0) return { kind: 'not-found' };
        if ((await lockTeamRow(tx, invitation.teamId)).length === 0)
          return { kind: 'not-found' };

        const currentInvitation = await tx.teamInvitation.findUnique({
          where: { id: invitationId },
          select: { id: true },
        });

        if (!currentInvitation) return { kind: 'not-found' };

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
            type: true,
          },
        });
        if (
          !invitee ||
          invitee.type !== UserType.STUDENT ||
          invitee.accountStatus !== AccountStatus.ACTIVE
        ) {
          return { kind: 'invitee-not-eligible' };
        }

        const existingMembership = await tx.teamMember.findUnique({
          where: { programId_userId: { programId, userId: inviteeId } },
          select: { userId: true },
        });
        if (existingMembership) return { kind: 'already-in-team' };
        const maxSize = invitation.team.program.teamMaxSize;
        const memberCount = await tx.teamMember.count({ where: { teamId } });
        if (memberCount >= maxSize) return { kind: 'team-full' };

        const updated = await tx.teamInvitation.deleteMany({
          where: { id: invitationId },
        });
        if (updated.count === 0) return { kind: 'not-found' };
        await this.history.recordInvitationClosed(
          tx,
          invitation,
          'INVITATION_ACCEPTED',
          inviteeId,
          now,
        );

        await tx.teamMember.create({
          data: { teamId, programId, userId: inviteeId },
        });

        const otherInvitations = await tx.teamInvitation.findMany({
          where: {
            programId,
            inviteeId,
            id: { not: invitationId },
          },
          orderBy: { id: 'asc' },
        });
        for (const other of otherInvitations) {
          const closed = await tx.teamInvitation.deleteMany({
            where: { id: other.id },
          });
          if (closed.count === 1)
            await this.history.recordInvitationClosed(
              tx,
              other,
              'INVITATION_CANCELLED',
              inviteeId,
              now,
              'JOINED_ANOTHER_TEAM',
            );
        }

        await enqueueRepositoryAccessSyncEvents(
          this.platformRepository,
          tx,
          teamId,
          now,
        );

        if (onOk) {
          await onOk(
            { historyWriter: tx },
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
        error.code === 'P2002' &&
        error.meta?.modelName === 'TeamMember'
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
      ...USER_AUTHORITY_SELECT,
      accountStatus: true,
    },
  });
  if (user?.accountStatus !== AccountStatus.ACTIVE) return false;
  return (
    user.type === 'STAFF' &&
    user.approvalStatus === 'APPROVED' &&
    user.profileCreatedAt !== null &&
    user.name !== null &&
    user.department !== null
  );
}

type AccessSyncTx = Pick<Prisma.TransactionClient, 'team' | 'outboxEvent'>;

async function enqueueRepositoryAccessSyncEvents(
  platformRepository: PlatformRepository,
  tx: AccessSyncTx,
  teamId: string,
  now: Date,
): Promise<void> {
  const applications = await tx.team.findMany({
    where: platformRepository.repositoryAccessSyncTargetWhere(teamId),
    select: { id: true },
  });
  if (applications.length === 0) return;
  await tx.outboxEvent.createMany({
    data: applications.map((application) =>
      platformRepository.repositoryAccessSyncEventData(application.id, now),
    ),
    skipDuplicates: true,
  });
}

interface LockedUserRow {
  readonly id: string;
}

type AcceptInvitationOkStore = {
  readonly historyWriter: Pick<Prisma.TransactionClient, 'teamHistory'>;
};

export type AcceptInvitationOnOk = (
  store: AcceptInvitationOkStore,
  names: AcceptInvitationOkContext,
) => Promise<void>;
