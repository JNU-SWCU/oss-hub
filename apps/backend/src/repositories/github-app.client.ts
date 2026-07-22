import {
  GITHUB_OPERATIONS_ERROR_CODES,
  GithubOperationsError,
} from './github-app.error';
import type {
  GithubAppFetcher,
  GithubInstallationTokenProvider,
} from './github-app.token';
import {
  invalidGithubResponseError,
  parseGithubRepository,
  parseInvitationLogins,
  readGithubJson,
  throwForGithubErrorResponse,
} from './github-app.response';
import type { GithubRepositoryMetadata } from './github-app.response';

const GITHUB_API_BASE_URL = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';
const USER_AGENT = 'oss-hub-backend';
const REQUEST_TIMEOUT_MS = 10_000;
export type { GithubRepositoryMetadata } from './github-app.response';

export const COLLABORATOR_OUTCOMES = {
  PENDING: 'PENDING',
  SUCCEEDED: 'SUCCEEDED',
} as const;

export type CollaboratorOutcome =
  (typeof COLLABORATOR_OUTCOMES)[keyof typeof COLLABORATOR_OUTCOMES];

export class GithubAppClient {
  constructor(
    private readonly tokenProvider: GithubInstallationTokenProvider,
    private readonly fetcher: GithubAppFetcher = globalThis.fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async findRepository(name: string): Promise<GithubRepositoryMetadata | null> {
    const response = await this.request(this.repositoryPath(name));
    if (response.status === 404) {
      return null;
    }
    await throwForGithubErrorResponse(response, this.now());
    return parseGithubRepository(await readGithubJson(response));
  }

  async createRepository(name: string): Promise<GithubRepositoryMetadata> {
    const response = await this.request(
      `/orgs/${encodeURIComponent(this.tokenProvider.organization)}/repos`,
      {
        method: 'POST',
        body: JSON.stringify({ name, private: true }),
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

    const invitationResponse = await this.request(
      `${repositoryPath}/invitations`,
    );
    await throwForGithubErrorResponse(invitationResponse, this.now());
    const invitations = parseInvitationLogins(
      await readGithubJson(invitationResponse),
    );
    if (
      invitations.some(
        (login) => login.toLowerCase() === githubLogin.toLowerCase(),
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

  async publishRepository(name: string): Promise<GithubRepositoryMetadata> {
    const response = await this.request(this.repositoryPath(name), {
      method: 'PATCH',
      body: JSON.stringify({ visibility: 'public' }),
    });
    await throwForGithubErrorResponse(response, this.now());
    return parseGithubRepository(await readGithubJson(response));
  }

  private repositoryPath(name: string): string {
    return `/repos/${encodeURIComponent(
      this.tokenProvider.organization,
    )}/${encodeURIComponent(name)}`;
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
