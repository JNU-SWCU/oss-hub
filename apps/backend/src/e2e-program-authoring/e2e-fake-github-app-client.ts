import {
  COLLABORATOR_OUTCOMES,
  type CollaboratorOutcome,
  type GithubPublicRepositoryMetadata,
  type GithubRepositoryMetadata,
} from '../github/github-app.client';
import {
  GITHUB_OPERATIONS_ERROR_CODES,
  GithubOperationsError,
} from '../github/github-app.error';
import {
  E2E_EXTERNAL_FAILURE_OPERATIONS,
  type E2eExternalFailureOperation,
  type E2eExternalPortRegistry,
} from './e2e-external-port-registry';

type FakeRepository = {
  readonly metadata: GithubRepositoryMetadata;
  readonly collaborators: Set<string>;
};

type RepositoryMetadataInput = {
  readonly name: string;
  readonly visibility: GithubRepositoryMetadata['visibility'];
  readonly description: string | null;
  readonly owner: string;
};

const PRIVATE_EXTERNAL_NAMES = new Set([
  'private',
  'private-repository',
  'inaccessible',
  'inaccessible-repository',
]);

export class E2eFakeGithubAppClient {
  private organizationName = 'e2e-org';
  private readonly repositories = new Map<string, FakeRepository>();

  constructor(private readonly registry: E2eExternalPortRegistry) {
    this.reset();
  }

  get organization(): string {
    return this.organizationName;
  }

  get configuredOrganization(): string {
    return this.organizationName;
  }

  configureOrganization(organization: string): void {
    if (this.organizationName === organization) return;
    this.organizationName = organization;
    this.reset();
  }

  reset(): void {
    this.repositories.clear();
    this.store('owned-private', 'PRIVATE', 'owned private repository');
    this.store('owned-public', 'PUBLIC', 'owned public repository');
    this.store('owned', 'PRIVATE', 'owned repository');
  }

  findRepository(name: string): Promise<GithubRepositoryMetadata | null> {
    const failure = this.configuredFailure(
      E2E_EXTERNAL_FAILURE_OPERATIONS.GITHUB_FIND,
    );
    if (failure !== null) return Promise.reject(failure);
    return Promise.resolve(this.repositories.get(key(name))?.metadata ?? null);
  }

  findPublicRepository(
    owner: string,
    name: string,
  ): Promise<GithubPublicRepositoryMetadata | null> {
    const failure = this.configuredFailure(
      E2E_EXTERNAL_FAILURE_OPERATIONS.GITHUB_FIND_PUBLIC,
    );
    if (failure !== null) return Promise.reject(failure);
    if (PRIVATE_EXTERNAL_NAMES.has(key(name))) return Promise.resolve(null);
    return Promise.resolve({
      ...this.metadata({
        name,
        visibility: 'PUBLIC',
        description: null,
        owner,
      }),
      nameWithOwner: `${owner}/${name}`,
      defaultBranch: 'main',
      archived: false,
    });
  }

  createRepository(
    name: string,
    description: string,
  ): Promise<GithubRepositoryMetadata> {
    const failure = this.configuredFailure(
      E2E_EXTERNAL_FAILURE_OPERATIONS.GITHUB_CREATE,
    );
    if (failure !== null) return Promise.reject(failure);
    return Promise.resolve(this.store(name, 'PRIVATE', description).metadata);
  }

  ensureCollaborator(
    repositoryName: string,
    githubLogin: string,
  ): Promise<CollaboratorOutcome> {
    const failure = this.configuredFailure(
      E2E_EXTERNAL_FAILURE_OPERATIONS.GITHUB_COLLABORATOR,
    );
    if (failure !== null) return Promise.reject(failure);
    const repository = this.repositories.get(key(repositoryName));
    if (repository === undefined) {
      throw new GithubOperationsError(
        GITHUB_OPERATIONS_ERROR_CODES.INVALID_INPUT,
        false,
      );
    }
    repository.collaborators.add(key(githubLogin));
    return Promise.resolve(COLLABORATOR_OUTCOMES.PENDING);
  }

  publishRepository(name: string): Promise<GithubRepositoryMetadata> {
    const failure = this.configuredFailure(
      E2E_EXTERNAL_FAILURE_OPERATIONS.GITHUB_PUBLISH,
    );
    if (failure !== null) return Promise.reject(failure);
    const repository = this.repositories.get(key(name));
    if (repository === undefined) {
      throw new GithubOperationsError(
        GITHUB_OPERATIONS_ERROR_CODES.INVALID_INPUT,
        false,
      );
    }
    const published = this.store(
      repository.metadata.name,
      'PUBLIC',
      repository.metadata.description,
    );
    for (const collaborator of repository.collaborators) {
      published.collaborators.add(collaborator);
    }
    return Promise.resolve(published.metadata);
  }

  private store(
    name: string,
    visibility: GithubRepositoryMetadata['visibility'],
    description: string | null,
  ): FakeRepository {
    const repository: FakeRepository = {
      metadata: this.metadata({
        name,
        visibility,
        description,
        owner: this.organizationName,
      }),
      collaborators:
        this.repositories.get(key(name))?.collaborators ?? new Set(),
    };
    this.repositories.set(key(name), repository);
    return repository;
  }

  private metadata(input: RepositoryMetadataInput): GithubRepositoryMetadata {
    return {
      githubRepositoryId: repositoryId(input.owner, input.name),
      name: input.name,
      url: `https://github.com/${input.owner}/${input.name}`,
      visibility: input.visibility,
      description: input.description,
    };
  }

  private configuredFailure(
    operation: E2eExternalFailureOperation,
  ): GithubOperationsError | null {
    if (!this.registry.consume(operation)) return null;
    return new GithubOperationsError(
      GITHUB_OPERATIONS_ERROR_CODES.UPSTREAM,
      true,
    );
  }
}

function key(value: string): string {
  return value.toLowerCase();
}

function repositoryId(owner: string, name: string): bigint {
  let value = 0;
  for (const character of `${owner}/${name}`) {
    value = (value * 31 + character.charCodeAt(0)) >>> 0;
  }
  return 9_000_000_000n + BigInt(value);
}
