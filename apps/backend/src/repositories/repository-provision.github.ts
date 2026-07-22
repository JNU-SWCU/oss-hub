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
): Promise<GithubRepositoryMetadata> {
  const existing = await github.findRepository(names.preferred);
  if (existing !== null) {
    return existing;
  }
  try {
    return await github.createRepository(names.preferred);
  } catch (error) {
    if (!isNameCollision(error)) {
      throw error;
    }
    return (
      (await github.findRepository(names.collisionFallback)) ??
      github.createRepository(names.collisionFallback)
    );
  }
}

function isNameCollision(error: unknown): boolean {
  return (
    error instanceof GithubOperationsError &&
    error.code === GITHUB_OPERATIONS_ERROR_CODES.INVALID_INPUT
  );
}
