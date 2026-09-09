import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LoginHistoryService } from '../login-history/login-history.service';
import { loadRuntimeConfig } from '../runtime-config/runtime-config';
import { AuthConfig } from './auth.config';
import { AuthController } from './auth.controller';
import { createResponse } from './auth.controller.spec.helpers';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { GithubLoginQueryRequestDto } from './dto/github-login-query.dto';
import { decodeFlowCookie, toCodeChallenge } from './oauth-flow';

describe('GitHub login account choice', () => {
  const validation = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  let service: AuthService;
  let controller: AuthController;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthService,
        {
          provide: AuthConfig,
          useValue: new AuthConfig(
            loadRuntimeConfig({
              SESSION_SECRET: Buffer.from(
                'synthetic-github-login-session-secret',
              ).toString('base64url'),
              FRONTEND_URL: 'https://oss.example',
              GITHUB_OAUTH_CLIENT_ID: 'synthetic-client-id',
              GITHUB_OAUTH_CLIENT_SECRET: 'synthetic-client-secret',
            }),
          ),
        },
        { provide: AuthRepository, useValue: {} },
        { provide: LoginHistoryService, useValue: {} },
      ],
    }).compile();
    service = module.get(AuthService);
    controller = module.get(AuthController);
  });

  afterEach(() => jest.restoreAllMocks());

  it.each([undefined, 'select_account'] as const)(
    '허용된 prompt %s를 로그인 요청에 전달하고 기존 flow cookie를 설정한다',
    async (prompt) => {
      const query: unknown = await validation.transform(
        prompt === undefined ? {} : { prompt },
        { type: 'query', metatype: GithubLoginQueryRequestDto },
      );
      const buildRedirect = jest.spyOn(service, 'buildAuthorizeRedirect');
      const res = createResponse();

      if (!(query instanceof GithubLoginQueryRequestDto)) {
        throw new Error('Expected parsed GitHub login query');
      }

      controller.startGithubLogin(query, res);

      expect(buildRedirect).toHaveBeenCalledWith(prompt);
      expect(res.setHeader).toHaveBeenCalledWith(
        'Set-Cookie',
        expect.stringMatching(
          /^__Host-oss_oauth_flow=.+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=600; Secure$/,
        ),
      );
      expect(res.redirect).toHaveBeenCalledWith(
        302,
        expect.stringContaining('https://github.com/login/oauth/authorize?'),
      );
    },
  );

  it.each([
    '',
    'login',
    'none',
    'consent',
    'SELECT_ACCOUNT',
    null,
    1,
    ['select_account'],
    { value: 'select_account' },
  ])('지원하지 않는 prompt %j는 요청 경계에서 거절한다', async (prompt) => {
    await expect(
      validation.transform(
        { prompt },
        { type: 'query', metatype: GithubLoginQueryRequestDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('임의 OAuth query를 전달할 수 없다', async () => {
    await expect(
      validation.transform(
        { prompt: 'select_account', scope: 'repo' },
        { type: 'query', metatype: GithubLoginQueryRequestDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([undefined, 'select_account'] as const)(
    'prompt %s의 authorize URL은 고정 callback·scope와 동일한 state·PKCE 쌍을 유지한다',
    (prompt) => {
      const redirect = service.buildAuthorizeRedirect(prompt);
      const url = new URL(redirect.url);
      const flow = decodeFlowCookie(redirect.flowCookieValue);

      expect(url.searchParams.get('prompt')).toBe(prompt ?? null);
      expect(url.searchParams.get('scope')).toBe('read:user user:email');
      expect(url.searchParams.get('redirect_uri')).toBe(
        'https://oss.example/api/v1/auth/github/callback',
      );
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(flow).not.toBeNull();
      if (flow === null) throw new Error('Expected valid synthetic flow');
      expect(url.searchParams.get('state')).toBe(flow.state);
      expect(url.searchParams.get('code_challenge')).toBe(
        toCodeChallenge(flow.verifier),
      );
    },
  );
});
