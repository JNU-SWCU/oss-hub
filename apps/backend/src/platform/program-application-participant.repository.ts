import type { Prisma } from '@prisma/client';

export class ProgramApplicationParticipantRepository {
  static programApplicationManagerWhere(
    userId: string,
  ): Prisma.ApplicationWhereInput {
    return {
      team: { leaderId: userId, members: { some: { userId } } },
    };
  }

  static programApplicationParticipantWhere(
    userId: string,
  ): Prisma.ApplicationWhereInput {
    return {
      team: { members: { some: { userId } } },
    };
  }
}

export const submissionCompletionTargetSelect = {
  status: true,
  milestoneDocument: {
    select: { id: true, milestoneId: true, kind: true },
  },
} as const;
