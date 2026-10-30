import { Injectable } from '@nestjs/common';
import {
  AccountStatus,
  MemberKind,
  Prisma,
  TeamInvitationStatus,
} from '@prisma/client';
import { PrismaService } from '../platform/prisma.service';
import {
  USER_PROFILE_NAME_SELECT,
  STUDENT_MEMBER_WHERE,
  UserProfileReadRepository,
} from '../platform/user-profile-read.repository';
import {
  PreparationConflict,
  type PreparationInvitation,
  type PreparationView,
} from './application-preparation.error';

const USER_SELECT = {
  id: true,
  nickname: true,
  avatarUrl: true,
  ...USER_PROFILE_NAME_SELECT,
} as const;
const PREPARATION_SELECT = {
  id: true,
  programId: true,
  leaderId: true,
  name: true,
  program: {
    select: {
      name: true,
      teamMinSize: true,
      teamMaxSize: true,
      lifecycle: true,
      applicationStartAt: true,
      applicationEndAt: true,
    },
  },
  leader: { select: USER_SELECT },
  participants: {
    where: { status: TeamInvitationStatus.ACCEPTED },
    orderBy: { invitedAt: 'asc' },
    select: { userId: true, user: { select: USER_SELECT } },
  },
} as const satisfies Prisma.ApplicationPreparationSelect;
const INVITATION_SELECT = {
  id: true,
  userId: true,
  status: true,
  invitedAt: true,
  respondedAt: true,
  user: { select: USER_SELECT },
  preparation: { select: PREPARATION_SELECT },
} as const satisfies Prisma.ApplicationPreparationParticipantSelect;
type PreparationRow = Prisma.ApplicationPreparationGetPayload<{
  select: typeof PREPARATION_SELECT;
}>;
type InvitationRow = Prisma.ApplicationPreparationParticipantGetPayload<{
  select: typeof INVITATION_SELECT;
}>;

function view(row: PreparationRow, actorId: string): PreparationView {
  return {
    id: row.id,
    name: row.name,
    memberCount: row.participants.length,
    minMembers: row.program.teamMinSize,
    maxMembers: row.program.teamMaxSize,
    isLeader: row.leaderId === actorId,
    members: row.participants.map(({ user }) => ({
      userId: user.id,
      nickname: user.nickname,
      name: UserProfileReadRepository.resolveUserProfileName(user),
      isLeader: user.id === row.leaderId,
    })),
  };
}
function invitation(row: InvitationRow): PreparationInvitation {
  return {
    id: row.id,
    teamId: row.preparation.id,
    programId: row.preparation.programId,
    invitedById: row.preparation.leaderId,
    status: row.status,
    invitedAt: row.invitedAt,
    respondedAt: row.respondedAt,
    teamName: row.preparation.name,
    programName: row.preparation.program.name,
    invitedByDisplayName:
      UserProfileReadRepository.resolveUserProfileName(
        row.preparation.leader,
      ) ?? row.preparation.leader.nickname,
    memberCount: row.preparation.participants.length,
    teamMaxSize: row.preparation.program.teamMaxSize,
    invitee: {
      id: row.user.id,
      nickname: row.user.nickname,
      name: UserProfileReadRepository.resolveUserProfileName(row.user),
      avatarUrl: row.user.avatarUrl,
    },
  };
}
function assertOpen(program: PreparationRow['program'], now: Date): void {
  if (
    program.lifecycle !== 'PUBLISHED' ||
    now < program.applicationStartAt ||
    now > program.applicationEndAt
  )
    throw new PreparationConflict('period-closed');
}
async function lockProgram(
  tx: Prisma.TransactionClient,
  programId: string,
): Promise<void> {
  await tx.$queryRaw(
    Prisma.sql`SELECT "id" FROM "Program" WHERE "id" = ${programId} FOR UPDATE`,
  );
}
async function assertAvailable(
  tx: Prisma.TransactionClient,
  programId: string,
  userId: string,
): Promise<void> {
  const [official, accepted] = await Promise.all([
    tx.teamMember.findUnique({
      where: { programId_userId: { programId, userId } },
      select: { id: true },
    }),
    tx.applicationPreparationParticipant.findFirst({
      where: { programId, userId, status: 'ACCEPTED' },
      select: { id: true },
    }),
  ]);
  if (official || accepted)
    throw new PreparationConflict('membership-conflict');
}
async function assertEligible(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { accountStatus: true, profile: { select: { memberKind: true } } },
  });
  if (
    user?.accountStatus !== AccountStatus.ACTIVE ||
    user.profile?.memberKind !== MemberKind.STUDENT
  )
    throw new PreparationConflict('ineligible');
}

@Injectable()
export class ApplicationPreparationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findActor(githubId: bigint): Promise<string | null> {
    const user = await this.prisma.user.findFirst({
      where: { githubId, accountStatus: 'ACTIVE' },
      select: { id: true },
    });
    return user?.id ?? null;
  }

  async get(
    programId: string,
    actorId: string,
  ): Promise<PreparationView | null> {
    const row = await this.prisma.applicationPreparation.findFirst({
      where: {
        programId,
        participants: { some: { userId: actorId, status: 'ACCEPTED' } },
      },
      select: PREPARATION_SELECT,
    });
    return row ? view(row, actorId) : null;
  }

  async create(
    programId: string,
    actorId: string,
    name: string,
    now: Date,
  ): Promise<PreparationView> {
    return this.prisma.$transaction(async (tx) => {
      await lockProgram(tx, programId);
      const program = await tx.program.findUnique({
        where: { id: programId },
        select: {
          name: true,
          teamMinSize: true,
          teamMaxSize: true,
          lifecycle: true,
          applicationStartAt: true,
          applicationEndAt: true,
        },
      });
      if (!program) throw new PreparationConflict('not-found');
      assertOpen(program, now);
      const existing = await tx.applicationPreparation.findUnique({
        where: { programId_leaderId: { programId, leaderId: actorId } },
        select: PREPARATION_SELECT,
      });
      if (existing) return view(existing, actorId);
      await assertAvailable(tx, programId, actorId);
      await assertEligible(tx, actorId);
      const row = await tx.applicationPreparation.create({
        data: {
          programId,
          leaderId: actorId,
          name,
          participants: {
            create: { userId: actorId, status: 'ACCEPTED', respondedAt: now },
          },
        },
        select: PREPARATION_SELECT,
      });
      return view(row, actorId);
    });
  }

  private async requirePreparation(
    preparationId: string,
    actorId: string,
    leaderOnly: boolean,
  ): Promise<PreparationRow> {
    const row = await this.prisma.applicationPreparation.findUnique({
      where: { id: preparationId },
      select: PREPARATION_SELECT,
    });
    if (!row) throw new PreparationConflict('not-found');
    if (!row.participants.some((member) => member.userId === actorId))
      throw new PreparationConflict('member-required');
    if (leaderOnly && row.leaderId !== actorId)
      throw new PreparationConflict('leader-required');
    return row;
  }

  async listSent(
    preparationId: string,
    actorId: string,
  ): Promise<readonly PreparationInvitation[]> {
    const row = await this.requirePreparation(preparationId, actorId, false);
    const rows = await this.prisma.applicationPreparationParticipant.findMany({
      where: { preparationId, userId: { not: row.leaderId } },
      orderBy: { invitedAt: 'desc' },
      select: INVITATION_SELECT,
    });
    return rows.map(invitation);
  }

  async search(preparationId: string, actorId: string, query: string) {
    const row = await this.requirePreparation(preparationId, actorId, true);
    if (!query.trim()) return [];
    const users = await this.prisma.user.findMany({
      where: {
        id: { not: actorId },
        accountStatus: 'ACTIVE',
        ...STUDENT_MEMBER_WHERE,
        OR: [
          { nickname: { contains: query.trim(), mode: 'insensitive' } },
          UserProfileReadRepository.userProfileNameWhere(query.trim()),
        ],
        teamMemberships: { none: { programId: row.programId } },
        preparationParticipants: {
          none: { programId: row.programId, status: 'ACCEPTED' },
        },
      },
      select: USER_SELECT,
      orderBy: { nickname: 'asc' },
      take: 20,
    });
    return users.map((user) => ({
      id: user.id,
      nickname: user.nickname,
      name: UserProfileReadRepository.resolveUserProfileName(user),
      avatarUrl: user.avatarUrl,
    }));
  }

  async invite(
    preparationId: string,
    actorId: string,
    inviteeId: string,
    now: Date,
  ): Promise<PreparationInvitation> {
    const initial = await this.requirePreparation(preparationId, actorId, true);
    return this.prisma.$transaction(async (tx) => {
      await lockProgram(tx, initial.programId);
      const row = await tx.applicationPreparation.findUnique({
        where: { id: preparationId },
        select: PREPARATION_SELECT,
      });
      if (!row) throw new PreparationConflict('not-found');
      if (row.leaderId !== actorId)
        throw new PreparationConflict('leader-required');
      assertOpen(row.program, now);
      if (actorId === inviteeId) throw new PreparationConflict('self-invite');
      await assertEligible(tx, inviteeId);
      await assertAvailable(tx, row.programId, inviteeId);
      if (row.participants.length >= row.program.teamMaxSize)
        throw new PreparationConflict('full');
      const existing = await tx.applicationPreparationParticipant.findUnique({
        where: { preparationId_userId: { preparationId, userId: inviteeId } },
        select: { status: true },
      });
      if (existing?.status === 'PENDING')
        throw new PreparationConflict('not-pending');
      const created = await tx.applicationPreparationParticipant.upsert({
        where: { preparationId_userId: { preparationId, userId: inviteeId } },
        create: {
          preparationId,
          programId: row.programId,
          userId: inviteeId,
          invitedAt: now,
        },
        update: { status: 'PENDING', invitedAt: now, respondedAt: null },
        select: INVITATION_SELECT,
      });
      return invitation(created);
    });
  }

  async respond(
    invitationId: string,
    actorId: string,
    action: 'accept' | 'decline' | 'cancel',
    now: Date,
  ): Promise<{ readonly teamId: string; readonly programId: string }> {
    const initial =
      await this.prisma.applicationPreparationParticipant.findUnique({
        where: { id: invitationId },
        select: { programId: true },
      });
    if (!initial) throw new PreparationConflict('not-found');
    return this.prisma.$transaction(async (tx) => {
      await lockProgram(tx, initial.programId);
      const row = await tx.applicationPreparationParticipant.findUnique({
        where: { id: invitationId },
        select: INVITATION_SELECT,
      });
      if (!row) throw new PreparationConflict('not-found');
      if (
        action === 'cancel'
          ? row.preparation.leaderId !== actorId
          : row.userId !== actorId
      )
        throw new PreparationConflict('member-required');
      if (row.status !== 'PENDING')
        throw new PreparationConflict('not-pending');
      if (action === 'accept') {
        assertOpen(row.preparation.program, now);
        await assertEligible(tx, actorId);
        await assertAvailable(tx, row.preparation.programId, actorId);
        if (
          row.preparation.participants.length >=
          row.preparation.program.teamMaxSize
        )
          throw new PreparationConflict('full');
      }
      await tx.applicationPreparationParticipant.update({
        where: { id: invitationId },
        data: {
          status: action === 'accept' ? 'ACCEPTED' : 'DECLINED',
          respondedAt: now,
        },
      });
      return {
        teamId: row.preparation.id,
        programId: row.preparation.programId,
      };
    });
  }

  async remove(
    programId: string,
    actorId: string,
    memberId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockProgram(tx, programId);
      const row = await tx.applicationPreparation.findFirst({
        where: {
          programId,
          participants: { some: { userId: actorId, status: 'ACCEPTED' } },
        },
        select: { id: true, leaderId: true },
      });
      if (!row) throw new PreparationConflict('not-found');
      if (row.leaderId !== actorId && memberId !== actorId)
        throw new PreparationConflict('leader-required');
      if (memberId === row.leaderId) {
        await tx.applicationPreparation.delete({ where: { id: row.id } });
        return;
      }
      await tx.applicationPreparationParticipant.deleteMany({
        where: { preparationId: row.id, userId: memberId },
      });
    });
  }
}
