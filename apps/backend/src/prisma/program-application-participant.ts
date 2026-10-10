import type { Prisma } from '@prisma/client';

export function programApplicationParticipantWhere(
  userId: string,
): Prisma.ApplicationWhereInput {
  return {
    team: { members: { some: { userId } } },
  };
}
