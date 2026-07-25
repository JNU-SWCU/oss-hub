import { ValidationPipe } from '@nestjs/common';
import type { ExecutionContext, INestApplication } from '@nestjs/common';
import {
  RepositoryVisibility,
  ReviewDecision,
  SubmissionStatus,
} from '@prisma/client';
import { Test } from '@nestjs/testing';
import { OriginGuard } from '../auth/origin.guard';
import { SessionGuard } from '../auth/session.guard';
import {
  SubmissionRepositoryPublishingController,
  SubmissionReviewsController,
} from './submission-reviews.controller';
import { SubmissionReviewsStaffGuard } from './submission-reviews-staff.guard';
import { SubmissionReviewsService } from './submission-reviews.service';

let application: INestApplication | undefined;
let baseUrl = '';

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
});

afterAll(async () => {
  await application?.close();
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
    { method: 'POST' },
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    repositoryId: 'repository-1',
    visibility: RepositoryVisibility.PUBLIC,
    publishedAt: '2026-07-23T00:00:00.000Z',
  });
});
