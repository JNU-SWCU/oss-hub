import { ValidationPipe } from '@nestjs/common';
import type { ExecutionContext, INestApplication } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import { Test } from '@nestjs/testing';
import {
  AUTH_ERROR_CODES,
  AuthErrorCode,
} from '../../auth/domain/auth-error-code.enum';
import { AuthConfig } from '../../auth/auth.config';
import { SessionGuard } from '../../auth/controller/session.guard';
import { DomainException } from '../../common/error-code';
import { ProblemDetailFilter } from '../../common/problem-detail.filter';
import { UsersAuthorityService } from '../../users/service/authority.service';
import {
  SubmissionRepositoryPublishingController,
  SubmissionReviewsController,
} from './submission-reviews.controller';
import { SubmissionReviewsService } from '../service/submission-reviews.service';
import type {
  SubmissionReviewTransactionStore,
  SubmissionReviewsRepositoryPort,
} from '../repository/submission-reviews.repository';

const actors = [
  ['anonymous', null],
  [
    'student',
    {
      id: 'student',
      accountStatus: AccountStatus.ACTIVE,
      hasStaffAccess: false,
      hasAdminAccess: false,
    },
  ],
  [
    'inactive staff',
    {
      id: 'inactive',
      accountStatus: AccountStatus.DEACTIVATED,
      hasStaffAccess: true,
      hasAdminAccess: false,
    },
  ],
  [
    'staff',
    {
      id: 'staff',
      accountStatus: AccountStatus.ACTIVE,
      hasStaffAccess: true,
      hasAdminAccess: false,
    },
  ],
  [
    'admin',
    {
      id: 'admin',
      accountStatus: AccountStatus.ACTIVE,
      hasStaffAccess: false,
      hasAdminAccess: true,
    },
  ],
  ['missing user', null],
] as const;
const routes = [
  [
    'GET',
    '/submissions/missing/review-context',
    undefined,
    404,
    'SUB_001',
    '제출을 찾을 수 없습니다.',
  ],
  [
    'POST',
    '/submissions/missing/reviews',
    { revision: 1, decision: 'APPROVED' },
    404,
    'SUB_001',
    '제출을 찾을 수 없습니다.',
  ],
  [
    'POST',
    '/repositories/missing/publish',
    { isConfirmed: true },
    409,
    'SUB_006',
    '저장소가 공개 전환할 준비가 되지 않았습니다.',
  ],
] as const;
const repository: SubmissionReviewsRepositoryPort = {
  findReviewContext: jest.fn().mockResolvedValue(null),
  findPublishEligibility: jest.fn().mockResolvedValue(null),
  withTransaction: async <T>(
    operation: (store: SubmissionReviewTransactionStore) => Promise<T>,
  ) =>
    operation({
      findReviewTarget: () => Promise.resolve(null),
      createReview: jest.fn(),
      transitionSubmission: jest.fn(),
    }),
};
let application: INestApplication;
let baseUrl: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [
      SubmissionReviewsController,
      SubmissionRepositoryPublishingController,
    ],
    providers: [
      {
        provide: AuthConfig,
        useValue: { allowedOrigin: 'http://frontend.test' },
      },
      {
        provide: SubmissionReviewsService,
        useValue: new SubmissionReviewsService(
          repository,
          {
            publish: jest.fn(),
          },
          new UsersAuthorityService({
            findActorByGithubId: (githubId) =>
              Promise.resolve(actors[Number(githubId)]?.[1] ?? null),
          }),
        ),
      },
    ],
  })
    .overrideGuard(SessionGuard)
    .useValue({
      canActivate(context: ExecutionContext) {
        const request = context.switchToHttp().getRequest<{
          headers: Record<string, string>;
          sessionGithubId?: bigint;
        }>();
        const index = Number(request.headers['x-actor']);
        if (index === 0)
          throw new DomainException(
            AUTH_ERROR_CODES[AuthErrorCode.UNAUTHENTICATED],
          );
        request.sessionGithubId = BigInt(index);
        return true;
      },
    })
    .compile();
  application = moduleRef.createNestApplication();
  application.setGlobalPrefix('api/v1');
  application.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true }),
  );
  application.useGlobalFilters(new ProblemDetailFilter());
  await application.listen(0, '127.0.0.1');
  baseUrl = await application.getUrl();
});
afterAll(async () => {
  await application.close();
});

it.each(
  [1, 2, 5].flatMap((actorIndex) => [
    {
      actorIndex,
      path: '/submissions/missing/reviews',
      body: { revision: 0, decision: 'INVALID' },
      origin: 'http://frontend.test',
      status: 400,
      code: 'SYS_003',
    },
    {
      actorIndex,
      path: '/repositories/missing/publish',
      body: { isConfirmed: 'INVALID' },
      origin: 'http://frontend.test',
      status: 400,
      code: 'SYS_003',
    },
    ...[
      '/submissions/missing/reviews',
      '/repositories/missing/publish',
    ].flatMap((path) => [
      {
        actorIndex,
        path,
        body: {},
        origin: 'http://evil.test',
        status: 403,
        code: 'AUT_002',
      },
      {
        actorIndex,
        path,
        body: {},
        origin: undefined,
        status: 403,
        code: 'AUT_002',
      },
    ]),
  ]),
)(
  '권한 없는 $actorIndex $path 요청은 validation 또는 Origin 오류를 먼저 반환한다 ($code)',
  async ({ actorIndex, path, body, origin, status, code }) => {
    const response = await fetch(`${baseUrl}/api/v1${path}`, {
      method: 'POST',
      headers: {
        'x-actor': String(actorIndex),
        'content-type': 'application/json',
        ...(origin === undefined ? {} : { origin }),
      },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({
      status,
      code,
      instance: `/api/v1${path}`,
    });
  },
);

it.each(
  actors.flatMap(([role, actor], actorIndex) =>
    routes.map(
      ([method, path, body, allowedStatus, allowedCode, allowedDetail]) => ({
        role,
        actorIndex,
        method,
        path,
        body,
        status:
          actorIndex === 0
            ? 401
            : actor?.accountStatus === AccountStatus.ACTIVE &&
                (actor.hasStaffAccess || actor.hasAdminAccess)
              ? allowedStatus
              : 403,
        code:
          actorIndex === 0
            ? 'AUT_003'
            : actor?.accountStatus === AccountStatus.ACTIVE &&
                (actor.hasStaffAccess || actor.hasAdminAccess)
              ? allowedCode
              : 'SUB_002',
        detail:
          actorIndex === 0
            ? '로그인이 필요합니다.'
            : actor?.accountStatus === AccountStatus.ACTIVE &&
                (actor.hasStaffAccess || actor.hasAdminAccess)
              ? allowedDetail
              : '승인된 교직원 또는 관리자만 제출을 검토할 수 있습니다.',
      }),
    ),
  ),
)(
  '$role $method $path 유효 요청의 전체 오류 응답을 보존한다',
  async ({ actorIndex, method, path, body, status, code, detail }) => {
    const response = await fetch(`${baseUrl}/api/v1${path}`, {
      method,
      headers: {
        'x-actor': String(actorIndex),
        origin: 'http://frontend.test',
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({
      type: 'about:blank',
      title:
        status === 401
          ? 'UNAUTHORIZED'
          : status === 403
            ? 'FORBIDDEN'
            : status === 404
              ? 'NOT_FOUND'
              : 'CONFLICT',
      status,
      code,
      detail,
      instance: `/api/v1${path}`,
    });
  },
);
