import { isRecord } from './is-record';

export interface UserParticipation {
  readonly programId: string;
  readonly programName: string;
  readonly teamName: string;
  readonly isLeader: boolean;
}

function isUserParticipation(value: unknown): value is UserParticipation {
  return (
    isRecord(value) &&
    typeof value.programId === 'string' &&
    value.programId.length > 0 &&
    typeof value.programName === 'string' &&
    typeof value.teamName === 'string' &&
    typeof value.isLeader === 'boolean'
  );
}

export function parseUserParticipations(
  value: unknown,
): readonly UserParticipation[] | null {
  if (!Array.isArray(value) || !value.every(isUserParticipation)) {
    return null;
  }
  return value.map((participation) => ({
    programId: participation.programId,
    programName: participation.programName,
    teamName: participation.teamName,
    isLeader: participation.isLeader,
  }));
}
