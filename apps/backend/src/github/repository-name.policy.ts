import { createHash } from 'node:crypto';

export const GITHUB_REPOSITORY_NAME_MAX_LENGTH = 100;
const REPOSITORY_OWNERSHIP_MARKER_PREFIX = 'oss-hub:';

export interface RepositoryNameInput {
  readonly programName: string;
  readonly programId: string;
  readonly subjectName: string | null;
  readonly applicationId: string;
}

export interface RepositoryNameCandidates {
  readonly preferred: string;
  readonly collisionFallback: string;
}

class RepositoryNameInputError extends Error {
  override readonly name = 'RepositoryNameInputError';

  constructor() {
    super('Repository name requires stable ASCII identifiers');
  }
}

export function buildRepositoryNames(
  input: RepositoryNameInput,
): RepositoryNameCandidates {
  const applicationSuffix = stableIdPrefix(input.applicationId);
  const programSlug = stableSlug('program', input.programName, input.programId);
  const subjectSlug = stableSlug(
    input.subjectName === null ? 'application' : 'team',
    input.subjectName ?? '',
    input.applicationId,
  );
  const preferred = truncateSlug(`${programSlug}-${subjectSlug}`);
  const suffix = `-${applicationSuffix}`;
  const collisionFallback = `${truncateSlug(
    preferred,
    GITHUB_REPOSITORY_NAME_MAX_LENGTH - suffix.length,
  )}${suffix}`;
  return { preferred, collisionFallback };
}

export function buildRepositoryOwnershipMarker(applicationId: string): string {
  return `${REPOSITORY_OWNERSHIP_MARKER_PREFIX}${createHash('sha256')
    .update(applicationId, 'utf8')
    .digest('hex')}`;
}

function stableSlug(kind: string, value: string, stableId: string): string {
  const slug = toAsciiSlug(value);
  return slug || `${kind}-${stableIdPrefix(stableId)}`;
}

function toAsciiSlug(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function stableIdPrefix(value: string): string {
  const prefix = value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 8);
  if (!prefix) {
    throw new RepositoryNameInputError();
  }
  return prefix;
}

function truncateSlug(
  value: string,
  maxLength = GITHUB_REPOSITORY_NAME_MAX_LENGTH,
): string {
  return value.slice(0, maxLength).replace(/-+$/g, '');
}
