import { type LoginHistoryPage, type AuthUser } from './http-auth.types';
import { LOGIN_HISTORY_EVENTS, AuthConfig } from './auth.config';
import {
  LoginHistoryRepository,
  type AuthRepository,
  type AuthTransactionStore,
} from './auth.repository';
import { LoginHistoryService, AuthService } from './auth.service';
import { AccountStatus, ActivityVisibility, MemberKind } from '@prisma/client';
import { decodeJwt } from 'jose';
import { DomainException } from '../platform/error-code.error';
import { loadRuntimeConfig } from '../platform/runtime-config.config';
import { AuthErrorCode } from './auth-error-code.error';
import { UserProfileService } from '../platform/user-profile.service';
import { AuthSessionService } from './auth-session.service';
import { Logger } from '@nestjs/common';
import { CollectionUserActivityRepository } from '../github/repository-provision-job.repository';
import { CollectionPublicTokenService } from '../github/collection-providers.service';
import { CollectionUserActivityService } from '../github/collection-user-activity.service';
import { CollectionDiscoveryClient } from '../github/collection-discovery.client';
import { PrismaService } from '../platform/prisma.service';
import { Test } from '@nestjs/testing';
import { PlatformModule } from '../platform/platform.module';
import { AuthModule } from './auth.module';

const authSessionService = new AuthSessionService();

describe('login-history.service', () => {
  const emptyPage: LoginHistoryPage = {
    items: [],
    page: 1,
    size: 20,
    total: 0,
  };

  describe('LoginHistoryService', () => {
    const create = jest.fn();
    const findPage = jest.fn();
    const service = new LoginHistoryService({
      create,
      findPage,
    } as unknown as LoginHistoryRepository);

    beforeEach(() => {
      create.mockReset();
      create.mockResolvedValue(undefined);
      findPage.mockReset();
      findPage.mockResolvedValue(emptyPage);
    });

    it('로그인 성공을 GitHub provider의 LOGIN 이벤트로 기록한다', async () => {
      await service.recordLogin('synthetic-user-id');

      expect(create).toHaveBeenCalledWith(
        'synthetic-user-id',
        LOGIN_HISTORY_EVENTS.LOGIN,
      );
    });

    it('로그아웃을 LOGOUT 이벤트로 기록한다', async () => {
      await service.recordLogout('synthetic-user-id');

      expect(create).toHaveBeenCalledWith(
        'synthetic-user-id',
        LOGIN_HISTORY_EVENTS.LOGOUT,
      );
    });

    it('본인 이력 조회의 페이지 조건을 저장소에 전달한다', async () => {
      const result = await service.findMine('synthetic-user-id', 2, 10);

      expect(findPage).toHaveBeenCalledWith('synthetic-user-id', 2, 10);
      expect(result).toBe(emptyPage);
    });
  });
});

const syntheticUser: AuthUser = {
  id: 'cuid-synthetic',
  githubId: 424242n,
  nickname: 'synthetic-login',
  name: null,
  avatarUrl: null,
  accountStatus: AccountStatus.ACTIVE,
  sessionVersion: 7,
  memberKind: null,
  hasStaffAccess: false,
  hasAdminAccess: false,
  isProfileComplete: false,
};

function buildConfig(): AuthConfig {
  return new AuthConfig(
    loadRuntimeConfig({
      SESSION_SECRET: Buffer.from(
        'synthetic-auth-service-session-secret',
      ).toString('base64url'),
      FRONTEND_URL: 'http://localhost:3000',
      GITHUB_OAUTH_CLIENT_ID: 'synthetic-client-id',
      GITHUB_OAUTH_CLIENT_SECRET: 'synthetic-client-secret',
    }),
  );
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

describe('AuthService', () => {
  const upsertUser = jest.fn();
  const withTransaction = jest
    .fn()
    .mockImplementation(
      (operation: (store: AuthTransactionStore) => Promise<unknown>) =>
        operation({ upsertUser }),
    );
  const findByGithubId = jest.fn();
  const repository = {
    withTransaction,
    findByGithubId,
  } as unknown as AuthRepository;
  let service: AuthService;
  let fetchMock: jest.SpyInstance<Promise<Response>, Parameters<typeof fetch>>;
  let activityDb: PrismaService;

  beforeEach(() => {
    jest.clearAllMocks();
    upsertUser.mockResolvedValue({ user: syntheticUser, isNew: true });
    fetchMock = jest.spyOn(globalThis, 'fetch');
    activityDb = new PrismaService();
    const publicTokens = new CollectionPublicTokenService(loadRuntimeConfig({}));
    service = new AuthService(
      buildConfig(),
      repository,
      new UserProfileService(),
      new AuthSessionService(),
      new CollectionUserActivityService(
        new CollectionUserActivityRepository(activityDb),
        new CollectionDiscoveryClient({}, publicTokens),
      ),
    );
  });

  afterEach(async () => {
    fetchMock.mockRestore();
    await activityDb.$disconnect();
  });

  it('인증 모듈이 비공개 수집 의존성을 실제로 조립한다', async () => {
    const module = await Test.createTestingModule({
      imports: [PlatformModule, AuthModule],
    })
      .overrideProvider(AuthConfig)
      .useValue(buildConfig())
      .compile();

    try {
      expect(module.get(AuthService)).toBeInstanceOf(AuthService);
      expect(module.get(CollectionUserActivityService)).toBeInstanceOf(
        CollectionUserActivityService,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await module.close();
    }
  });

  it('authorize redirect에 PKCE·state 파라미터가 전부 들어간다', () => {
    const redirect = service.buildAuthorizeRedirect();
    const url = new URL(redirect.url);
    expect(url.origin + url.pathname).toBe(
      'https://github.com/login/oauth/authorize',
    );
    expect(url.searchParams.get('client_id')).toBe('synthetic-client-id');
    expect(url.searchParams.get('scope')).toBe('read:user user:email');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );
    expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);

    expect(redirect.flowCookieValue.split('.')[0]).toBe(
      url.searchParams.get('state'),
    );
  });

  it('happy path: code 교환 → 프로필·이메일 조회 → upsert, 토큰은 반환값에 없다', async () => {
    const observePrivate = jest
      .spyOn(CollectionUserActivityService.prototype, 'observePrivate')
      .mockResolvedValue(undefined);
    const flow = authSessionService.createFlowState();
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, { access_token: 'synthetic-token' }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { id: 424242, login: 'synthetic-login', name: null }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, [
          {
            email: 'primary@example.com',
            primary: true,
            verified: true,
          },
        ]),
      );

    const login = await service.completeLogin({
      code: 'synthetic-code',
      state: flow.state,
      flowCookie: authSessionService.encodeFlowCookie(flow),
    });

    expect(login).toEqual({ user: syntheticUser, isNew: true });
    expect(upsertUser).toHaveBeenCalledWith({
      githubId: 424242n,
      login: 'synthetic-login',
      name: null,
      avatarUrl: null,
      email: 'primary@example.com',
    });
    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const emailCall = fetchMock.mock.calls[2] as
      [string, RequestInit] | undefined;
    expect(emailCall?.[0]).toBe('https://api.github.com/user/emails');

    const [, exchangeInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const exchangeBody = JSON.parse(exchangeInit.body as string) as Record<
      string,
      string
    >;
    expect(exchangeBody.code_verifier).toBe(flow.verifier);
    observePrivate.mockRestore();
  });

  it.each([
    ['flow 쿠키 없음', undefined, 'any-state'],
    [
      'state 불일치',
      authSessionService.encodeFlowCookie(authSessionService.createFlowState()),
      'x'.repeat(43),
    ],
    ['형식 위반 쿠키', 'malformed-cookie', 'x'.repeat(43)],
  ])(
    '%s이면 AUT_001로 거부하고 GitHub를 호출하지 않는다',
    async (_label, flowCookie, state) => {
      await expect(
        service.completeLogin({ code: 'c', state, flowCookie }),
      ).rejects.toMatchObject({
        errorCode: { code: AuthErrorCode.OAUTH_FLOW_INVALID },
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(withTransaction).not.toHaveBeenCalled();
      expect(upsertUser).not.toHaveBeenCalled();
    },
  );

  it('code 교환 응답에 access_token이 없으면 실패한다 (DB 쓰기 없음)', async () => {
    const flow = authSessionService.createFlowState();
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { error: 'bad_code' }));
    await expect(
      service.completeLogin({
        code: 'expired',
        state: flow.state,
        flowCookie: authSessionService.encodeFlowCookie(flow),
      }),
    ).rejects.toThrow('access_token');
    expect(withTransaction).not.toHaveBeenCalled();
    expect(upsertUser).not.toHaveBeenCalled();
  });

  describe('로그인 후 비공개 기여', () => {
    const token = 'synthetic-private-access-token';
    const observedAt = new Date('2026-12-31T15:00:01.000Z');
    let privateUpsert: jest.SpyInstance;
    let databaseUpsert: jest.SpyInstance;
    let warn: jest.SpyInstance;
    let otherLogs: jest.SpyInstance[];

    const flushPromises = () =>
      new Promise<void>((resolve) => setImmediate(resolve));
    const metricsResponse = (own: boolean) =>
      jsonResponse(200, {
        data: {
          user: {
            contributionsCollection: {
              totalCommitContributions: own ? 19194 : 10655,
              totalPullRequestContributions: own ? 40 : 12,
              totalIssueContributions: own ? 3 : 5,
              totalRepositoryContributions: own ? 9 : 4,
            },
            repositories: {
              nodes: [{ stargazerCount: own ? 99 : 10 }],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      });

    function prepareLogin() {
      const flow = authSessionService.createFlowState();
      fetchMock
        .mockResolvedValueOnce(jsonResponse(200, { access_token: token }))
        .mockResolvedValueOnce(
          jsonResponse(200, { id: 424242, login: 'synthetic-login' }),
        )
        .mockResolvedValueOnce(jsonResponse(200, []));
      return {
        code: 'synthetic-code',
        state: flow.state,
        flowCookie: authSessionService.encodeFlowCookie(flow),
      };
    }

    function expectNoTokenInRepositoriesOrLogs() {
      const calls: unknown = [
        withTransaction.mock.calls,
        upsertUser.mock.calls,
        findByGithubId.mock.calls,
        privateUpsert.mock.calls,
        databaseUpsert.mock.calls,
        warn.mock.calls,
        otherLogs.map((logger): unknown => logger.mock.calls),
      ];
      const serialized = JSON.stringify(calls, (_key, value: unknown) =>
        typeof value === 'bigint' ? value.toString() : value,
      );
      expect(serialized).not.toContain(token);
    }

    beforeEach(() => {
      jest.useFakeTimers({
        now: observedAt,
        doNotFake: ['setImmediate', 'nextTick'],
      });
      privateUpsert = jest.spyOn(
        CollectionUserActivityRepository.prototype,
        'upsertPrivateObservation',
      );
      databaseUpsert = jest
        .spyOn(activityDb.githubUserActivityHistory, 'upsert')
        .mockResolvedValue({
          githubId: 424242n,
          githubLogin: 'synthetic-login',
          year: 2027,
          visibility: ActivityVisibility.PRIVATE,
          commitCount: 8539,
          pullRequestCount: 28,
          issueCount: 0,
          repositoryCount: 5,
          starCount: 0,
          observedAt,
        });
      jest
        .spyOn(CollectionPublicTokenService.prototype, 'getToken')
        .mockResolvedValue('synthetic-service-token');
      warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
      otherLogs = (['log', 'error', 'debug', 'verbose', 'fatal'] as const).map(
        (method) => jest.spyOn(Logger.prototype, method).mockImplementation(() => {}),
      );
    });

    afterEach(async () => {
      await flushPromises();
      jest.useRealTimers();
      jest.restoreAllMocks();
    });

    it('동일한 서울 연도 구간을 조회해 필드별 차이를 PRIVATE으로 저장한다', async () => {
      const input = prepareLogin();
      fetchMock.mockImplementation((_url, init) => {
        expect(upsertUser).toHaveBeenCalledTimes(1);
        return Promise.resolve(
          metricsResponse(
            new Headers(init?.headers).get('Authorization') === `Bearer ${token}`,
          ),
        );
      });

      const login = await service.completeLogin(input);
      await flushPromises();

      expect(login).toEqual({ user: syntheticUser, isNew: true });
      expect(privateUpsert).toHaveBeenCalledTimes(1);
      expect(privateUpsert).toHaveBeenCalledWith({
        githubId: 424242n,
        githubLogin: 'synthetic-login',
        year: 2027,
        commitCount: 8539,
        pullRequestCount: 28,
        issueCount: 0,
        repositoryCount: 5,
        starCount: 0,
        observedAt,
      });
      expect(databaseUpsert).toHaveBeenCalledTimes(1);
      expect(databaseUpsert).toHaveBeenCalledWith({
        where: {
          githubId_year_visibility: {
            githubId: 424242n,
            year: 2027,
            visibility: ActivityVisibility.PRIVATE,
          },
        },
        create: {
          githubId: 424242n,
          year: 2027,
          githubLogin: 'synthetic-login',
          visibility: ActivityVisibility.PRIVATE,
          commitCount: 8539,
          pullRequestCount: 28,
          issueCount: 0,
          repositoryCount: 5,
          starCount: 0,
          observedAt,
        },
        update: {
          githubLogin: 'synthetic-login',
          visibility: ActivityVisibility.PRIVATE,
          commitCount: 8539,
          pullRequestCount: 28,
          issueCount: 0,
          repositoryCount: 5,
          starCount: 0,
          observedAt,
        },
      });
      const graphqlCalls = fetchMock.mock.calls.slice(3);
      expect(graphqlCalls).toHaveLength(2);
      for (const [url, init] of graphqlCalls) {
        expect(url).toBe('https://api.github.com/graphql');
        if (typeof init?.body !== 'string') {
          throw new TypeError('Expected a GraphQL JSON request body');
        }
        expect(JSON.parse(init.body)).toMatchObject({
          variables: {
            login: 'synthetic-login',
            from: '2026-12-31T15:00:00.000Z',
            to: observedAt.toISOString(),
          },
        });
      }
      expect(warn).not.toHaveBeenCalled();
      expectNoTokenInRepositoriesOrLogs();
    });

    it.each([
      ['401', 'AUTH'],
      ['network', 'UPSTREAM'],
    ])('%s 오류에도 로그인은 성공하고 kind 경고만 한 번 기록한다', async (failure, kind) => {
      const input = prepareLogin();
      fetchMock.mockImplementation((_url, init) => {
        if (new Headers(init?.headers).get('Authorization') !== `Bearer ${token}`) {
          return Promise.resolve(metricsResponse(false));
        }
        if (failure === '401') return Promise.resolve(jsonResponse(401, { token }));
        return Promise.reject(new Error(`network response containing ${token}`));
      });

      const login = await service.completeLogin(input);
      await flushPromises();

      expect(login).toEqual({ user: syntheticUser, isNew: true });
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(5);
      expect(privateUpsert).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith({ kind });
      expectNoTokenInRepositoriesOrLogs();
    });

    it('저장 실패도 로그인에 전파하지 않고 오류 내용을 로그에 남기지 않는다', async () => {
      const input = prepareLogin();
      fetchMock.mockResolvedValue(metricsResponse(true));
      databaseUpsert.mockRejectedValue(new Error(`database failure ${token}`));

      const login = await service.completeLogin(input);
      await flushPromises();

      expect(login.user).toEqual(syntheticUser);
      expect(databaseUpsert).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith({ kind: 'UNKNOWN' });
      expectNoTokenInRepositoriesOrLogs();
    });

    it('GitHub 기여 조회가 미완료여도 로그인 응답을 반환한다', async () => {
      const input = prepareLogin();
      let finishQuery: (response: Response) => void = () => {
        throw new Error('query has not started');
      };
      const pendingQuery = new Promise<Response>((resolve) => {
        finishQuery = resolve;
      });
      fetchMock.mockReturnValue(pendingQuery);

      const login = await service.completeLogin(input);
      await flushPromises();

      expect(login.user).toEqual(syntheticUser);
      expect(fetchMock).toHaveBeenCalledTimes(5);
      expect(privateUpsert).not.toHaveBeenCalled();
      finishQuery(metricsResponse(true));
      await flushPromises();
      expect(privateUpsert).toHaveBeenCalledTimes(1);
      expectNoTokenInRepositoriesOrLogs();
    });
  });

  it('getMe는 DB의 현재 active 계정·권한을 principal로 반환한다', async () => {
    const staffUser: AuthUser = {
      ...syntheticUser,
      memberKind: 'STAFF',
      hasStaffAccess: true,
    };
    findByGithubId.mockResolvedValueOnce(staffUser);

    const principal = await service.getMe(staffUser.githubId);

    expect(principal).toEqual(staffUser);
    expect(principal.accountStatus).toBe(AccountStatus.ACTIVE);
  });

  it('새 세션은 persisted sessionVersion을 JWT에 싣는다', async () => {
    const token = await service.issueSession(syntheticUser);

    expect(decodeJwt(token).sessionVersion).toBe(syntheticUser.sessionVersion);
  });

  it('getMe: 사용자 없으면 AUT_003', async () => {
    findByGithubId.mockResolvedValueOnce(null);
    await expect(service.getMe(1n)).rejects.toBeInstanceOf(DomainException);
  });

  it('비활성 계정은 기존 세션 조회와 새 세션 발급을 모두 AUT_003으로 거부한다', async () => {
    const deactivatedUser: AuthUser = {
      ...syntheticUser,
      memberKind: MemberKind.STAFF,
      hasStaffAccess: true,
      accountStatus: AccountStatus.DEACTIVATED,
    };
    findByGithubId.mockResolvedValueOnce(deactivatedUser);

    await expect(service.getMe(deactivatedUser.githubId)).rejects.toMatchObject(
      { errorCode: { code: AuthErrorCode.UNAUTHENTICATED } },
    );
    await expect(service.issueSession(deactivatedUser)).rejects.toMatchObject({
      errorCode: { code: AuthErrorCode.UNAUTHENTICATED },
    });
  });
});
