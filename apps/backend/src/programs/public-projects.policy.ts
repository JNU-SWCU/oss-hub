import type { ProgramTrackType } from '@prisma/client';

type CollectionRepositoryVisibility = 'PRIVATE' | 'PUBLIC';
type CollectionRepositoryPresence = 'PRESENT' | 'ABSENT';

interface PublicEligibilityObservation {
  readonly visibility: CollectionRepositoryVisibility;
  readonly presence: CollectionRepositoryPresence;
  readonly observedAt: Date | null;
}

export interface PublicEligibilityInput {
  readonly platformPublic: boolean;
  readonly publishedAt: Date | null;

  readonly observation: PublicEligibilityObservation | null;
}

export function isPublicEligible(input: PublicEligibilityInput): boolean {
  if (!input.platformPublic || input.publishedAt === null) return false;

  const observation = input.observation;
  if (observation === null || observation.observedAt === null) return true;

  const isPrivateOrMissing =
    observation.visibility === 'PRIVATE' || observation.presence === 'ABSENT';
  if (!isPrivateOrMissing) return true;

  return observation.observedAt.getTime() <= input.publishedAt.getTime();
}

export const PUBLIC_PROJECT_YEAR_MIN = 2000;

export const PUBLIC_PROJECT_YEAR_MAX = 2100;

export interface PublicProjectRow {
  readonly id: string;

  readonly projectId: string;
  readonly githubRepositoryId: bigint;
  readonly repositoryName: string;
  readonly githubUrl: string;
  readonly publishedAt: Date;
  readonly programId: string;
  readonly programName: string;
  readonly trackType: ProgramTrackType | null;
  readonly teamName: string | null;

  readonly teamMemberCount: number;
  readonly applicantNickname: string;
}

export enum PublicProjectApplicationMode {
  PERSONAL = 'PERSONAL',
  TEAM = 'TEAM',
}

export function applicationMode(
  teamMemberCount: number,
): PublicProjectApplicationMode {
  return teamMemberCount > 1
    ? PublicProjectApplicationMode.TEAM
    : PublicProjectApplicationMode.PERSONAL;
}

export function displayNameOf(row: {
  readonly teamName: string | null;
  readonly teamMemberCount: number;
  readonly applicantNickname: string;
}): string {
  if (row.teamMemberCount > 1 && row.teamName) return row.teamName;
  return row.applicantNickname;
}

export interface PublicProjectCursor {
  readonly publishedAt: Date;
  readonly id: string;
}

export interface PublicUserIdentity {
  readonly userId: string;
  readonly githubNickname: string;
  readonly avatarUrl: string | null;

  readonly githubId: bigint;
}
