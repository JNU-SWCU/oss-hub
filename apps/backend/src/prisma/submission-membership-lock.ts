import { Prisma } from '@prisma/client';
import { programApplicationParticipantWhere } from './program-application-participant';

type LockedRow = Readonly<{ id: string }>;

type ApplicationCoordinates = Readonly<{ programId: string; teamId: string }>;

export async function lockSubmissionMembership(
  tx: Prisma.TransactionClient,
  applicationId: string,
  userId: string,
): Promise<boolean> {
  const coordinates: ApplicationCoordinates | null =
    await tx.application.findUnique({
      where: { id: applicationId },
      select: { programId: true, teamId: true },
    });
  if (!coordinates) return false;

  const lockedPrograms = await tx.$queryRaw<readonly LockedRow[]>(Prisma.sql`
    SELECT "id" FROM "Program" WHERE "id" = ${coordinates.programId} FOR UPDATE
  `);
  if (lockedPrograms.length === 0) return false;

  const lockedTeams = await tx.$queryRaw<readonly LockedRow[]>(Prisma.sql`
    SELECT "id" FROM "Team" WHERE "id" = ${coordinates.teamId} FOR UPDATE
  `);
  if (lockedTeams.length === 0) return false;

  const current = await tx.application.findFirst({
    where: {
      id: applicationId,
      ...programApplicationParticipantWhere(userId),
    },
    select: { id: true },
  });
  return current !== null;
}
