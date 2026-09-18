import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AccountStatus } from '@prisma/client';
import { AuthenticationGuard } from '../auth/authentication.guard';
import { AuthConfig } from '../auth/auth.config';
import { AuthService } from '../auth/auth.service';
import { sessionCookieName } from '../auth/cookies';
import { issueSessionToken } from '../auth/session-token';
import { DomainException } from '../common/error-code';
import { ProblemDetailFilter } from '../common/problem-detail.filter';
import { ProgramAuthoringRepository } from './program-authoring.repository';
import { PROGRAM_NOTICE_ERRORS } from './program-notice-error-code';
import { ProgramNoticeFetchClient } from './program-notice-fetch.client';
import { ProgramNoticePreviewController } from './program-notice-preview.controller';
import { ProgramNoticePreviewService } from './program-notice-preview.service';

const source = 'https://sojoong.kr/notice/notice-board/?uid=123&mod=document';
const secret = new Uint8Array(32).fill(42);
const actor = {
  id: 'synthetic-author',
  accountStatus: AccountStatus.ACTIVE,
  hasStaffAccess: true,
  hasAdminAccess: false,
};
const findActor = jest.fn(() => Promise.resolve(actor));
const read = jest.fn(() =>
  Promise.resolve(
    '<div class="kboard-title"><h1>Synthetic</h1></div><div class="kboard-content"><div class="content-view"><p>One</p><p>Two</p></div></div>',
  ),
);
let application: INestApplication;
let origin = '';
let cookie = '';

beforeAll(async () => {
  const module = await Test.createTestingModule({
    controllers: [ProgramNoticePreviewController],
    providers: [
      { provide: APP_GUARD, useClass: AuthenticationGuard },
      {
        provide: AuthConfig,
        useValue: {
          useSecureCookies: false,
          sessionSecret: secret,
          allowedOrigin: 'https://frontend.example',
        },
      },
      {
        provide: AuthService,
        useValue: {
          getMe: () =>
            Promise.resolve({
              ...actor,
              githubId: 101n,
              nickname: 'synthetic',
              name: null,
              avatarUrl: null,
              sessionVersion: 1,
              memberKind: null,
              isProfileComplete: true,
            }),
        },
      },
      { provide: ProgramAuthoringRepository, useValue: { findActor } },
      { provide: ProgramNoticeFetchClient, useValue: { read } },
      ProgramNoticePreviewService,
    ],
  }).compile();
  application = module.createNestApplication();
  application.setGlobalPrefix('api/v1');
  application.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true }),
  );
  application.useGlobalFilters(new ProblemDetailFilter());
  await application.listen(0, '127.0.0.1');
  origin = await application.getUrl();
  cookie = `${sessionCookieName(false)}=${await issueSessionToken(secret, 101n, 1)}`;
});
afterAll(() => application.close());
beforeEach(() => {
  jest.clearAllMocks();
  findActor.mockResolvedValue(actor);
});
function preview(
  body: object,
  authenticated = true,
  requestOrigin = 'https://frontend.example',
): Promise<Response> {
  return fetch(`${origin}/api/v1/program-authoring/notice-preview`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: requestOrigin,
      ...(authenticated ? { cookie } : {}),
      connection: 'close',
    },
    body: JSON.stringify(body),
  });
}

it('runs the actual session and origin guards and returns a no-store plain-text preview', async () => {
  const response = await preview({ url: source });
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(await response.json()).toEqual({
    sourceUrl: source,
    name: 'Synthetic',
    description: 'One\nTwo',
    coverImages: [],
    warnings: ['NO_IMAGE'],
  });
});
it('rejects anonymous requests before actor or upstream access', async () => {
  expect((await preview({ url: source }, false)).status).toBe(401);
  expect(findActor).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
});
it('rejects cross-origin requests before upstream access', async () => {
  expect(
    (await preview({ url: source }, true, 'https://untrusted.example')).status,
  ).toBe(403);
  expect(read).not.toHaveBeenCalled();
});
it('rejects student-only authoring before upstream access', async () => {
  findActor.mockResolvedValueOnce({ ...actor, hasStaffAccess: false });
  expect((await preview({ url: source })).status).toBe(409);
  expect(read).not.toHaveBeenCalled();
});
it.each([
  {},
  { url: 12 },
  { url: 'https://untrusted.example' },
  { url: 'x'.repeat(2049) },
])('rejects malformed request %j without upstream access', async (body) => {
  expect((await preview(body)).status).toBe(400);
  expect(read).not.toHaveBeenCalled();
});
it('returns a stable source failure without leaking upstream details', async () => {
  read.mockRejectedValueOnce(
    new DomainException(PROGRAM_NOTICE_ERRORS.FETCH_FAILED),
  );
  const response = await preview({ url: source });
  expect(response.status).toBe(502);
  expect(await response.json()).toMatchObject({
    code: 'PROGRAM_NOTICE_FETCH_FAILED',
  });
});
