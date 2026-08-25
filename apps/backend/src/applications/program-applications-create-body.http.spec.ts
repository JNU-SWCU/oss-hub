import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { ApplicationStatus, RepositoryConnectionMode } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { AuthConfig } from '../auth/auth.config';
import { AuthService } from '../auth/auth.service';
import { OriginGuard } from '../auth/origin.guard';
import { issueSessionToken } from '../auth/session-token';
import { sessionCookieName } from '../auth/cookies';
import { SessionGuard } from '../auth/session.guard';
import { ProblemDetailFilter } from '../common/problem-detail.filter';
import { PrismaService } from '../prisma/prisma.service';
import { ProgramApplicationsController } from './program-applications.controller';
import { ApplicationsService } from './applications.service';

/**
 * 신청 생성 요청 본문의 **wire 계약**을 실제 HTTP 파이프라인으로 고정한다.
 *
 * 왜 이 파일이 필요한가 — 2026-08-05 v0.6.31 부터 8/7 까지 배포 운영에서 **모든 신규
 * 신청 제출이 400 으로 실패했다.** #651 이 backend DTO 의 `teamId` 를 `teamName` 으로
 * 바꾸면서 frontend 요청 본문을 함께 고치지 않았고, 전역 `ValidationPipe` 가
 * `forbidNonWhitelisted: true` 라 **미허용 키 `teamId` 가 있다는 것만으로** 본문 전체가
 * SYS_003 으로 거절됐다.
 *
 * 그때 세 겹의 사각지대가 있었다.
 * 1. frontend 계약 테스트가 `teamId` 가 든 본문을 정답으로 단언해 버그를 고정했다.
 * 2. backend DTO 단위 테스트는 `plainToInstance` + `validate()` 를 직접 불러
 *    `whitelist`/`forbidNonWhitelisted` 를 켜지 않았다 — 미허용 키 시나리오를 표현조차
 *    할 수 없었다.
 * 3. POST `/programs/:id/applications` 를 **실제 파이프라인으로** 때리는 테스트가
 *    저장소에 하나도 없었다.
 *
 * 그래서 이 파일은 DTO 단위 테스트가 아니라 `ValidationPipe` 를 세운 http spec 이다.
 * 아래 CANONICAL_BODY 는 frontend `features/programs/api.ts` 의 `createApplication` 이
 * 실제로 직렬화하는 키 집합과 같아야 한다. 한쪽을 바꾸면 다른 쪽도 바꾼다.
 */
const allowedOrigin = 'http://frontend.test';
const syntheticGithubId = 515151n;
const studentUserId = 'cuid-synthetic-student-actor';
const sessionSecret = new Uint8Array(32).fill(7);

/**
 * frontend `createApplication` 이 보내는 본문. 키를 여기서 바꾸려면
 * `apps/frontend/src/features/programs/api.ts` 도 같이 바꿔야 한다.
 */
const CANONICAL_BODY: Readonly<Record<string, unknown>> = {
  answers: { title: '제목', summary: '요약' },
  applicationTemplateVersion: 1,
  isRepositoryPublicationPlanned: true,
  repositoryConnectionMode: 'NEW',
  repositoryUrl: null,
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
      { provide: ApplicationsService, useValue: { create } },
      SessionGuard,
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
  const token = await issueSessionToken(sessionSecret, syntheticGithubId, 0);
  sessionCookie = `${sessionCookieName(false)}=${token}`;
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
  // 2026-08-05 회귀 그 자체. 값이 null 이어도 키가 있다는 것만으로 거절된다.
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
