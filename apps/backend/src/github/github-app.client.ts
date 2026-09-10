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
  parseGithubPublicRepository,
  parseGithubRepository,
  parseRepositoryInvitations,
  readGithubJson,
  throwForGithubErrorResponse,
} from './github-app.response';
import type {
  GithubPublicRepositoryMetadata,
  GithubRepositoryInvitation,
  GithubRepositoryMetadata,
} from './github-app.response';

const GITHUB_API_BASE_URL = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';
const USER_AGENT = 'oss-hub-backend';
const REQUEST_TIMEOUT_MS = 10_000;
const INVITATION_PAGE_SIZE = 100;
const INVITATION_PAGE_LIMIT = 50;
export type {
  GithubPublicRepositoryMetadata,
  GithubRepositoryInvitation,
  GithubRepositoryMetadata,
} from './github-app.response';

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
  /**
   * 조직 밖 공개 저장소 조회. installation token은 범위 밖이라 인증 없이
   * 공개 REST만 쓴다(ADR-009). 비공개·미존재는 404 → null.
   */
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

  /**
   * platform이 부여한 직접 collaborator 권한만 회수한다. 열린 invitation을 먼저
   * 취소하고 collaborator를 삭제해, 두 호출 사이에 수락된 초대도 제거된다.
   * org owner·staff의 조직 상속 접근은 이 adapter의 권한 밖이라 건드리지 않는다.
   * NEW managed repository 전용이며 OWN 저장소에는 호출하지 않는다.
   */
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
      // 404는 조회와 취소 사이에 수락·취소된 초대다. 수락되었다면 이어지는
      // collaborator 삭제가 실제 권한을 회수한다.
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
      // 404는 collaborator 부재일 수도, 저장소 소실·권한 상실일 수도 있다.
      // 저장소 접근을 확인하기 전에는 회수 성공으로 기록하지 않는다.
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

  /**
   * 열린 invitation 전체 목록을 모으거나 실패한다. 어느 page가든 404는
   * 저장소 소실 또는 invitation 읽기 권한 상실이다. metadata가 보인다는 사실은
   * invitation 권한을 증명하지 않고, 뒤쪽 page의 404는 취소 대상을 조용히
   * 잘라낸다. 부분 목록을 돌려주지 않고 정규화한 오류로 중단한다.
   */
  private async listInvitations(
    repositoryPath: string,
  ): Promise<readonly GithubRepositoryInvitation[]> {
    const invitations: GithubRepositoryInvitation[] = [];
    for (let page = 1; page <= INVITATION_PAGE_LIMIT; page += 1) {
      const response = await this.request(
        `${repositoryPath}/invitations?per_page=${INVITATION_PAGE_SIZE}&page=${page}`,
      );
      await throwForGithubErrorResponse(response, this.now());
      const parsed = parseRepositoryInvitations(await readGithubJson(response));
      invitations.push(...parsed);
      if (parsed.length < INVITATION_PAGE_SIZE) {
        return invitations;
      }
    }
    // page 상한을 넘기면 목록이 잘렸을 수 있어 완료로 기록하지 않는다.
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
