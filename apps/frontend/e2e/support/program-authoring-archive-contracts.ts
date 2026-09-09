export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Expected synthetic API object.');
  return value as Record<string, unknown>;
}
export function list(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error('Expected synthetic API array.');
  return value;
}
export function text(value: unknown): string {
  if (typeof value !== 'string')
    throw new Error('Expected synthetic API string.');
  return value;
}
export function parseProgram(value: unknown) {
  const source = record(value);
  return {
    name: text(source.name),
    milestones: list(source.milestones).map((value) => {
      const item = record(value);
      return { id: text(item.id), name: text(item.name) };
    }),
  };
}
export function parseTeams(value: unknown) {
  return list(value).map((value) => {
    const team = record(value);
    return {
      teamId: text(team.teamId),
      name: text(team.name),
      members: list(team.members).map((value) => ({
        nickname: text(record(value).nickname),
      })),
    };
  });
}
export function parseDocuments(value: unknown) {
  return list(record(value).documents).map((value) => {
    const item = record(value);
    if (typeof item.required !== 'boolean')
      throw new Error('Expected document required flag.');
    return {
      id: text(item.id),
      name: text(item.name),
      required: item.required,
    };
  });
}
export function parseSnapshot(value: unknown) {
  const source = record(value);
  const milestone = record(source.milestone);
  return {
    documents: parseDocuments(source),
    fingerprint: text(source.fingerprint),
    milestone: {
      name: text(milestone.name),
      startAt: text(milestone.startAt),
      dueAt: text(milestone.dueAt),
      instructions:
        milestone.instructions === null ? null : text(milestone.instructions),
    },
  };
}
