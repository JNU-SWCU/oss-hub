import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ApplicationStatus, RepositoryConnectionMode } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { AuthConfig } from '../platform/auth.config';
import { AuthService } from '../auth/auth.service';
import { OriginGuard } from '../platform/origin.guard';
import { ProblemDetailFilter } from '../platform/problem-detail.filter';
import { PrismaService } from '../platform/prisma.service';
import { ProgramApplicationsController } from './program-applications.controller';
import { ApplicationsService } from './applications.service';
import { AuthSessionService } from '../platform/auth-session.service';
import { STATELESS_PROVIDERS } from '../../test/stateless-providers.fixture';
import { GLOBAL_AUTHENTICATION_GUARD_PROVIDERS } from '../../test/global-authentication-guard.fixture';

const authSessionService = new AuthSessionService();

const allowedOrigin = 'http://frontend.test';
const syntheticGithubId = 515151n;
const studentUserId = 'cuid-synthetic-student-actor';
const sessionSecret = new Uint8Array(32).fill(7);

const CANONICAL_BODY: Readonly<Record<string, unknown>> = {
  answers: { title: '제목' },
  applicationTemplateVersion: 1,
  isRepositoryPublicationPlanned: true,
};

const create = jest.fn().mockResolvedValue({
  id: 'synthetic-application',
  programId: 'synthetic-program',
  status: ApplicationStatus.SUBMITTED,
  teamId: 'synthetic-team',
  submittedAt: new Date('2026-08-07T00:00:00.000Z'),
  isRepositoryPublicationPlanned: true,
  repositoryConnectionMode: RepositoryConnectionMode.NEW,
  repositoryUrl: null,
});

let application: INestApplication | undefined;
let baseUrl = '';
let sessionCookie = '';

async function postApplication(
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/programs/synthetic-program/applications`, {
    method: 'POST',
    headers: {
      connection: 'close',
      'content-type': 'application/json',
      cookie: sessionCookie,
      origin: allowedOrigin,
    },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [ProgramApplicationsController],
    providers: [
      ...STATELESS_PROVIDERS,
      AuthSessionService,
      {
        provide: ApplicationsService,
        useValue: Object.assign(
          Object.create(ApplicationsService.prototype) as object,
          { create },
        ),
      },
      ...GLOBAL_AUTHENTICATION_GUARD_PROVIDERS,
      OriginGuard,
      {
        provide: AuthService,
        useValue: {
          getMe: jest
            .fn()
            .mockResolvedValue({ id: studentUserId, sessionVersion: 0 }),
        },
      },
      {
        provide: AuthConfig,
        useValue: { sessionSecret, allowedOrigin, useSecureCookies: false },
      },
      { provide: PrismaService, useValue: {} },
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
  const token = await authSessionService.issueSessionToken(
    sessionSecret,
    syntheticGithubId,
    0,
  );
  sessionCookie = `${authSessionService.sessionCookieName(false)}=${token}`;
});

beforeEach(() => {
  create.mockClear();
});

afterAll(async () => {
  if (application !== undefined) {
    await application.close();
  }
});

it('frontend 가 보내는 본문 그대로 201 로 통과하고 service.create 에 닿는다', async () => {
  const response = await postApplication({ ...CANONICAL_BODY });

  expect(response.status).toBe(201);
  expect(create).toHaveBeenCalledTimes(1);
});

it('미허용 키 teamId 가 있으면 400 SYS_003 이고 service.create 는 호출되지 않는다', async () => {
  const response = await postApplication({ ...CANONICAL_BODY, teamId: null });

  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    status: 400,
    code: 'SYS_003',
    instance: '/api/v1/programs/synthetic-program/applications',
  });
  expect(create).not.toHaveBeenCalled();
});

it('선택 키 teamName 은 허용된다 — 팀 이름은 이 이름으로 보낸다', async () => {
  const response = await postApplication({
    ...CANONICAL_BODY,
    teamName: '오픈소스팀',
  });

  expect(response.status).toBe(201);
  expect(create).toHaveBeenCalledWith(
    syntheticGithubId,
    'synthetic-program',
    expect.objectContaining({ teamName: '오픈소스팀' }),
  );
});

it.each([
  { repositoryConnectionMode: 'NEW' },
  { repositoryConnectionMode: 'OWN' },
  { repositoryUrl: null },
  { repositoryUrl: 'https://github.com/synthetic/repository' },
])('rejects obsolete repository selection fields: %j', async (fields) => {
  const response = await postApplication({ ...CANONICAL_BODY, ...fields });

  expect(response.status).toBe(400);
  expect(create).not.toHaveBeenCalled();
});
