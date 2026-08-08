import { ValidationPipe } from '@nestjs/common';
import type { ExecutionContext, INestApplication } from '@nestjs/common';
import {
  RepositoryVisibility,
  ReviewDecision,
  SubmissionStatus,
} from '@prisma/client';
import { Test } from '@nestjs/testing';
import { AuthConfig } from '../auth/auth.config';
import { AuthService } from '../auth/auth.service';
import { OriginGuard } from '../auth/origin.guard';
import { SessionGuard } from '../auth/session.guard';
import { ProblemDetailFilter } from '../common/problem-detail.filter';
import {
  SubmissionRepositoryPublishingController,
  SubmissionReviewsController,
} from './submission-reviews.controller';
import { SubmissionReviewsStaffGuard } from './submission-reviews-staff.guard';
import { SubmissionReviewsService } from './submission-reviews.service';

let application: INestApplication | undefined;
let baseUrl = '';

let unauthenticatedApplication: INestApplication | undefined;
let unauthenticatedBaseUrl = '';
const unauthenticatedService = {
  context: jest.fn(),
  review: jest.fn(),
  publishRepository: jest.fn(),
};

const service = {
  context: jest.fn().mockResolvedValue({
    submissionId: 'submission-1',
    application: {
      id: 'application-1',
      applicationMode: 'PERSONAL',
      displayName: 'Synthetic Applicant',
    },
    milestone: { id: 'milestone-1', name: 'Final submission' },
    currentRevision: {
      number: 2,
      content: { url: 'https://example.com/submission' },
      comment: null,
      submittedAt: new Date('2026-07-22T00:00:00.000Z'),
      files: [],
      review: null,
    },
    history: [],
    repository: null,
  }),
  review: jest.fn().mockResolvedValue({
    reviewId: 'review-1',
    submissionStatus: SubmissionStatus.APPROVED,
  }),
  publishRepository: jest.fn().mockResolvedValue({
    repositoryId: 'repository-1',
    visibility: RepositoryVisibility.PUBLIC,
    publishedAt: new Date('2026-07-23T00:00:00.000Z'),
  }),
};

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [
      SubmissionReviewsController,
      SubmissionRepositoryPublishingController,
    ],
    providers: [{ provide: SubmissionReviewsService, useValue: service }],
  })
    .overrideGuard(SessionGuard)
    .useValue({ canActivate: () => true })
    .overrideGuard(SubmissionReviewsStaffGuard)
    .useValue({
      canActivate: (context: ExecutionContext) => {
        Object.assign(context.switchToHttp().getRequest<object>(), {
          submissionReviewerId: 'reviewer-1',
          sessionGithubId: 9_600_000_000_100_001n,
        });
        return true;
      },
    })
    .overrideGuard(OriginGuard)
    .useValue({ canActivate: () => true })
    .compile();

  application = moduleRef.createNestApplication();
  application.setGlobalPrefix('api/v1');
  application.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true }),
  );
  await application.listen(0, '127.0.0.1');
  baseUrl = await application.getUrl();

  // Isolated harness: real SessionGuard + ProblemDetailFilter so anonymous
  // review-context requests prove the repository 401 contract without
  // compromising the authenticated suite above. Staff guard is stubbed only
  // for DI — SessionGuard rejects before it runs on anonymous requests.
  const unauthenticatedModuleRef = await Test.createTestingModule({
    controllers: [SubmissionReviewsController],
    providers: [
      SessionGuard,
      {
        provide: AuthService,
        useValue: {
          getMe: jest.fn().mockResolvedValue({ id: 'synthetic-user' }),
        },
      },
      {
        provide: AuthConfig,
        useValue: {
          sessionSecret: new Uint8Array(32).fill(7),
          allowedOrigin: 'http://frontend.test',
          useSecureCookies: false,
        },
      },
      {
        provide: SubmissionReviewsService,
        useValue: unauthenticatedService,
      },
    ],
  })
    .overrideGuard(SubmissionReviewsStaffGuard)
    .useValue({ canActivate: () => true })
    .compile();

  unauthenticatedApplication = unauthenticatedModuleRef.createNestApplication();
  unauthenticatedApplication.setGlobalPrefix('api/v1');
  unauthenticatedApplication.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true }),
  );
  unauthenticatedApplication.useGlobalFilters(new ProblemDetailFilter());
  await unauthenticatedApplication.listen(0, '127.0.0.1');
  unauthenticatedBaseUrl = await unauthenticatedApplication.getUrl();
});

afterAll(async () => {
  await application?.close();
  await unauthenticatedApplication?.close();
});

it('검토 화면 컨텍스트를 ISO 시간 DTO로 반환한다', async () => {
  const response = await fetch(
    `${baseUrl}/api/v1/submissions/submission-1/review-context`,
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    currentRevision: { submittedAt: '2026-07-22T00:00:00.000Z' },
  });
});

it('판정 저장 API가 201과 현재 Submission 상태를 반환한다', async () => {
  const response = await fetch(
    `${baseUrl}/api/v1/submissions/submission-1/reviews`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ revision: 2, decision: ReviewDecision.APPROVED }),
    },
  );

  expect(response.status).toBe(201);
  await expect(response.json()).resolves.toEqual({
    reviewId: 'review-1',
    submissionStatus: SubmissionStatus.APPROVED,
  });
  expect(service.review).toHaveBeenCalledWith('reviewer-1', 'submission-1', {
    revision: 2,
    decision: ReviewDecision.APPROVED,
    comment: null,
  });
});

it('저장소 공개 API가 200과 공개 완료 시각을 반환한다', async () => {
  const response = await fetch(
    `${baseUrl}/api/v1/repositories/repository-1/publish`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isConfirmed: true }),
    },
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    repositoryId: 'repository-1',
    visibility: RepositoryVisibility.PUBLIC,
    publishedAt: '2026-07-23T00:00:00.000Z',
  });
  expect(service.publishRepository).toHaveBeenCalledWith(
    'repository-1',
    9_600_000_000_100_001n,
  );
});

it('비로그인 review-context 요청은 401 AUT_003 ProblemDetail을 반환하고 서비스를 호출하지 않는다', async () => {
  unauthenticatedService.context.mockClear();

  const response = await fetch(
    `${unauthenticatedBaseUrl}/api/v1/submissions/submission-1/review-context`,
    { headers: { connection: 'close' } },
  );

  expect(response.status).toBe(401);
  expect(response.headers.get('content-type')).toContain(
    'application/problem+json',
  );
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  await expect(response.json()).resolves.toMatchObject({
    type: 'about:blank',
    status: 401,
    code: 'AUT_003',
    instance: '/api/v1/submissions/submission-1/review-context',
  });
  expect(unauthenticatedService.context).not.toHaveBeenCalled();
});
