import { Injectable } from '@nestjs/common';
import {
  GITHUB_OPERATIONS_ERROR_CODES,
  GithubOperationsError,
  throwForGithubErrorResponse,
} from './github-app.error';
import type {
  GithubAppFetcher,
  GithubInstallationTokenProvider,
} from './github-app-token.client';

type UnknownRecord = { readonly [key: string]: unknown };

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type GithubRepositoryMetadata = {
  readonly githubRepositoryId: bigint;
  readonly name: string;
  readonly url: string;
  readonly nameWithOwner: string;
  readonly visibility: 'PRIVATE' | 'PUBLIC';
  readonly description: string | null;
};

export type GithubPublicRepositoryMetadata = GithubRepositoryMetadata & {
  readonly defaultBranch: string | null;
  readonly archived: boolean;
};

export type GithubRepositoryInvitation = {
  readonly invitationId: number;
  readonly login: string;
};

function parseGithubRepository(value: unknown): GithubRepositoryMetadata {
  if (!isRecord(value)) {
    throw invalidGithubResponseError();
  }
  const id = value.id;
  const name = value.name;
  const url = value.html_url;
  const nameWithOwner = value.full_name;
  const visibility = value.visibility;
  const description = value.description;
  if (
    typeof id !== 'number' ||
    !Number.isSafeInteger(id) ||
    typeof name !== 'string' ||
    typeof url !== 'string' ||
    !URL.canParse(url) ||
    typeof nameWithOwner !== 'string' ||
    !isGithubNameWithOwner(nameWithOwner) ||
    (visibility !== 'private' && visibility !== 'public') ||
    (description !== null && typeof description !== 'string')
  ) {
    throw invalidGithubResponseError();
  }
  return {
    githubRepositoryId: BigInt(id),
    name,
    url,
    nameWithOwner,
    visibility: visibility === 'private' ? 'PRIVATE' : 'PUBLIC',
    description,
  };
}

function parseGithubPublicRepository(
  value: unknown,
): GithubPublicRepositoryMetadata {
  const repository = parseGithubRepository(value);
  if (!isRecord(value)) {
    throw invalidGithubResponseError();
  }
  const defaultBranch = value.default_branch;
  const archived = value.archived;
  if (
    (defaultBranch !== null &&
      (typeof defaultBranch !== 'string' || defaultBranch.length === 0)) ||
    typeof archived !== 'boolean'
  ) {
    throw invalidGithubResponseError();
  }
  return {
    ...repository,
    defaultBranch,
    archived,
  };
}

async function readGithubJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw invalidGithubResponseError();
    }
    throw error;
  }
}

function invalidGithubResponseError(): GithubOperationsError {
  return new GithubOperationsError(
    GITHUB_OPERATIONS_ERROR_CODES.INVALID_RESPONSE,
    false,
  );
}

function isGithubNameWithOwner(value: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(
    value,
  );
}

const GITHUB_API_BASE_URL = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';
const USER_AGENT = 'oss-hub-backend';
const REQUEST_TIMEOUT_MS = 10_000;
const INVITATION_PAGE_SIZE = 100;
const INVITATION_PAGE_LIMIT = 50;

export const COLLABORATOR_OUTCOMES = {
  PENDING: 'PENDING',
  SUCCEEDED: 'SUCCEEDED',
} as const;

export type CollaboratorOutcome =
  (typeof COLLABORATOR_OUTCOMES)[keyof typeof COLLABORATOR_OUTCOMES];

@Injectable()
export class GithubAppClient {
  constructor(
    private readonly tokenProvider: GithubInstallationTokenProvider,
    private readonly fetcher: GithubAppFetcher = globalThis.fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  parseRepositoryInvitations(
    value: unknown,
  ): readonly GithubRepositoryInvitation[] {
    if (!Array.isArray(value)) {
      throw invalidGithubResponseError();
    }
    return value.map((invitation) => {
      if (!isRecord(invitation) || !isRecord(invitation.invitee)) {
        throw invalidGithubResponseError();
      }
      const invitationId = invitation.id;
      const login = invitation.invitee.login;
      if (
        typeof invitationId !== 'number' ||
        !Number.isSafeInteger(invitationId) ||
        invitationId <= 0 ||
        typeof login !== 'string' ||
        login.length === 0
      ) {
        throw invalidGithubResponseError();
      }
      return { invitationId, login };
    });
  }

  get organization(): string {
    return this.tokenProvider.organization;
  }

  async findRepository(name: string): Promise<GithubRepositoryMetadata | null> {
    const response = await this.request(this.repositoryPath(name));
    if (response.status === 404) {
      return null;
    }
    await throwForGithubErrorResponse(response, this.now());
    return parseGithubRepository(await readGithubJson(response));
  }

  async findPublicRepository(
    owner: string,
    name: string,
  ): Promise<GithubPublicRepositoryMetadata | null> {
    const response = await this.requestPublic(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
    );
    if (response.status === 404) {
      return null;
    }
    await throwForGithubErrorResponse(response, this.now());
    return parseGithubPublicRepository(await readGithubJson(response));
  }

  async createRepository(
    name: string,
    description: string,
  ): Promise<GithubRepositoryMetadata> {
    const response = await this.request(
      `/orgs/${encodeURIComponent(this.tokenProvider.organization)}/repos`,
      {
        method: 'POST',
        body: JSON.stringify({ name, private: true, description }),
      },
    );
    await throwForGithubErrorResponse(response, this.now());
    return parseGithubRepository(await readGithubJson(response));
  }

  async ensureCollaborator(
    repositoryName: string,
    githubLogin: string,
  ): Promise<CollaboratorOutcome> {
    const repositoryPath = this.repositoryPath(repositoryName);
    const collaboratorPath = `${repositoryPath}/collaborators/${encodeURIComponent(
      githubLogin,
    )}`;
    const collaboratorResponse = await this.request(collaboratorPath);
    if (collaboratorResponse.status === 204) {
      return COLLABORATOR_OUTCOMES.SUCCEEDED;
    }
    if (collaboratorResponse.status !== 404) {
      await throwForGithubErrorResponse(collaboratorResponse, this.now());
    }

    const invitations = await this.listInvitations(repositoryPath);
    if (
      invitations.some(
        (invitation) =>
          invitation.login.toLowerCase() === githubLogin.toLowerCase(),
      )
    ) {
      return COLLABORATOR_OUTCOMES.PENDING;
    }

    const inviteResponse = await this.request(collaboratorPath, {
      method: 'PUT',
      body: JSON.stringify({ permission: 'push' }),
    });
    if (inviteResponse.status === 201) {
      return COLLABORATOR_OUTCOMES.PENDING;
    }
    if (inviteResponse.status === 204) {
      return COLLABORATOR_OUTCOMES.SUCCEEDED;
    }
    await throwForGithubErrorResponse(inviteResponse, this.now(), true);
    throw invalidGithubResponseError();
  }

  async revokeCollaborator(
    repositoryName: string,
    githubLogin: string,
  ): Promise<void> {
    const repositoryPath = this.repositoryPath(repositoryName);
    const target = githubLogin.toLowerCase();
    const invitations = await this.listInvitations(repositoryPath);
    for (const invitation of invitations) {
      if (invitation.login.toLowerCase() !== target) {
        continue;
      }
      const cancelResponse = await this.request(
        `${repositoryPath}/invitations/${invitation.invitationId}`,
        { method: 'DELETE' },
      );

      if (cancelResponse.status === 204 || cancelResponse.status === 404) {
        continue;
      }
      await throwForGithubErrorResponse(cancelResponse, this.now());
    }

    const response = await this.request(
      `${repositoryPath}/collaborators/${encodeURIComponent(githubLogin)}`,
      { method: 'DELETE' },
    );
    if (response.status === 204) {
      return;
    }
    if (response.status === 404) {
      await this.assertRepositoryAccessible(repositoryName);
      return;
    }
    await throwForGithubErrorResponse(response, this.now());
    throw invalidGithubResponseError();
  }

  async publishRepository(name: string): Promise<GithubRepositoryMetadata> {
    const response = await this.request(this.repositoryPath(name), {
      method: 'PATCH',
      body: JSON.stringify({ visibility: 'public' }),
    });
    await throwForGithubErrorResponse(response, this.now());
    return parseGithubRepository(await readGithubJson(response));
  }

  private async listInvitations(
    repositoryPath: string,
  ): Promise<readonly GithubRepositoryInvitation[]> {
    const invitations: GithubRepositoryInvitation[] = [];
    for (let page = 1; page <= INVITATION_PAGE_LIMIT; page += 1) {
      const response = await this.request(
        `${repositoryPath}/invitations?per_page=${INVITATION_PAGE_SIZE}&page=${page}`,
      );
      await throwForGithubErrorResponse(response, this.now());
      const parsed = this.parseRepositoryInvitations(
        await readGithubJson(response),
      );
      invitations.push(...parsed);
      if (parsed.length < INVITATION_PAGE_SIZE) {
        return invitations;
      }
    }

    throw invalidGithubResponseError();
  }

  private async assertRepositoryAccessible(name: string): Promise<void> {
    if ((await this.findRepository(name)) === null) {
      throw new GithubOperationsError(
        GITHUB_OPERATIONS_ERROR_CODES.INVALID_INPUT,
        false,
      );
    }
  }

  private repositoryPath(name: string): string {
    return `/repos/${encodeURIComponent(
      this.tokenProvider.organization,
    )}/${encodeURIComponent(name)}`;
  }
  private async requestPublic(
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    try {
      return await this.fetcher(`${GITHUB_API_BASE_URL}${path}`, {
        ...init,
        headers: {
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT,
          'X-GitHub-Api-Version': GITHUB_API_VERSION,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof Error) {
        throw new GithubOperationsError(
          GITHUB_OPERATIONS_ERROR_CODES.UPSTREAM,
          true,
        );
      }
      throw error;
    }
  }

  private async request(
    path: string,
    init: RequestInit = {},
    retriedAfterAuthentication = false,
  ): Promise<Response> {
    const token = await this.tokenProvider.accessToken();
    let response: Response;
    try {
      response = await this.fetcher(`${GITHUB_API_BASE_URL}${path}`, {
        ...init,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT,
          'X-GitHub-Api-Version': GITHUB_API_VERSION,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof Error) {
        throw new GithubOperationsError(
          GITHUB_OPERATIONS_ERROR_CODES.UPSTREAM,
          true,
        );
      }
      throw error;
    }
    if (response.status !== 401) {
      return response;
    }
    if (retriedAfterAuthentication) {
      throw new GithubOperationsError(
        GITHUB_OPERATIONS_ERROR_CODES.AUTHENTICATION,
        false,
      );
    }
    this.tokenProvider.invalidateAccessToken();
    return this.request(path, init, true);
  }
}
