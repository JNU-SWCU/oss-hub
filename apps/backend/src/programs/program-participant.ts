import { ApplicationStatus, type Prisma } from '@prisma/client';

export function programApplicationParticipantWhere(
  userId: string,
): Prisma.ApplicationWhereInput {
  return {
    team: { members: { some: { userId } } },
  };
}

export function programApplicationManagerWhere(
  userId: string,
): Prisma.ApplicationWhereInput {
  return {
    team: { leaderId: userId, members: { some: { userId } } },
  };
}

export function isProgramApplicationManager(
  userId: string,
  application: { readonly teamLeaderId: string },
): boolean {
  return application.teamLeaderId === userId;
}

export function canEditStudentRepositoryUrl(
  context: {
    readonly status: ApplicationStatus;
    readonly endAt: Date;
    readonly isManager: boolean;
  },
  now: Date,
): boolean {
  return (
    context.isManager &&
    context.status === ApplicationStatus.APPROVED &&
    now < context.endAt
  );
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
