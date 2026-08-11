import {
  GITHUB_OPERATIONS_ERROR_CODES,
  GithubOperationsError,
} from './github-app.error';
import type {
  GithubAppClient,
  GithubPublicRepositoryMetadata,
  GithubRepositoryMetadata,
} from './github-app.client';
import type { RepositoryNameCandidates } from './repository-name';
import {
  finalProvisionFailure,
  PROVISION_ERROR_CODES,
} from './repository-provision.failure';
import { parseGithubRepositoryUrl } from '../common/github-repository-url';

export { parseGithubRepositoryUrl as parseOwnGithubRepositoryUrl } from '../common/github-repository-url';

type ProvisionGithubClient = Pick<
  GithubAppClient,
  'findRepository' | 'createRepository' | 'findPublicRepository'
> & { readonly organization: string };

export type OwnGithubRepositoryResolution =
  | {
      readonly kind: 'ORGANIZATION';
      readonly repository: GithubRepositoryMetadata;
    }
  | {
      readonly kind: 'EXTERNAL';
      readonly repository: GithubPublicRepositoryMetadata;
    };

export async function resolveOwnGithubRepository(
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
    throw finalProvisionFailure(PROVISION_ERROR_CODES.OWN_REPOSITORY_NOT_FOUND);
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
