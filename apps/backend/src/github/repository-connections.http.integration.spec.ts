import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { AccountStatus, RepositoryConnectionMode } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { AuthConfig } from '../auth/auth.config';
import { sessionCookieName } from '../auth/cookies';
import { OriginGuard } from '../auth/origin.guard';
import { issueSessionToken } from '../auth/session-token';
import { SessionGuard } from '../auth/session.guard';
import { AuthService } from '../auth/auth.service';
import { DomainException } from '../common/error-code';
import { ProblemDetailFilter } from '../common/problem-detail.filter';
import { PrismaService } from '../prisma/prisma.service';
import { RepositoriesController } from './controller/repositories.controller';
import {
  REPOSITORY_CONNECTIONS_ERROR_CODES,
  RepositoryConnectionsErrorCode,
} from './repository-connections-error-code';
import { RepositoriesService } from './service/repositories.service';
import { RepositoryConnectionsService } from './service/repository-connections.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const allowedOrigin = 'http://frontend.test';
const sessionSecret = new Uint8Array(32).fill(9);
const APPLICATION_ID = 'synthetic-connection-http-application';
const INSTANCE = `/api/v1/repositories/${APPLICATION_ID}/connection`;
const changeConnection = jest.fn();
const findUnique = jest.fn();
let application: INestApplication | undefined;
let baseUrl = '';

async function patchConnection(
  cookie: string | null,
  body: unknown,
  origin: string | null = allowedOrigin,
): Promise<Response> {
  return fetch(`${baseUrl}${INSTANCE}`, {
    method: 'PATCH',
    headers: {
      connection: 'close',
      'content-type': 'application/json',
      ...(origin === null ? {} : { origin }),
      ...(cookie === null ? {} : { cookie }),
    },
    body: JSON.stringify(body),
  });
}

async function sessionCookieFor(githubId: bigint): Promise<string> {
  const token = await issueSessionToken(sessionSecret, githubId, 0);
  return `${sessionCookieName(false)}=${token}`;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [RepositoriesController],
    providers: [
      { provide: RepositoriesService, useValue: {} },
      { provide: RepositoryConnectionsService, useValue: { changeConnection } },
      SessionGuard,
      OriginGuard,
      {
        provide: AuthService,
        useValue: {
          getMe: jest
            .fn()
            .mockResolvedValue({ id: 'synthetic-user', sessionVersion: 0 }),
        },
      },
      {
        provide: AuthConfig,
        useValue: { sessionSecret, allowedOrigin, useSecureCookies: false },
      },
      { provide: PrismaService, useValue: { user: { findUnique } } },
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
});

beforeEach(() => {
  changeConnection.mockReset();
  findUnique.mockReset();
  findUnique.mockResolvedValue({
    id: 'synthetic-user',
    accountStatus: AccountStatus.ACTIVE,
    sessionVersion: 0,
  });
});

afterAll(async () => {
  await application?.close();
});

it('returns 200 PENDING with the unchanged current tuple and strips persistence internals', async () => {
  changeConnection.mockResolvedValue({
    status: 'PENDING',
    applicationId: APPLICATION_ID,
    repositoryId: 'synthetic-current-repository',
    connectionMode: RepositoryConnectionMode.OWN,
    repositoryUrl: 'https://github.com/synthetic-owner/current',
    applicantGithubId: 123n,
    changed: true,
  });

  const response = await patchConnection(await sessionCookieFor(7_001n), {
    mode: RepositoryConnectionMode.NEW,
  });

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    status: 'PENDING',
    applicationId: APPLICATION_ID,
    repositoryId: 'synthetic-current-repository',
    connectionMode: RepositoryConnectionMode.OWN,
    repositoryUrl: 'https://github.com/synthetic-owner/current',
  });
  expect(changeConnection.mock.calls).toEqual([
    [
      {
        applicationId: APPLICATION_ID,
        actorGithubId: 7_001n,
        mode: RepositoryConnectionMode.NEW,
        url: null,
      },
    ],
  ]);
});

it.each([
  [RepositoryConnectionsErrorCode.FORBIDDEN, 403],
  [RepositoryConnectionsErrorCode.NOT_FOUND, 404],
  [RepositoryConnectionsErrorCode.CLAIM_CONFLICT, 409],
  [RepositoryConnectionsErrorCode.INVALID_TARGET, 422],
] as const)('projects %s as RFC7807 status %s', async (code, status) => {
  changeConnection.mockRejectedValue(
    new DomainException(REPOSITORY_CONNECTIONS_ERROR_CODES[code]),
  );

  const response = await patchConnection(await sessionCookieFor(7_002n), {
    mode: RepositoryConnectionMode.OWN,
    url: 'https://github.com/synthetic-owner/repository',
  });

  expect(response.status).toBe(status);
  expect(response.headers.get('content-type')).toContain(
    'application/problem+json',
  );
  await expect(response.json()).resolves.toMatchObject({
    status,
    code,
    instance: INSTANCE,
  });
});

it('runs DTO cross-field validation before the service', async () => {
  const response = await patchConnection(await sessionCookieFor(7_003n), {
    mode: RepositoryConnectionMode.OWN,
  });

  expect(response.status).toBe(400);
  expect(changeConnection.mock.calls).toHaveLength(0);
});

it('requires a valid session and allowed origin', async () => {
  const missingSession = await patchConnection(null, {
    mode: RepositoryConnectionMode.NEW,
  });
  expect(missingSession.status).toBe(401);

  const badOrigin = await patchConnection(
    await sessionCookieFor(7_004n),
    { mode: RepositoryConnectionMode.NEW },
    'http://attacker.test',
  );
  expect(badOrigin.status).toBe(403);
  expect(changeConnection.mock.calls).toHaveLength(0);
});
