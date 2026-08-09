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

type ProvisionGithubClient = Pick<
  GithubAppClient,
  'findRepository' | 'createRepository' | 'findPublicRepository'
>;

/** `https://github.com/{owner}/{name}` 만 허용. 그 외(쿼리·.git·하위경로) 거부. */
export function parseOwnGithubRepositoryUrl(
  repositoryUrl: string,
): { readonly owner: string; readonly name: string } | null {
  if (!URL.canParse(repositoryUrl)) {
    return null;
  }
  const parsed = new URL(repositoryUrl);
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'github.com' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.port !== '' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    return null;
  }
  const segments = parsed.pathname.split('/').filter((part) => part !== '');
  if (segments.length !== 2) {
    return null;
  }
  const [owner, name] = segments;
  if (
    owner === undefined ||
    name === undefined ||
    !isGithubOwnerSegment(owner) ||
    !isGithubRepositoryNameSegment(name)
  ) {
    return null;
  }
  return { owner, name };
}

/**
 * OWN 연결: 조직에 만들지 않고 학생 URL의 공개 저장소만 조회한다.
 * 쓰기는 하지 않는다(ADR-009).
 */
export async function resolveOwnGithubRepository(
  github: Pick<GithubAppClient, 'findPublicRepository'>,
  repositoryUrl: string,
): Promise<GithubPublicRepositoryMetadata> {
  const parsed = parseOwnGithubRepositoryUrl(repositoryUrl);
  if (parsed === null) {
    throw finalProvisionFailure(
      PROVISION_ERROR_CODES.OWN_REPOSITORY_URL_INVALID,
    );
  }
  const repository = await github.findPublicRepository(
    parsed.owner,
    parsed.name,
  );
  if (repository === null) {
    throw finalProvisionFailure(PROVISION_ERROR_CODES.OWN_REPOSITORY_NOT_FOUND);
  }
  // 학생이 준 URL을 그대로 기록한다(html_url 정규화로 바꾸지 않음).
  return {
    ...repository,
    name: parsed.name,
    url: repositoryUrl,
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
function isGithubOwnerSegment(value: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(value);
}

function isGithubRepositoryNameSegment(value: string): boolean {
  // `.git` 접미사는 클론 URL 관례라 웹 URL 계약에서 거부한다.
  return (
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value) &&
    !value.toLowerCase().endsWith('.git')
  );
}
