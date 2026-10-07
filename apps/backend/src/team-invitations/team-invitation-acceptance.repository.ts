import {
  AccountStatus,
  MemberKind,
  Prisma,
  TeamInvitationStatus,
} from '@prisma/client';
import type { AuditLogTransactionWriter } from '../audit-log/audit-log.repository';
import {
  repositoryAccessSyncEventData,
  repositoryAccessSyncTargetWhere,
} from '../github/repository-provision-event';
import type { PrismaService } from '../prisma/prisma.service';

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

interface LockedTeamRow {
  readonly id: string;
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

interface LockedUserRow {
  readonly id: string;
}

export type AcceptInvitationOkContext = {
  readonly teamId: string;
  readonly programId: string;
  readonly teamName: string;
  readonly programName: string;
};

export type AcceptInvitationOkStore = {
  readonly auditLogWriter: AuditLogTransactionWriter;
};

export type AcceptInvitationOnOk = (
  store: AcceptInvitationOkStore,
  names: AcceptInvitationOkContext,
) => Promise<void>;

export async function acceptTeamInvitationTransaction(
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
