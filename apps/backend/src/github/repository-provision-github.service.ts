import { RepositoryNameInputError } from './repositories.error';
import type { OwnGithubRepositoryResolution } from './own-repository-resolution.types';
import {
  GITHUB_OPERATIONS_ERROR_CODES,
  GithubOperationsError,
} from './github-app.error';
import type {
  GithubAppClient,
  GithubRepositoryMetadata,
} from './github-app.client';
import { createHash } from 'node:crypto';
import {
  finalProvisionFailure,
  PROVISION_ERROR_CODES,
} from './repository-provision-state.repository';
import { parseGithubRepositoryUrl } from './repositories-read.service';

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

type ProvisionGithubClient = Pick<
  GithubAppClient,
  'findRepository' | 'createRepository' | 'findPublicRepository'
> & { readonly organization: string };

export class RepositoryProvisionGithubService {
  static async resolveOwnGithubRepository(
    github: Pick<
      GithubAppClient,
      'organization' | 'findRepository' | 'findPublicRepository'
    >,
    repositoryUrl: string,
  ): Promise<OwnGithubRepositoryResolution> {
    const parsed = parseGithubRepositoryUrl(repositoryUrl);
    if (parsed === null) {
      throw finalProvisionFailure(
        PROVISION_ERROR_CODES.OWN_REPOSITORY_URL_INVALID,
      );
    }
    if (parsed.owner.toLowerCase() === github.organization.toLowerCase()) {
      const repository = await github.findRepository(parsed.name);
      if (repository === null) {
        throw finalProvisionFailure(
          PROVISION_ERROR_CODES.OWN_ORGANIZATION_REPOSITORY_INACCESSIBLE,
        );
      }
      return {
        kind: 'ORGANIZATION',
        repository: {
          ...repository,
          name: parsed.name,
          url: repositoryUrl,
        },
      };
    }

    const repository = await github.findPublicRepository(
      parsed.owner,
      parsed.name,
    );
    if (repository === null || repository.visibility !== 'PUBLIC') {
      throw finalProvisionFailure(
        PROVISION_ERROR_CODES.OWN_REPOSITORY_NOT_FOUND,
      );
    }
    return {
      kind: 'EXTERNAL',
      repository: {
        ...repository,
        name: parsed.name,
        url: repositoryUrl,
      },
    };
  }

  static async findOrCreateGithubRepository(
    github: ProvisionGithubClient,
    names: RepositoryNameCandidates,
    ownershipMarker: string,
  ): Promise<GithubRepositoryMetadata> {
    const existing = await github.findRepository(names.preferred);
    if (existing !== null) {
      return existing.description === ownershipMarker
        ? requirePrivateRepository(existing)
        : findOrCreateFallback(
            github,
            names.collisionFallback,
            ownershipMarker,
          );
    }
    try {
      return await createOwnedRepository(
        github,
        names.preferred,
        ownershipMarker,
      );
    } catch (error) {
      if (!isNameCollision(error)) {
        throw error;
      }
      const racedRepository = await github.findRepository(names.preferred);
      if (racedRepository?.description === ownershipMarker) {
        return requirePrivateRepository(racedRepository);
      }
      return findOrCreateFallback(
        github,
        names.collisionFallback,
        ownershipMarker,
      );
    }
  }
}

async function findOrCreateFallback(
  github: ProvisionGithubClient,
  fallback: string,
  ownershipMarker: string,
): Promise<GithubRepositoryMetadata> {
  const existing = await github.findRepository(fallback);
  if (existing !== null) {
    return requireOwnedRepository(existing, ownershipMarker);
  }
  try {
    return await createOwnedRepository(github, fallback, ownershipMarker);
  } catch (error) {
    if (!isNameCollision(error)) {
      throw error;
    }
    const racedRepository = await github.findRepository(fallback);
    return requireOwnedRepository(racedRepository, ownershipMarker);
  }
}

async function createOwnedRepository(
  github: ProvisionGithubClient,
  name: string,
  ownershipMarker: string,
): Promise<GithubRepositoryMetadata> {
  const repository = await github.createRepository(name, ownershipMarker);
  if (repository.description !== ownershipMarker) {
    throw new GithubOperationsError(
      GITHUB_OPERATIONS_ERROR_CODES.INVALID_RESPONSE,
      false,
    );
  }
  return requirePrivateRepository(repository);
}

function requireOwnedRepository(
  repository: GithubRepositoryMetadata | null,
  ownershipMarker: string,
): GithubRepositoryMetadata {
  if (repository?.description !== ownershipMarker) {
    throw new GithubOperationsError(
      GITHUB_OPERATIONS_ERROR_CODES.INVALID_INPUT,
      false,
    );
  }
  return requirePrivateRepository(repository);
}

function requirePrivateRepository(
  repository: GithubRepositoryMetadata,
): GithubRepositoryMetadata {
  if (repository.visibility !== 'PRIVATE') {
    throw new GithubOperationsError(
      GITHUB_OPERATIONS_ERROR_CODES.INVALID_RESPONSE,
      false,
    );
  }
  return repository;
}

function isNameCollision(error: unknown): boolean {
  return (
    error instanceof GithubOperationsError &&
    error.code === GITHUB_OPERATIONS_ERROR_CODES.INVALID_INPUT
  );
}
