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
const saved = {
  repositoryUrl: 'https://github.com/example/project',
  canEditRepositoryUrl: true,
};
const updateMine = jest.fn().mockResolvedValue(saved);
const updateForTeam = jest.fn().mockResolvedValue(saved);
let app: INestApplication;
let baseUrl: string;
let cookie: string;

beforeAll(async () => {
  const module = await Test.createTestingModule({
    controllers: [StudentRepositoryUrlController],
    providers: [
      {
        provide: StudentRepositoryUrlService,
        useValue: { updateMine, updateForTeam },
      },
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
beforeEach(() => {
  updateMine.mockClear();
  updateForTeam.mockClear();
});

// 두 문은 같은 DTO와 같은 가드를 지나 같은 service 경로로 들어간다.
describe.each([
  ['applications/me/repository-url', updateMine, ['program']],
  ['teams/team/repository-url', updateForTeam, ['program', 'team']],
] as const)('PATCH /programs/program/%s', (path, handler, params) => {
  async function patch(body: object, headers: Record<string, string> = {}) {
    return fetch(`${baseUrl}/api/v1/programs/program/${path}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        connection: 'close',
        origin,
        cookie,
        ...headers,
      },
      body: JSON.stringify(body),
    });
  }

  it('accepts and trims the dedicated repository URL request', async () => {
    const response = await patch({
      repositoryUrl: ' https://github.com/example/project ',
    });
    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledWith(1133n, ...params, {
      repositoryUrl: 'https://github.com/example/project',
    });
  });
  it.each(['', 'Moved repository', 'First line\nSecond line'])(
    'rejects the removed reason field %s before mutation',
    async (reason) => {
      const response = await patch({
        repositoryUrl: 'https://github.com/example/project',
        reason,
      });
      expect(response.status).toBe(400);
      expect(handler).not.toHaveBeenCalled();
    },
  );
  it.each([
    'https://github.com/example/project.git',
    'https://github.com/example/project/issues',
    'https://github.com/example/project?q=1',
  ])('rejects invalid repository URL %s', async (repositoryUrl) => {
    const response = await patch({ repositoryUrl });
    expect(response.status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });
  it('requires a session', async () => {
    const response = await patch(
      { repositoryUrl: 'https://github.com/example/project' },
      { cookie: '' },
    );
    expect(response.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });
  it('requires a permitted origin', async () => {
    const response = await patch(
      { repositoryUrl: 'https://github.com/example/project' },
      { origin: 'http://foreign.test' },
    );
    expect(response.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });
});
