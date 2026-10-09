import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthConfig } from '../auth/auth.config';
import { AuthService } from '../auth/service/auth.service';
import { sessionCookieName } from '../auth/domain/cookies';
import { OriginGuard } from '../auth/controller/origin.guard';
import { SessionGuard } from '../auth/controller/session.guard';
import { issueSessionToken } from '../auth/domain/session-token';
import { ProblemDetailFilter } from '../common/problem-detail.filter';
import {
  USER_DEPARTMENT_MAX_LENGTH,
  USER_NAME_MAX_LENGTH,
} from './dto/update-my-profile-request.dto';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

const githubId = 4242n;
const allowedOrigin = 'http://frontend.test';
const sessionSecret = new Uint8Array(32).fill(9);
const validBody = {
  name: '합성 사용자',
  studentId: '1'.repeat(6),
  department: '인공지능학부',
  phone: '7'.repeat(10),
};
const completeProfile = { ...validBody, isComplete: true };
const completeProfileResponse = {
  ...completeProfile,
  staffNumber: null,
};
const usersService = {
  getMyProfile: jest.fn().mockResolvedValue({
    name: 'GitHub 합성 이름',
    studentId: null,
    department: null,
    phone: null,
    staffNumber: null,
    isComplete: false,
  }),
  completeMyProfile: jest.fn().mockResolvedValue(completeProfileResponse),
  patchMyProfile: jest.fn().mockResolvedValue(completeProfileResponse),
};

let application: INestApplication;
let baseUrl = '';
let sessionCookie = '';

async function write(
  method: 'POST' | 'PATCH',
  body: unknown,
  origin = allowedOrigin,
): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/users/me/profile`, {
    method,
    headers: {
      connection: 'close',
      'content-type': 'application/json',
      cookie: sessionCookie,
      origin,
    },
    body: JSON.stringify(body),
  });
}

async function post(body: unknown, origin = allowedOrigin): Promise<Response> {
  return write('POST', body, origin);
}

async function patch(body: unknown, origin = allowedOrigin): Promise<Response> {
  return write('PATCH', body, origin);
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
          getMe: jest
            .fn()
            .mockResolvedValue({ id: 'synthetic-user', sessionVersion: 0 }),
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
  sessionCookie = `${sessionCookieName(false)}=${await issueSessionToken(sessionSecret, githubId, 0)}`;
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

it('인증된 GET 프로필 응답은 private no-store 캐시 제어를 설정한다', async () => {
  const response = await fetch(`${baseUrl}/api/v1/users/me/profile`, {
    headers: { connection: 'close', cookie: sessionCookie },
  });

  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
});

it('인증된 GET 프로필 응답은 staffNumber를 nullable 필드로 포함한다', async () => {
  const response = await fetch(`${baseUrl}/api/v1/users/me/profile`, {
    headers: {
      connection: 'close',
      cookie: sessionCookie,
    },
  });

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toHaveProperty('staffNumber', null);
});

it('유효한 POST를 정규화해 가입을 마친다', async () => {
  const response = await post({
    ...validBody,
    name: `  ${validBody.name}  `,
  });

  expect(response.status).toBe(201);
  await expect(response.json()).resolves.toEqual(completeProfileResponse);
  expect(usersService.completeMyProfile).toHaveBeenCalledWith(
    githubId,
    validBody,
  );
});

it('유효한 PATCH를 정규화해 갱신한다', async () => {
  const response = await patch({
    ...validBody,
    name: `  ${validBody.name}  `,
  });

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual(completeProfileResponse);
  expect(usersService.patchMyProfile).toHaveBeenCalledWith(githubId, validBody);
});

it('null staffNumber PATCH는 삭제 의미로 서비스에 전달한다', async () => {
  const response = await patch({
    ...validBody,
    staffNumber: null,
  });

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual(completeProfileResponse);
  expect(usersService.patchMyProfile).toHaveBeenCalledWith(githubId, {
    ...validBody,
    staffNumber: null,
  });
});

it.each([
  ['빈 문자열', ''],
  ['공백 문자열', '   '],
])(
  'staffNumber %s PATCH는 삭제 의미로 서비스에 전달한다',
  async (_name, staffNumber) => {
    const response = await patch({
      ...validBody,
      staffNumber,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(completeProfileResponse);
    expect(usersService.patchMyProfile).toHaveBeenCalledWith(githubId, {
      ...validBody,
      staffNumber: null,
    });
  },
);

it('공백과 결합 문자가 있는 Unicode staffNumber를 trim NFC 정규화해 전달한다', async () => {
  const response = await patch({
    ...validBody,
    staffNumber: '  é-𐐀  ',
  });

  expect(response.status).toBe(200);
  expect(usersService.patchMyProfile).toHaveBeenCalledWith(githubId, {
    ...validBody,
    staffNumber: 'é-𐐀',
  });
});

it('연락처 구분자가 있는 PATCH 입력을 400 SYS_003으로 거부한다', async () => {
  const response = await patch({
    ...validBody,
    phone: `${'1'.repeat(3)}-${'2'.repeat(7)}`,
  });

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toMatchObject({ code: 'SYS_003' });
  expect(usersService.patchMyProfile).not.toHaveBeenCalled();
});

it('학번 없는 name·department POST도 DTO 검증을 통과한다', async () => {
  const response = await post({
    name: validBody.name,
    department: validBody.department,
  });

  expect(response.status).toBe(201);
  expect(usersService.completeMyProfile).toHaveBeenCalledWith(githubId, {
    name: validBody.name,
    department: validBody.department,
  });
});

it('학과가 없는 이름만의 요청을 400 SYS_003으로 거부한다', async () => {
  const response = await post({ name: validBody.name });

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toMatchObject({ code: 'SYS_003' });
  expect(usersService.completeMyProfile).not.toHaveBeenCalled();
  expect(usersService.patchMyProfile).not.toHaveBeenCalled();
});

it.each([
  { name: '학번 5자리', body: { ...validBody, studentId: '1'.repeat(5) } },
  { name: '학번 7자리', body: { ...validBody, studentId: '1'.repeat(7) } },
  { name: '학번 비숫자', body: { ...validBody, studentId: 'ABCDEF' } },
  { name: 'staffNumber 비문자열', body: { ...validBody, staffNumber: 12345 } },
  {
    name: 'staffNumber 100코드포인트 초과',
    body: { ...validBody, staffNumber: '𐐀'.repeat(101) },
  },
  { name: '연락처 9자리', body: { ...validBody, phone: '1'.repeat(9) } },
  { name: '연락처 12자리', body: { ...validBody, phone: '1'.repeat(12) } },
  {
    name: '연락처 공백',
    body: { ...validBody, phone: `${'1'.repeat(3)} ${'2'.repeat(7)}` },
  },
  {
    name: '연락처 점',
    body: { ...validBody, phone: `${'1'.repeat(3)}.${'2'.repeat(7)}` },
  },
  {
    name: '연락처 더하기',
    body: { ...validBody, phone: `+${'1'.repeat(10)}` },
  },
  {
    name: '연락처 괄호',
    body: { ...validBody, phone: `(${'1'.repeat(3)})${'2'.repeat(7)}` },
  },
  {
    name: '연락처 비숫자',
    body: { ...validBody, phone: `${'1'.repeat(7)}ABCD` },
  },
  {
    name: '연락처 전각 숫자',
    body: { ...validBody, phone: `０${'1'.repeat(9)}` },
  },
  { name: '빈 이름', body: { ...validBody, name: '   ' } },
  { name: '빈 학과', body: { ...validBody, department: '   ' } },
  {
    name: '이름 길이 초과',
    body: { ...validBody, name: '가'.repeat(USER_NAME_MAX_LENGTH + 1) },
  },
  {
    name: '학과 길이 초과',
    body: {
      ...validBody,
      department: '가'.repeat(USER_DEPARTMENT_MAX_LENGTH + 1),
    },
  },
  { name: '추가 필드', body: { ...validBody, role: 'STUDENT' } },
])('$name 요청을 400 SYS_003으로 거부한다', async ({ body }) => {
  const response = await patch(body);

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toMatchObject({ code: 'SYS_003' });
  expect(usersService.completeMyProfile).not.toHaveBeenCalled();
  expect(usersService.patchMyProfile).not.toHaveBeenCalled();
});

it('허용되지 않은 Origin의 PATCH를 403 AUT_002로 거부한다', async () => {
  const response = await patch(validBody, 'https://forbidden.invalid');

  expect(response.status).toBe(403);
  await expect(response.json()).resolves.toMatchObject({ code: 'AUT_002' });
});
