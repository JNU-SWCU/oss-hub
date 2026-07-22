import type { Prisma } from '@prisma/client';

export function programApplicationParticipantWhere(
  userId: string,
): Prisma.ApplicationWhereInput {
  return {
    OR: [
      { applicantId: userId },
      { team: { leaderId: userId } },
      { team: { members: { some: { userId } } } },
    ],
  };
}

export function programParticipantGithubIds(
  applicantGithubId: bigint,
  team: {
    readonly leader: { readonly githubId: bigint };
    readonly members: readonly {
      readonly user: { readonly githubId: bigint };
    }[];
  } | null,
): readonly bigint[] {
  if (!team) return [applicantGithubId];
  return [
    ...new Set([
      team.leader.githubId,
      ...team.members.map((member) => member.user.githubId),
    ]),
  ];
}
