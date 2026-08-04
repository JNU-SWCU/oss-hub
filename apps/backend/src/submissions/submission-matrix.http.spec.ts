import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SubmissionStatus } from '@prisma/client';
import { AuthConfig } from '../auth/auth.config';
import { AuthService } from '../auth/auth.service';
import { sessionCookieName } from '../auth/cookies';
import { issueSessionToken } from '../auth/session-token';
import { SessionGuard } from '../auth/session.guard';
import { ProblemDetailFilter } from '../common/problem-detail.filter';
import {
  SubmissionMatrixRepository,
  type SubmissionMatrixRepositoryPort,
} from './submission-matrix.repository';
import { SubmissionMatrixService } from './submission-matrix.service';
import { SubmissionMatrixController } from './submissions.controller';

const sessionSecret = new Uint8Array(32).fill(29);
const allowedOrigin = 'http://frontend.test';
const STAFF_GITHUB_ID = 9_124_100_001n;
const ADMIN_GITHUB_ID = 9_124_100_002n;
const STUDENT_GITHUB_ID = 9_124_100_003n;
const PROGRAM_ID = 'synthetic-matrix-program';
const MATRIX_URL_PATH = `/api/v1/programs/${PROGRAM_ID}/submissions/matrix`;

const pageCalls: Array<{
  q: string;
  applicationMode: string | null;
  skip: number;
  take: number;
}> = [];

const repository: SubmissionMatrixRepositoryPort = {
  findActiveStaffOrAdmin: (githubId) =>
    Promise.resolve(
      githubId === STAFF_GITHUB_ID || githubId === ADMIN_GITHUB_ID
        ? { id: 'synthetic-viewer' }
        : null,
    ),
  programExists: (programId) => Promise.resolve(programId === PROGRAM_ID),
  findMilestones: () =>
    Promise.resolve([
      {
        id: 'synthetic-milestone',
        name: '합성 기획서',
        dueAt: new Date('2026-08-20T14:59:59.000Z'),
      },
    ]),
  findApprovedApplications: (_programId, filter, skip, take) => {
    pageCalls.push({ ...filter, skip, take });
    return Promise.resolve({
      items: [
        {
          id: 'synthetic-application-personal',
          applicant: { name: '합성 신청자', nickname: 'synthetic-hong' },
          team: null,
        },
        {
          id: 'synthetic-application-team',
          applicant: { name: null, nickname: 'synthetic-leader' },
          team: {
            name: '합성 오픈소스팀',
            memberNicknames: ['synthetic-leader', 'synthetic-member'],
          },
        },
      ],
      total: 2,
    });
  },
  findCurrentSubmissions: () =>
    Promise.resolve([
      {
        id: 'synthetic-submission',
        applicationId: 'synthetic-application-personal',
        milestoneId: 'synthetic-milestone',
        status: SubmissionStatus.SUBMITTED,
        currentRevision: 2,
        submittedAt: new Date('2026-08-19T01:00:00.000Z'),
      },
    ]),
};

let application: INestApplication | undefined;
let baseUrl = '';

beforeEach(() => {
  pageCalls.length = 0;
});

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [SubmissionMatrixController],
    providers: [
      SubmissionMatrixService,
      SessionGuard,
      {
        provide: AuthConfig,
        useValue: { sessionSecret, allowedOrigin, useSecureCookies: false },
      },
      {
        provide: AuthService,
        useValue: { getMe: jest.fn().mockResolvedValue({ id: 'synthetic' }) },
      },
      { provide: SubmissionMatrixRepository, useValue: repository },
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

afterAll(async () => {
  await application?.close();
});

async function cookie(githubId: bigint): Promise<string> {
  return `${sessionCookieName(false)}=${await issueSessionToken(
    sessionSecret,
    githubId,
  )}`;
}

it('익명 매트릭스 요청을 401로 차단한다', async () => {
  const response = await fetch(`${baseUrl}${MATRIX_URL_PATH}`);

  expect(response.status).toBe(401);
  await expect(response.json()).resolves.toMatchObject({ code: 'AUT_003' });
});

it('학생 세션은 403 SUB_015로 차단한다', async () => {
  const response = await fetch(`${baseUrl}${MATRIX_URL_PATH}`, {
    headers: { cookie: await cookie(STUDENT_GITHUB_ID) },
  });

  expect(response.status).toBe(403);
  await expect(response.json()).resolves.toMatchObject({ code: 'SUB_015' });
});

it('STAFF 세션은 매트릭스를 캐시 금지 헤더와 함께 직렬화한다', async () => {
  const response = await fetch(`${baseUrl}${MATRIX_URL_PATH}`, {
    headers: { cookie: await cookie(STAFF_GITHUB_ID) },
  });

  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  await expect(response.json()).resolves.toEqual({
    milestones: [
      {
        id: 'synthetic-milestone',
        name: '합성 기획서',
        dueAt: '2026-08-20T14:59:59.000Z',
      },
    ],
    rows: [
      {
        applicationId: 'synthetic-application-personal',
        applicationMode: 'PERSONAL',
        displayName: '합성 신청자',
        githubLogins: ['synthetic-hong'],
        cells: [
          {
            milestoneId: 'synthetic-milestone',
            submissionId: 'synthetic-submission',
            revision: 2,
            status: 'SUBMITTED',
            submittedAt: '2026-08-19T01:00:00.000Z',
            reviewUrl: `/programs/${PROGRAM_ID}/submissions/synthetic-submission/review`,
          },
        ],
      },
      {
        applicationId: 'synthetic-application-team',
        applicationMode: 'TEAM',
        displayName: '합성 오픈소스팀',
        githubLogins: ['synthetic-leader', 'synthetic-member'],
        cells: [
          {
            milestoneId: 'synthetic-milestone',
            submissionId: null,
            revision: null,
            status: 'NOT_SUBMITTED',
            submittedAt: null,
            reviewUrl: null,
          },
        ],
      },
    ],
    page: 1,
    pageSize: 20,
    total: 2,
  });
});

it('ADMIN 세션도 200으로 조회하고 query 기본값·trim을 적용한다', async () => {
  const response = await fetch(
    `${baseUrl}${MATRIX_URL_PATH}?q=%20%EA%B8%B0%ED%9A%8D%20`,
    { headers: { cookie: await cookie(ADMIN_GITHUB_ID) } },
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    page: 1,
    pageSize: 20,
  });
  expect(pageCalls).toEqual([
    { q: '기획', applicationMode: null, skip: 0, take: 20 },
  ]);
});

it('없는 프로그램은 404 SUB_016으로 끝난다', async () => {
  const response = await fetch(
    `${baseUrl}/api/v1/programs/synthetic-missing-program/submissions/matrix`,
    { headers: { cookie: await cookie(STAFF_GITHUB_ID) } },
  );

  expect(response.status).toBe(404);
  await expect(response.json()).resolves.toMatchObject({ code: 'SUB_016' });
});

it.each([
  ['pageSize 상한 100 초과', 'pageSize=101'],
  ['page 0', 'page=0'],
  ['허용되지 않은 applicationMode', 'applicationMode=BOTH'],
] as const)('%s 요청은 서비스 호출 전에 400으로 거절한다', async (_, qs) => {
  const response = await fetch(`${baseUrl}${MATRIX_URL_PATH}?${qs}`, {
    headers: { cookie: await cookie(STAFF_GITHUB_ID) },
  });

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toMatchObject({ code: 'SYS_003' });
  expect(pageCalls).toHaveLength(0);
});
