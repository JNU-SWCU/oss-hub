import {
  AccountStatus,
  Prisma,
  Role,
  TeamInvitationStatus,
} from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

export type AcceptInvitationOutcome =
  | { readonly kind: 'not-found' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'not-pending' }
  | { readonly kind: 'already-in-team' }
  | { readonly kind: 'team-full' }
  | { readonly kind: 'invitee-not-eligible' }
  | { readonly kind: 'team-locked' }
  | {
      readonly kind: 'ok';
      readonly teamId: string;
      readonly programId: string;
    };

interface LockedTeamRow {
  readonly id: string;
}

interface LockedUserRow {
  readonly id: string;
}

/**
 * 팀 행 잠금부터 초대 CAS와 멤버 생성까지 한 트랜잭션에서 수행한다.
 * 잠금 순서는 Team → User로 고정한다. Team은 신청 제출·정원 경합을,
 * User는 수락과 역할 변경·비활성화 경합을 직렬화한다.
 */
export async function acceptTeamInvitationTransaction(
  prisma: PrismaService,
  invitationId: string,
  inviteeId: string,
  now: Date,
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
          team: { select: { program: { select: { teamMaxSize: true } } } },
        },
      });
      if (!invitation) return { kind: 'not-found' };
      if (invitation.inviteeId !== inviteeId) return { kind: 'forbidden' };

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

      const application = await tx.application.findFirst({
        where: { teamId: invitation.teamId },
        select: { id: true },
      });
      if (application) return { kind: 'team-locked' };

      await tx.$queryRaw<readonly LockedUserRow[]>(
        Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${inviteeId} FOR UPDATE`,
      );
      const invitee = await tx.user.findUnique({
        where: { id: inviteeId },
        select: { id: true, role: true, accountStatus: true },
      });
      if (
        invitee?.role !== Role.STUDENT ||
        invitee.accountStatus !== AccountStatus.ACTIVE
      ) {
        return { kind: 'invitee-not-eligible' };
      }

      const existingMembership = await tx.teamMember.findUnique({
        where: {
          programId_userId: {
            programId: invitation.programId,
            userId: inviteeId,
          },
        },
        select: { userId: true },
      });
      if (existingMembership) return { kind: 'already-in-team' };

      const maxSize = invitation.team.program.teamMaxSize;
      const memberCount = await tx.teamMember.count({
        where: { teamId: invitation.teamId },
      });
      if (memberCount >= maxSize) return { kind: 'team-full' };

      const updated = await tx.teamInvitation.updateMany({
        where: { id: invitationId, status: TeamInvitationStatus.PENDING },
        data: { status: TeamInvitationStatus.ACCEPTED, respondedAt: now },
      });
      if (updated.count === 0) return { kind: 'not-pending' };

      await tx.teamMember.create({
        data: {
          teamId: invitation.teamId,
          programId: invitation.programId,
          userId: inviteeId,
        },
      });

      return {
        kind: 'ok',
        teamId: invitation.teamId,
        programId: invitation.programId,
      };
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
