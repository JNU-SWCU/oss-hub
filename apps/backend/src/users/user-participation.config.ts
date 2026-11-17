export const USER_PARTICIPATION_MEMBERSHIPS = {
  where: {
    team: {
      status: 'APPROVED',
      archivedAt: null,
      program: { lifecycle: { not: 'DELETED' } },
    },
  } as const,
  orderBy: [
    { team: { program: { startAt: 'desc' } } } as const,
    { programId: 'asc' } as const,
  ],
  select: {
    team: {
      select: {
        name: true,
        leaderId: true,
        program: { select: { id: true, name: true } },
      },
    },
  } as const,
};

export type UserParticipationMembership = {
  readonly team: {
    readonly name: string;
    readonly leaderId: string;
    readonly program: { readonly id: string; readonly name: string };
  };
};

export type UserParticipation = {
  readonly programId: string;
  readonly programName: string;
  readonly teamName: string;
  readonly isLeader: boolean;
};
