import { GithubOperationsError } from './github-app.error';
import { PROVISION_ERROR_CODES } from './repository-provision-state.config';
import { RepositoryProvisionFailure } from './repository-provision-state.error';
import { Injectable } from '@nestjs/common';
import { RepositoryNameInputError } from './repositories.error';
import { createHash } from 'node:crypto';

@Injectable()
export class RepositoryProvisionRulesService {
  buildRepositoryNames(input: RepositoryNameInput): RepositoryNameCandidates {
    const applicationSuffix = stableIdPrefix(input.applicationId);
    const programSlug = stableSlug(
      'program',
      input.programName,
      input.programId,
    );
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

  buildRepositoryOwnershipMarker(applicationId: string): string {
    return `${REPOSITORY_OWNERSHIP_MARKER_PREFIX}${createHash('sha256')
      .update(applicationId, 'utf8')
      .digest('hex')}`;
  }

  normalizeProvisionFailure(error: unknown): RepositoryProvisionFailure {
    if (error instanceof GithubOperationsError) {
      return new RepositoryProvisionFailure(
        error.code,
        error.retryable,
        error.retryAt,
      );
    }
    if (error instanceof RepositoryProvisionFailure) {
      return error;
    }
    return new RepositoryProvisionFailure(PROVISION_ERROR_CODES.INTERNAL, true);
  }

  provisionRetryAt(
    failure: RepositoryProvisionFailure,
    attempt: number,
    now: Date,
    baseMs: number,
  ): Date {
    if (failure.retryAt !== null && failure.retryAt.getTime() > now.getTime()) {
      return failure.retryAt;
    }
    return new Date(now.getTime() + baseMs * 2 ** Math.max(0, attempt - 1));
  }
}

const REPOSITORY_OWNERSHIP_MARKER_PREFIX = 'oss-hub:';

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

export const GITHUB_REPOSITORY_NAME_MAX_LENGTH = 100;

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
