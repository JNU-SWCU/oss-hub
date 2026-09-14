import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthConfig } from '../auth/auth.config';
import { AuthService } from '../auth/auth.service';
import { OriginGuard } from '../auth/origin.guard';
import { SessionGuard } from '../auth/session.guard';
import { issueSessionToken } from '../auth/session-token';
import { sessionCookieName } from '../auth/cookies';
import { ProblemDetailFilter } from '../common/problem-detail.filter';
import { StudentRepositoryUrlController } from './student-repository-url.controller';
import { StudentRepositoryUrlService } from './student-repository-url.service';

const secret = new Uint8Array(32).fill(8);
const origin = 'http://frontend.test';
const updateMine = jest.fn().mockResolvedValue({
  repositoryUrl: 'https://github.com/example/project',
  canEditRepositoryUrl: true,
});
let app: INestApplication;
let baseUrl: string;
let cookie: string;

beforeAll(async () => {
  const module = await Test.createTestingModule({
    controllers: [StudentRepositoryUrlController],
    providers: [
      { provide: StudentRepositoryUrlService, useValue: { updateMine } },
      SessionGuard,
      OriginGuard,
      {
        provide: AuthService,
        useValue: {
          getMe: jest
            .fn()
            .mockResolvedValue({ id: 'student', sessionVersion: 0 }),
        },
      },
      {
        provide: AuthConfig,
        useValue: {
          sessionSecret: secret,
          allowedOrigin: origin,
          useSecureCookies: false,
        },
      },
    ],
  }).compile();
  app = module.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new ProblemDetailFilter());
  await app.listen(0, '127.0.0.1');
  baseUrl = await app.getUrl();
  cookie = `${sessionCookieName(false)}=${await issueSessionToken(secret, 1133n, 0)}`;
});
afterAll(async () => {
  await app?.close();
});
beforeEach(() => updateMine.mockClear());

async function patch(body: object, headers: Record<string, string> = {}) {
  return fetch(
    `${baseUrl}/api/v1/programs/program/applications/me/repository-url`,
    {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        connection: 'close',
        origin,
        cookie,
        ...headers,
      },
      body: JSON.stringify(body),
    },
  );
}

it('accepts and trims the dedicated repository URL request', async () => {
  const response = await patch({
    repositoryUrl: ' https://github.com/example/project ',
    reason: ' Project moved ',
  });
  expect(response.status).toBe(200);
  expect(updateMine).toHaveBeenCalledWith(1133n, 'program', {
    repositoryUrl: 'https://github.com/example/project',
    reason: 'Project moved',
  });
});
it.each(['\n', '\r', '\r\n'])(
  'accepts multiline reasons with %j line endings without changing their content',
  async (ending) => {
    // Given
    const reason = `Moved repository${ending}Preserve project history`;
    // When
    const response = await patch({
      repositoryUrl: 'https://github.com/example/project',
      reason: ` \r\n${reason}\r\n `,
    });
    // Then
    expect(response.status).toBe(200);
    expect(updateMine).toHaveBeenCalledWith(1133n, 'program', {
      repositoryUrl: 'https://github.com/example/project',
      reason,
    });
  },
);
it.each(['', ' ', '\r\n', 'x'.repeat(501)])(
  'rejects invalid reason %s before mutation',
  async (reason) => {
    const response = await patch({
      repositoryUrl: 'https://github.com/example/project',
      reason,
    });
    expect(response.status).toBe(400);
    expect(updateMine).not.toHaveBeenCalled();
  },
);
it.each(
  Array.from({ length: 33 }, (_, index) => (index === 32 ? 127 : index)).filter(
    (code) => code !== 10 && code !== 13,
  ),
)('rejects embedded control character %i before mutation', async (code) => {
  // Given
  const reason = `Moved${String.fromCharCode(code)}repository`;
  // When
  const response = await patch({
    repositoryUrl: 'https://github.com/example/project',
    reason,
  });
  // Then
  expect(response.status).toBe(400);
  expect(updateMine).not.toHaveBeenCalled();
});
it.each(['x', `${'x'.repeat(498)}\ny`])(
  'accepts a trimmed reason at the length boundaries (%s)',
  async (reason) => {
    // Given / When
    const response = await patch({
      repositoryUrl: 'https://github.com/example/project',
      reason: ` ${reason} `,
    });
    // Then
    expect(response.status).toBe(200);
    expect(updateMine).toHaveBeenCalledWith(1133n, 'program', {
      repositoryUrl: 'https://github.com/example/project',
      reason,
    });
  },
);
it.each([
  'https://github.com/example/project.git',
  'https://github.com/example/project/issues',
  'https://github.com/example/project?q=1',
])('rejects invalid repository URL %s', async (repositoryUrl) => {
  const response = await patch({ repositoryUrl, reason: 'Moved' });
  expect(response.status).toBe(400);
  expect(updateMine).not.toHaveBeenCalled();
});
it('requires a session', async () => {
  const response = await patch(
    { repositoryUrl: 'https://github.com/example/project', reason: 'Moved' },
    { cookie: '' },
  );
  expect(response.status).toBe(401);
  expect(updateMine).not.toHaveBeenCalled();
});
it('requires a permitted origin', async () => {
  const response = await patch(
    { repositoryUrl: 'https://github.com/example/project', reason: 'Moved' },
    { origin: 'http://foreign.test' },
  );
  expect(response.status).toBe(403);
  expect(updateMine).not.toHaveBeenCalled();
});
