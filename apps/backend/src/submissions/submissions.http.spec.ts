import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { OriginGuard } from '../auth/origin.guard';
import { SessionGuard } from '../auth/session.guard';
import { ProblemDetailFilter } from '../common/problem-detail.filter';
import {
  SubmissionChecklistController,
  SubmissionFormsController,
  SubmissionsController,
} from './submissions.controller';
import { SubmissionsService } from './submissions.service';

let application: INestApplication | undefined;
let baseUrl = '';
const form = jest.fn().mockResolvedValue({
  applicationId: 'synthetic-application',
  applicationMode: 'PERSONAL',
  milestone: {
    id: 'synthetic-milestone',
    name: '합성 제출',
    dueAt: '2026-08-30T00:00:00.000Z',
    dDay: 38,
    deadlineLabel: 'D-38',
    submissionType: 'REPOSITORY_RELEASE',
    instructions: null,
  },
  repository: {
    url: 'https://github.invalid/oss-hub-seed/repository-ready',
    status: 'READY',
  },
  existingSubmission: null,
  canSubmit: true,
  blockedReason: null,
});
const create = jest.fn();
const checklist = jest.fn().mockResolvedValue({
  applicationId: 'synthetic-application',
  applicationMode: 'TEAM',
  items: [
    {
      milestoneId: 'synthetic-milestone',
      name: '중간 보고',
      dueAt: '2026-09-01T14:59:59.000Z',
      submissionType: 'TEXT',
      submission: {
        id: 'synthetic-submission',
        status: 'CHANGES_REQUESTED',
        currentRevision: 1,
        lastReviewedAt: '2026-08-28T01:00:00.000Z',
        reviewComment: '실행 화면을 추가해 주세요',
        canResubmit: true,
      },
    },
  ],
});
const resubmit = jest.fn().mockResolvedValue({
  submissionId: 'synthetic-submission',
  revision: 2,
  status: 'SUBMITTED',
});

beforeEach(() => {
  create.mockClear();
  resubmit.mockClear();
});

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [
      SubmissionChecklistController,
      SubmissionFormsController,
      SubmissionsController,
    ],
    providers: [
      {
        provide: SubmissionsService,
        useValue: { form, create, checklist, resubmit },
      },
    ],
  })
    .overrideGuard(SessionGuard)
    .useValue({ canActivate: () => true })
    .overrideGuard(OriginGuard)
    .useValue({ canActivate: () => true })
    .compile();

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

it('private 제출 폼은 브라우저와 공유 캐시에 저장하지 않는다', async () => {
  // Given: applicationId와 private repository URL이 포함된 제출 폼.

  // When
  const response = await fetch(
    `${baseUrl}/api/v1/programs/synthetic-program/milestones/synthetic-milestone/submission-form`,
  );

  // Then
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  await expect(response.json()).resolves.toMatchObject({
    applicationId: 'synthetic-application',
    repository: {
      url: 'https://github.invalid/oss-hub-seed/repository-ready',
    },
  });
});

it('content가 누락된 최초 제출은 validation 4xx로 끝난다', async () => {
  // Given
  const body = {
    applicationId: 'synthetic-application',
    milestoneId: 'synthetic-milestone',
    comment: '합성 코멘트',
  };

  // When
  const response = await fetch(`${baseUrl}/api/v1/submissions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  // Then
  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toMatchObject({ code: 'SYS_003' });
  expect(create).not.toHaveBeenCalled();
});

it('10,000자를 넘는 TEXT 제출은 서비스 호출 전에 거절한다', async () => {
  // Given
  const body = {
    applicationId: 'synthetic-application',
    milestoneId: 'synthetic-milestone',
    content: { type: 'TEXT', text: '가'.repeat(10_001) },
  };

  // When
  const response = await fetch(`${baseUrl}/api/v1/submissions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  // Then
  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toMatchObject({ code: 'SYS_003' });
  expect(create).not.toHaveBeenCalled();
});

it('내 체크리스트는 계약 형태로 직렬화하고 브라우저·공유 캐시에 저장하지 않는다', async () => {
  // Given: 보완 요청 상태의 submission이 포함된 체크리스트.

  // When
  const response = await fetch(
    `${baseUrl}/api/v1/programs/synthetic-program/submissions/me`,
  );

  // Then
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  await expect(response.json()).resolves.toMatchObject({
    applicationId: 'synthetic-application',
    applicationMode: 'TEAM',
    items: [
      {
        milestoneId: 'synthetic-milestone',
        submission: {
          status: 'CHANGES_REQUESTED',
          currentRevision: 1,
          canResubmit: true,
        },
      },
    ],
  });
});

it('재제출은 baseRevision과 정규화된 content를 서비스에 전달하고 201로 끝난다', async () => {
  // Given
  const body = {
    baseRevision: 1,
    content: { type: 'TEXT', text: '보완한 본문' },
    comment: '  실행 화면을 추가했습니다  ',
  };

  // When
  const response = await fetch(
    `${baseUrl}/api/v1/submissions/synthetic-submission/resubmissions`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );

  // Then
  expect(response.status).toBe(201);
  await expect(response.json()).resolves.toEqual({
    submissionId: 'synthetic-submission',
    revision: 2,
    status: 'SUBMITTED',
  });
  expect(resubmit).toHaveBeenCalledWith(undefined, 'synthetic-submission', {
    baseRevision: 1,
    content: { type: 'TEXT', text: '보완한 본문' },
    comment: '실행 화면을 추가했습니다',
  });
});

it('content가 누락된 재제출은 validation 4xx로 끝난다', async () => {
  // Given
  const body = { baseRevision: 1, comment: '합성 코멘트' };

  // When
  const response = await fetch(
    `${baseUrl}/api/v1/submissions/synthetic-submission/resubmissions`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );

  // Then
  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toMatchObject({ code: 'SYS_003' });
  expect(resubmit).not.toHaveBeenCalled();
});

it('정수가 아닌 baseRevision은 서비스 호출 전에 거절한다', async () => {
  // Given
  const body = {
    baseRevision: '1',
    content: { type: 'TEXT', text: '보완한 본문' },
  };

  // When
  const response = await fetch(
    `${baseUrl}/api/v1/submissions/synthetic-submission/resubmissions`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );

  // Then
  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toMatchObject({ code: 'SYS_003' });
  expect(resubmit).not.toHaveBeenCalled();
});

it('2,048자를 넘는 release URL은 서비스 호출 전에 거절한다', async () => {
  // Given
  const body = {
    applicationId: 'synthetic-application',
    milestoneId: 'synthetic-milestone',
    content: {
      type: 'REPOSITORY_RELEASE',
      releaseUrl: `https://github.invalid/${'a'.repeat(2_048)}`,
    },
  };

  // When
  const response = await fetch(`${baseUrl}/api/v1/submissions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  // Then
  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toMatchObject({ code: 'SYS_003' });
  expect(create).not.toHaveBeenCalled();
});

function readGuards(
  prototype: object,
  propertyKey: string,
): readonly unknown[] {
  const handler: unknown = Object.getOwnPropertyDescriptor(
    prototype,
    propertyKey,
  )?.value;
  if (typeof handler !== 'function') {
    throw new Error(`Missing controller handler: ${propertyKey}`);
  }
  const metadata: unknown = Reflect.getMetadata(GUARDS_METADATA, handler);
  return Array.isArray(metadata) ? metadata : [];
}

it('체크리스트는 세션 가드를, 재제출은 세션+Origin 가드를 요구한다', () => {
  expect(
    readGuards(SubmissionChecklistController.prototype, 'checklist'),
  ).toEqual([SessionGuard]);
  expect(readGuards(SubmissionsController.prototype, 'resubmit')).toEqual([
    SessionGuard,
    OriginGuard,
  ]);
});
