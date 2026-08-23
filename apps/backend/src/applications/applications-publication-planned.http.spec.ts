import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { AccountStatus, ApplicationStatus } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { AuthConfig } from '../auth/auth.config';
import { AuthService } from '../auth/auth.service';
import { OriginGuard } from '../auth/origin.guard';
import { issueSessionToken } from '../auth/session-token';
import { sessionCookieName } from '../auth/cookies';
import { SessionGuard } from '../auth/session.guard';
import { ProblemDetailFilter } from '../common/problem-detail.filter';
import { PrismaService } from '../prisma/prisma.service';
import { ApplicationsStaffGuard } from './applications-staff.guard';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';

/**
 * #414 DEC-33/34 — Application.isRepositoryPublicationPlanned 는 제출 시 1회 결정이고
 * 이후 수정 endpoint는 두지 않는다. 유일한 PATCH(decide)는 action/reason 만 whitelist
 * 되어 있으므로, 실제 ValidationPipe(forbidNonWhitelisted)를 통과한 요청은 이 필드를
 * 절대 건드릴 수 없다는 것을 실제 HTTP 파이프라인으로 증명한다.
 */
const allowedOrigin = 'http://frontend.test';
const syntheticGithubId = 424242n;
const staffUserId = 'cuid-synthetic-staff-actor';
const sessionSecret = new Uint8Array(32).fill(9);

const decide = jest.fn().mockResolvedValue({
  kind: 'APPROVED',
  applicationId: 'synthetic-application',
  status: ApplicationStatus.APPROVED,
  repositoryProvisioning: { enabled: false, eventId: null, jobStatus: null },
});

const findUnique = jest.fn().mockResolvedValue({
  id: staffUserId,
  hasStaffAccess: true,
  hasAdminAccess: false,
  accountStatus: AccountStatus.ACTIVE,
});

interface ProblemExpectation {
  readonly status: number;
  readonly code: string;
  readonly instance: string;
}

let application: INestApplication | undefined;
let baseUrl = '';
let sessionCookie = '';

async function readJson(response: Response): Promise<unknown> {
  const body: unknown = JSON.parse(await response.text());
  return body;
}

async function patchDecision(body: Record<string, unknown>): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/applications/synthetic-application`, {
    method: 'PATCH',
    headers: {
      connection: 'close',
      'content-type': 'application/json',
      cookie: sessionCookie,
      origin: allowedOrigin,
    },
    body: JSON.stringify(body),
  });
}

async function expectProblemDetail(
  response: Response,
  expected: ProblemExpectation,
): Promise<void> {
  expect(response.status).toBe(expected.status);
  const problem = await readJson(response);
  expect(problem).toMatchObject({
    type: 'about:blank',
    status: expected.status,
    instance: expected.instance,
    code: expected.code,
  });
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [ApplicationsController],
    providers: [
      { provide: ApplicationsService, useValue: { decide } },
      SessionGuard,
      ApplicationsStaffGuard,
      OriginGuard,
      {
        provide: AuthService,
        useValue: { getMe: jest.fn().mockResolvedValue({ id: staffUserId }) },
      },
      {
        provide: AuthConfig,
        useValue: { sessionSecret, allowedOrigin, useSecureCookies: false },
      },
      { provide: PrismaService, useValue: { user: { findUnique } } },
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
  const token = await issueSessionToken(sessionSecret, syntheticGithubId);
  sessionCookie = `${sessionCookieName(false)}=${token}`;
});

beforeEach(() => {
  decide.mockClear();
});

afterAll(async () => {
  if (application !== undefined) {
    await application.close();
  }
});

it('isRepositoryPublicationPlanned 를 담은 PATCH decide 요청은 400 SYS_003 으로 거부되고 decide() 는 호출되지 않는다', async () => {
  const response = await patchDecision({
    action: 'APPROVE',
    isRepositoryPublicationPlanned: false,
  });

  await expectProblemDetail(response, {
    status: 400,
    code: 'SYS_003',
    instance: '/api/v1/applications/synthetic-application',
  });
  expect(decide).not.toHaveBeenCalled();
});

it('whitelist 필드만 보낸 정상 PATCH decide 는 통과한다(대조군)', async () => {
  const response = await patchDecision({ action: 'APPROVE' });

  expect(response.status).toBe(200);
  expect(decide).toHaveBeenCalledTimes(1);
});
