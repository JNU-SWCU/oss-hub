import {
  GITHUB_OPERATIONS_ERROR_CODES,
  GithubOperationsError,
} from './github-app.error';
import type {
  GithubAppClient,
  GithubRepositoryMetadata,
} from './github-app.client';
import type { RepositoryNameCandidates } from './repository-name';

type ProvisionGithubClient = Pick<
  GithubAppClient,
  'findRepository' | 'createRepository'
>;

export async function findOrCreateGithubRepository(
  github: ProvisionGithubClient,
  names: RepositoryNameCandidates,
  ownershipMarker: string,
): Promise<GithubRepositoryMetadata> {
  const existing = await github.findRepository(names.preferred);
  if (existing !== null) {
    return existing.description === ownershipMarker
      ? requirePrivateRepository(existing)
      : findOrCreateFallback(github, names.collisionFallback, ownershipMarker);
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
