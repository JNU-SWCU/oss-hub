import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { OriginGuard } from '../auth/origin.guard';
import type { AuthenticatedRequest } from '../auth/session.guard';
import { SessionGuard } from '../auth/session.guard';
import { ProblemDetailFilter } from '../common/problem-detail.filter';
import { SubmissionFileCleanupFailuresController } from './submission-file-cleanup-failures.controller';
import { SubmissionFileCleanupFailuresService } from './submission-file-cleanup-failures.service';

let application: INestApplication | undefined;
let baseUrl = '';
const SESSION_GITHUB_ID = 545_900_001n;
const listExhausted = jest.fn();

beforeEach(() => {
  listExhausted.mockReset();
});

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [SubmissionFileCleanupFailuresController],
    providers: [
      {
        provide: SubmissionFileCleanupFailuresService,
        useValue: { listExhausted },
      },
    ],
  })
    .overrideGuard(SessionGuard)
    .useValue({
      canActivate: (context: ExecutionContext): boolean => {
        const request = context
          .switchToHttp()
          .getRequest<AuthenticatedRequest>();
        request.sessionGithubId = SESSION_GITHUB_ID;
        return true;
      },
    })
    .overrideGuard(OriginGuard)
    .useValue({ canActivate: () => true })
    .compile();

  application = moduleRef.createNestApplication();
  application.setGlobalPrefix('api/v1');
  application.useGlobalFilters(new ProblemDetailFilter());
  await application.listen(0, '127.0.0.1');
  baseUrl = await application.getUrl();
});

afterAll(async () => {
  await application?.close();
});

it('소진된 정리 대상을 opaque id만으로 운영자에게 노출한다', async () => {
  // Given
  listExhausted.mockResolvedValue([
    {
      fileId: 'submission-file-1',
      attemptCount: 6,
      lastError: 'STORAGE_DELETE_FAILED',
      createdAt: '2026-08-03T00:00:00.000Z',
    },
  ]);

  // When
  const response = await fetch(
    `${baseUrl}/api/v1/submission-files/cleanup/failures`,
  );

  // Then
  expect(response.status).toBe(200);
  const body = await response.text();
  expect(JSON.parse(body)).toEqual([
    {
      fileId: 'submission-file-1',
      attemptCount: 6,
      lastError: 'STORAGE_DELETE_FAILED',
      createdAt: '2026-08-03T00:00:00.000Z',
    },
  ]);
  expect(body).not.toMatch(
    /storageKey|originalFileName|uploader|\.pdf|submissions\//,
  );
  expect(listExhausted).toHaveBeenCalledWith(SESSION_GITHUB_ID);
});

it('관리자가 아닌 세션은 403으로 막고 본문에 내부 상태를 싣지 않는다', async () => {
  // Given
  listExhausted.mockRejectedValue(
    new ForbiddenException('Active administrator access is required'),
  );

  // When
  const response = await fetch(
    `${baseUrl}/api/v1/submission-files/cleanup/failures`,
  );

  // Then
  expect(response.status).toBe(403);
  expect(await response.text()).not.toMatch(/storageKey|originalFileName/);
});
