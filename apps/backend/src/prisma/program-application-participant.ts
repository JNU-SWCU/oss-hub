import type { Prisma } from '@prisma/client';

export function programApplicationManagerWhere(
  userId: string,
): Prisma.ApplicationWhereInput {
  return {
    team: { leaderId: userId, members: { some: { userId } } },
  };
}

export function programApplicationParticipantWhere(
  userId: string,
): Prisma.ApplicationWhereInput {
  return {
    team: { members: { some: { userId } } },
  };
}
