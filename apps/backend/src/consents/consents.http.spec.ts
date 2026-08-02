import { ValidationPipe } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthConfig } from '../auth/auth.config';
import { AuthService } from '../auth/auth.service';
import { OriginGuard } from '../auth/origin.guard';
import { issueSessionToken } from '../auth/session-token';
import { sessionCookieName } from '../auth/cookies';
import { SessionGuard } from '../auth/session.guard';
import { ProblemDetailFilter } from '../common/problem-detail.filter';
import { ConsentsController } from './consents.controller';
import { ConsentsRepository } from './consents.repository';
import { ConsentsService } from './consents.service';
import type { ConsentRecord, ConsentUser } from './domain/consent';

const expectedPolicyVersion = '2026-07-21';
const allowedOrigin = 'http://frontend.test';
const syntheticGithubId = 424242n;
const syntheticUserId = 'cuid-synthetic-http-user';
const consentedAt = new Date('2026-07-19T01:00:00.000Z');
const requiredItems = [
  'PRIVACY_COLLECTION',
  'GITHUB_ACTIVITY',
  'ORG_REPOSITORY_TERMS',
] as const;
const sessionSecret = new Uint8Array(32).fill(7);

const findUserByGithubId = jest
  .fn<Promise<ConsentUser | null>, [githubId: bigint]>()
  .mockResolvedValue({
    id: syntheticUserId,
    accountStatus: AccountStatus.ACTIVE,
  });
const findConsent = jest
  .fn<Promise<ConsentRecord | null>, [userId: string, policyVersion: string]>()
  .mockResolvedValue(null);
const createConsent = jest
  .fn<Promise<ConsentRecord>, [userId: string, policyVersion: string]>()
  .mockResolvedValue({ policyVersion: expectedPolicyVersion, consentedAt });

const repository = {
  findUserByGithubId,
  findConsent,
  createConsent,
} satisfies Pick<
  ConsentsRepository,
  'findUserByGithubId' | 'findConsent' | 'createConsent'
>;

interface ConsentRequestBody {
  readonly policyVersion: string;
  readonly acceptedItems: readonly string[];
  readonly programId?: string;
}

interface ProblemExpectation {
  readonly status: number;
  readonly code: string;
  readonly instance: string;
}

let application: INestApplication | undefined;
let baseUrl = '';
let sessionCookie = '';

async function readJson(response: Response): Promise<unknown> {
  const body: unknown = JSON.parse(await response.text());
  return body;
}

async function postConsent(
  body: ConsentRequestBody,
  origin = allowedOrigin,
): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/consents`, {
    method: 'POST',
    headers: {
      connection: 'close',
      'content-type': 'application/json',
      cookie: sessionCookie,
      origin,
    },
    body: JSON.stringify(body),
  });
}

async function expectProblemDetail(
  response: Response,
  expected: ProblemExpectation,
): Promise<void> {
  expect(response.status).toBe(expected.status);
  expect(response.headers.get('content-type')).toContain(
    'application/problem+json',
  );
  const problem = await readJson(response);
  expect(problem).toMatchObject({
    type: 'about:blank',
    status: expected.status,
    instance: expected.instance,
    code: expected.code,
  });
  expect(problem).toHaveProperty('title');
  expect(problem).toHaveProperty('detail');
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [ConsentsController],
    providers: [
      ConsentsService,
      SessionGuard,
      {
        provide: AuthService,
        useValue: {
          getMe: jest.fn().mockResolvedValue({ id: syntheticUserId }),
        },
      },
      OriginGuard,
      {
        provide: AuthConfig,
        useValue: {
          sessionSecret,
          allowedOrigin,
          useSecureCookies: false,
        },
      },
      { provide: ConsentsRepository, useValue: repository },
    ],
  }).compile();

  application = moduleRef.createNestApplication();
  application.setGlobalPrefix('api/v1');
  application.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  application.useGlobalFilters(new ProblemDetailFilter());
  await application.listen(0, '127.0.0.1');
  baseUrl = await application.getUrl();
  const token = await issueSessionToken(sessionSecret, syntheticGithubId);
  sessionCookie = `${sessionCookieName(false)}=${token}`;
  process.stdout.write(`issue99_http_listener=${baseUrl}\n`);
});

beforeEach(() => {
  jest.clearAllMocks();
});

afterAll(async () => {
  if (application !== undefined) {
    await application.close();
    process.stdout.write('issue99_http_cleanup=app-closed\n');
  }
});

it('returns 401 AUT_003 ProblemDetail for an unauthenticated GET', async () => {
  // Given: no session cookie.
  // When: the current-consent endpoint is requested over the real listener.
  const response = await fetch(`${baseUrl}/api/v1/consents/current`, {
    headers: { connection: 'close' },
  });

  // Then: the session boundary returns the auth ProblemDetail contract.
  await expectProblemDetail(response, {
    status: 401,
    code: 'AUT_003',
    instance: '/api/v1/consents/current',
  });
});

it('returns exact issue-99 metadata and URLs for an authenticated GET', async () => {
  // Given: a valid synthetic session with no current consent.
  // When: the current-consent endpoint is requested over the real listener.
  const response = await fetch(`${baseUrl}/api/v1/consents/current`, {
    headers: { connection: 'close', cookie: sessionCookie },
  });

  // Then: the response is the independent Issue #99 contract.
  expect(response.status).toBe(200);
  expect(await readJson(response)).toEqual({
    policyVersion: expectedPolicyVersion,
    requiredItems: [
      {
        key: 'PRIVACY_COLLECTION',
        label: '개인정보 수집·이용',
        documentUrl: '/policies/privacy/2026-07-21.html',
      },
      {
        key: 'GITHUB_ACTIVITY',
        label: 'GitHub 활동 수집·공개 범위',
        documentUrl: '/policies/github-activity/2026-07-21.html',
      },
      {
        key: 'ORG_REPOSITORY_TERMS',
        label: 'Org 저장소 운영 약관',
        documentUrl: '/policies/org-repository-terms/2026-07-21.html',
      },
    ],
    consented: false,
    nextUrl: '/onboarding/role',
  });
});

it('returns 200 and exact issue-99 metadata for a valid POST', async () => {
  // Given: the exact current policy version and accepted-item set.
  // When: consent is submitted over the real listener.
  const response = await postConsent({
    policyVersion: expectedPolicyVersion,
    acceptedItems: requiredItems,
  });

  // Then: the stored consent response matches the public contract.
  expect(response.status).toBe(200);
  expect(await readJson(response)).toEqual({
    policyVersion: expectedPolicyVersion,
    consentedAt: consentedAt.toISOString(),
    nextUrl: '/onboarding/role',
  });
  expect(createConsent).toHaveBeenCalledTimes(1);
});

it.each([
  {
    name: 'returns stale 409 CON_002 before validating accepted items',
    body: {
      policyVersion: '2025-12',
      acceptedItems: [...requiredItems, 'UNRELATED_KEY'],
    },
    origin: allowedOrigin,
    expected: { status: 409, code: 'CON_002' },
  },
  {
    name: 'returns 422 CON_003 for a non-exact accepted-item set',
    body: {
      policyVersion: expectedPolicyVersion,
      acceptedItems: [...requiredItems, 'UNRELATED_KEY'],
    },
    origin: allowedOrigin,
    expected: { status: 422, code: 'CON_003' },
  },
  {
    name: 'returns 403 AUT_002 for a disallowed Origin',
    body: {
      policyVersion: expectedPolicyVersion,
      acceptedItems: requiredItems,
    },
    origin: 'https://forbidden.invalid',
    expected: { status: 403, code: 'AUT_002' },
  },
  {
    name: 'returns 400 SYS_003 for an extra programId field',
    body: {
      policyVersion: expectedPolicyVersion,
      acceptedItems: requiredItems,
      programId: 'synthetic-program',
    },
    origin: allowedOrigin,
    expected: { status: 400, code: 'SYS_003' },
  },
] satisfies readonly {
  readonly name: string;
  readonly body: ConsentRequestBody;
  readonly origin: string;
  readonly expected: { readonly status: number; readonly code: string };
}[])('$name', async ({ body, origin, expected }) => {
  // Given: an authenticated request that is invalid at one boundary.
  // When: the request crosses the real HTTP pipeline.
  const response = await postConsent(body, origin);

  // Then: it is a ProblemDetail response and persistence is untouched.
  await expectProblemDetail(response, {
    ...expected,
    instance: '/api/v1/consents',
  });
  expect(createConsent).not.toHaveBeenCalled();
});
