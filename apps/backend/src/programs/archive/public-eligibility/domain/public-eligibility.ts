type CollectionRepositoryVisibility = 'PRIVATE' | 'PUBLIC';
type CollectionRepositoryPresence = 'PRESENT' | 'ABSENT';

export interface PublicEligibilityObservation {
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
