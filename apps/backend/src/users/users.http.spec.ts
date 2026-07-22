import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthConfig } from '../auth/auth.config';
import { AuthService } from '../auth/auth.service';
import { sessionCookieName } from '../auth/cookies';
import { OriginGuard } from '../auth/origin.guard';
import { SessionGuard } from '../auth/session.guard';
import { issueSessionToken } from '../auth/session-token';
import { ProblemDetailFilter } from '../common/problem-detail.filter';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

const githubId = 4242n;
const allowedOrigin = 'http://frontend.test';
const sessionSecret = new Uint8Array(32).fill(9);
const validBody = {
  name: '합성 사용자',
  studentId: '1'.repeat(6),
  department: '인공지능학부',
};
const completeProfile = { ...validBody, isComplete: true };
const usersService = {
  getMyProfile: jest.fn().mockResolvedValue({
    name: 'GitHub 합성 이름',
    studentId: null,
    department: null,
    isComplete: false,
  }),
  completeMyProfile: jest.fn().mockResolvedValue(completeProfile),
};

let application: INestApplication;
let baseUrl = '';
let sessionCookie = '';

async function patch(body: unknown, origin = allowedOrigin): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/users/me/profile`, {
    method: 'PATCH',
    headers: {
      connection: 'close',
      'content-type': 'application/json',
      cookie: sessionCookie,
      origin,
    },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [UsersController],
    providers: [
      SessionGuard,
      OriginGuard,
      { provide: UsersService, useValue: usersService },
      {
        provide: AuthService,
        useValue: {
          getMe: jest.fn().mockResolvedValue({ id: 'synthetic-user' }),
        },
      },
      {
        provide: AuthConfig,
        useValue: {
          sessionSecret,
          allowedOrigin,
          useSecureCookies: false,
        },
      },
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
  sessionCookie = `${sessionCookieName(false)}=${await issueSessionToken(sessionSecret, githubId)}`;
});

beforeEach(() => jest.clearAllMocks());

afterAll(async () => {
  await application.close();
});

it('비로그인 GET을 401 AUT_003으로 거부한다', async () => {
  const response = await fetch(`${baseUrl}/api/v1/users/me/profile`, {
    headers: { connection: 'close' },
  });

  expect(response.status).toBe(401);
  await expect(response.json()).resolves.toMatchObject({ code: 'AUT_003' });
});

it('유효한 PATCH를 정규화해 저장한다', async () => {
  const response = await patch({
    ...validBody,
    name: `  ${validBody.name}  `,
  });

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual(completeProfile);
  expect(usersService.completeMyProfile).toHaveBeenCalledWith(
    githubId,
    validBody,
  );
});

it.each([
  { name: '학번 5자리', body: { ...validBody, studentId: '1'.repeat(5) } },
  { name: '학번 11자리', body: { ...validBody, studentId: '1'.repeat(11) } },
  { name: '학번 비숫자', body: { ...validBody, studentId: 'ABCDEF' } },
  { name: '빈 이름', body: { ...validBody, name: '   ' } },
  { name: '빈 학과', body: { ...validBody, department: '   ' } },
  { name: '추가 필드', body: { ...validBody, role: 'STUDENT' } },
])('$name 요청을 400 SYS_003으로 거부한다', async ({ body }) => {
  const response = await patch(body);

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toMatchObject({ code: 'SYS_003' });
  expect(usersService.completeMyProfile).not.toHaveBeenCalled();
});

it('허용되지 않은 Origin의 PATCH를 403 AUT_002로 거부한다', async () => {
  const response = await patch(validBody, 'https://forbidden.invalid');

  expect(response.status).toBe(403);
  await expect(response.json()).resolves.toMatchObject({ code: 'AUT_002' });
});
