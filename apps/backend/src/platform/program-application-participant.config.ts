export function programApplicationManagerWhere(userId: string) {
  return {
    team: { leaderId: userId, members: { some: { userId } } },
  };
}

export function programApplicationParticipantWhere(userId: string) {
  return {
    team: { members: { some: { userId } } },
  };
}
