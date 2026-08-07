import { DomainException } from '../common/error-code';
import type { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { OriginGuard } from '../auth/origin.guard';
import type { AuthenticatedRequest } from '../auth/session.guard';
import { SessionGuard } from '../auth/session.guard';
import { ProblemDetailFilter } from '../common/problem-detail.filter';
import { DeadlineDigestFailuresController } from './deadline-digest-failures.controller';
import { DeadlineDigestFailuresService } from './deadline-digest-failures.service';
import { DeadlineDigestTriggerService } from './deadline-digest-trigger.service';
import {
  NOTIFICATIONS_ERROR_CODES,
  NotificationsErrorCode,
} from './notifications-error-code.enum';

let application: INestApplication | undefined;
let baseUrl = '';
const SESSION_GITHUB_ID = 699_900_001n;
const triggerSend = jest.fn();
const listFailures = jest.fn();

beforeEach(() => {
  triggerSend.mockReset().mockResolvedValue(undefined);
  listFailures.mockReset().mockResolvedValue([]);
});

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [DeadlineDigestFailuresController],
    providers: [
      {
        provide: DeadlineDigestTriggerService,
        useValue: { triggerSend },
      },
      {
        provide: DeadlineDigestFailuresService,
        useValue: { listFailures },
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

it('POST /notifications/deadline-digests/send 가 교직원 세션으로 배치를 실행한다', async () => {
  const response = await fetch(
    `${baseUrl}/api/v1/notifications/deadline-digests/send`,
    {
      method: 'POST',
      headers: {
        connection: 'close',
        origin: 'http://frontend.test',
      },
    },
  );

  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({ ok: true });
  expect(triggerSend).toHaveBeenCalledWith(SESSION_GITHUB_ID);
});

it('학생이 수동 발송을 호출하면 403 NOT_001 ProblemDetail을 반환한다', async () => {
  triggerSend.mockRejectedValue(
    new DomainException(
      NOTIFICATIONS_ERROR_CODES[NotificationsErrorCode.STAFF_ONLY],
    ),
  );

  const response = await fetch(
    `${baseUrl}/api/v1/notifications/deadline-digests/send`,
    {
      method: 'POST',
      headers: {
        connection: 'close',
        origin: 'http://frontend.test',
      },
    },
  );

  expect(response.status).toBe(403);
  expect(response.headers.get('content-type')).toContain(
    'application/problem+json',
  );
  const problem = (await response.json()) as { code?: string };
  expect(problem.code).toBe(NotificationsErrorCode.STAFF_ONLY);
  expect(triggerSend).toHaveBeenCalledWith(SESSION_GITHUB_ID);
});

it('GET /notifications/deadline-digests/failures 는 실패 목록을 반환한다', async () => {
  listFailures.mockResolvedValue([
    {
      id: 'notif-1',
      createdAt: '2026-08-07T00:00:00.000Z',
      error: 'smtp down',
    },
  ]);

  const response = await fetch(
    `${baseUrl}/api/v1/notifications/deadline-digests/failures`,
    { headers: { connection: 'close' } },
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual([
    {
      id: 'notif-1',
      createdAt: '2026-08-07T00:00:00.000Z',
      error: 'smtp down',
    },
  ]);
  expect(listFailures).toHaveBeenCalledWith(SESSION_GITHUB_ID);
});
