import { randomBytes } from 'node:crypto';
import { AccountStatus, Role } from '@prisma/client';
import { DomainException } from '../common/error-code';
import { AuthErrorCode } from './auth-error-code.enum';
import { AuthConfig } from './auth.config';
import type { AuthRepository, AuthTransactionStore } from './auth.repository';
import { AuthService } from './auth.service';
import type { AuthUser } from './domain/auth-user';
import { createFlowState, encodeFlowCookie } from './oauth-flow';

// 합성 데이터만 사용한다 (docs/rules/security.md)
const syntheticUser: AuthUser = {
  id: 'cuid-synthetic',
  githubId: 424242n,
  login: 'synthetic-login',
  name: null,
  avatarUrl: null,
  accountStatus: AccountStatus.ACTIVE,
  role: null,
};

function buildConfig(): AuthConfig {
  process.env.GITHUB_OAUTH_CLIENT_ID = 'synthetic-client-id';
  process.env.GITHUB_OAUTH_CLIENT_SECRET = 'synthetic-client-secret';
  process.env.SESSION_SECRET = randomBytes(32).toString('base64url');
  const config = new AuthConfig();
  delete process.env.GITHUB_OAUTH_CLIENT_ID;
  delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
  delete process.env.SESSION_SECRET;
  return config;
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
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    upsertUser.mockResolvedValue({ user: syntheticUser, isNew: true });
    service = new AuthService(buildConfig(), repository);
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('authorize redirect에 PKCE·state 파라미터가 전부 들어간다', () => {
    const redirect = service.buildAuthorizeRedirect();
    const url = new URL(redirect.url);
    expect(url.origin + url.pathname).toBe(
      'https://github.com/login/oauth/authorize',
    );
    expect(url.searchParams.get('client_id')).toBe('synthetic-client-id');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );
    expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // flow 쿠키의 state와 authorize URL의 state가 같은 쌍이어야 한다
    expect(redirect.flowCookieValue.split('.')[0]).toBe(
      url.searchParams.get('state'),
    );
  });

  it('happy path: code 교환 → 프로필 조회 → upsert, 토큰은 반환값에 없다', async () => {
    const flow = createFlowState();
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, { access_token: 'synthetic-token' }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { id: 424242, login: 'synthetic-login', name: null }),
      );

    const login = await service.completeLogin({
      code: 'synthetic-code',
      state: flow.state,
      flowCookie: encodeFlowCookie(flow),
    });

    expect(login).toEqual({ user: syntheticUser, isNew: true });
    expect(upsertUser).toHaveBeenCalledWith({
      githubId: 424242n,
      login: 'synthetic-login',
      name: null,
      avatarUrl: null,
    });
    expect(withTransaction).toHaveBeenCalledTimes(1);
    // code 교환 요청에 verifier가 포함됐는지
    const [, exchangeInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const exchangeBody = JSON.parse(exchangeInit.body as string) as Record<
      string,
      string
    >;
    expect(exchangeBody.code_verifier).toBe(flow.verifier);
  });

  it.each([
    ['flow 쿠키 없음', undefined, 'any-state'],
    ['state 불일치', encodeFlowCookie(createFlowState()), 'x'.repeat(43)],
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
    const flow = createFlowState();
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { error: 'bad_code' }));
    await expect(
      service.completeLogin({
        code: 'expired',
        state: flow.state,
        flowCookie: encodeFlowCookie(flow),
      }),
    ).rejects.toThrow('access_token');
    expect(withTransaction).not.toHaveBeenCalled();
    expect(upsertUser).not.toHaveBeenCalled();
  });

  it('getMe: 사용자 없으면 AUT_003', async () => {
    findByGithubId.mockResolvedValueOnce(null);
    await expect(service.getMe(1n)).rejects.toBeInstanceOf(DomainException);
  });

  it('비활성 계정은 기존 세션 조회와 새 세션 발급을 모두 AUT_003으로 거부한다', async () => {
    const deactivatedUser: AuthUser = {
      ...syntheticUser,
      role: Role.STAFF,
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
