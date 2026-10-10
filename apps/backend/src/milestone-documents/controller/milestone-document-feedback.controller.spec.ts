import type { INestApplication } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { AuthConfig } from '../../auth/auth.config';
import { SessionGuard } from '../../auth/controller/session.guard';
import { sessionCookieName } from '../../auth/domain/cookies';
import { issueSessionToken } from '../../auth/domain/session-token';
import { AuthService } from '../../auth/service/auth.service';
import { ProblemDetailFilter } from '../../common/controller/problem-detail.filter';
import { MilestoneDocumentFeedbackService } from '../service/milestone-document-feedback.service';
import { MilestoneDocumentFeedbackController } from './milestone-document-feedback.controller';

const SESSION_GITHUB_ID = 342_900_300n;
const SESSION_SECRET = new Uint8Array(32).fill(41);
const FEEDBACK = {
  items: [
    {
      id: 'review-1',
      decision: 'CHANGES_REQUESTED',
      comment: '표지를 보완해 주세요.',
      reviewedAt: '2026-09-20T01:00:00.000Z',
      resubmissionDueAt: '2026-09-27T14:59:00.000Z',
      applicationId: 'synthetic-application',
      programId: 'synthetic-program',
      milestoneId: 'synthetic-milestone',
      milestoneName: '중간 보고',
      itemName: '합성 계획서',
      href: '/programs/synthetic-program/documents?milestoneId=synthetic-milestone',
    },
  ],
} as const;
const recentForParticipant = jest.fn();
let application: INestApplication | undefined;
let feedbackUrl = '';

beforeEach(() => {
  recentForParticipant.mockReset().mockResolvedValue(FEEDBACK);
});

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [MilestoneDocumentFeedbackController],
    providers: [
      SessionGuard,
      {
        provide: AuthConfig,
        useValue: {
          sessionSecret: SESSION_SECRET,
          allowedOrigin: 'http://frontend.test',
          useSecureCookies: false,
        },
      },
      {
        provide: AuthService,
        useValue: {
          getMe: jest
            .fn()
            .mockResolvedValue({ id: 'viewer', sessionVersion: 0 }),
        },
      },
      {
        provide: MilestoneDocumentFeedbackService,
        useValue: { recentForParticipant },
      },
    ],
  }).compile();

  application = moduleRef.createNestApplication();
  application.setGlobalPrefix('api/v1');
  application.useGlobalFilters(new ProblemDetailFilter());
  await application.listen(0, '127.0.0.1');
  feedbackUrl = `${await application.getUrl()}/api/v1/dashboard/student/feedback`;
});

afterAll(async () => {
  await application?.close();
});

it('세션 사용자의 최근 판정을 private, no-store로 돌려준다', async () => {
  const token = await issueSessionToken(SESSION_SECRET, SESSION_GITHUB_ID, 0);

  const response = await fetch(feedbackUrl, {
    headers: { cookie: `${sessionCookieName(false)}=${token}` },
  });

  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  await expect(response.json()).resolves.toEqual(FEEDBACK);
  expect(recentForParticipant).toHaveBeenCalledWith(SESSION_GITHUB_ID);
});

it('미인증 요청은 판정을 읽기 전에 AUT_003 401로 거부한다', async () => {
  const response = await fetch(feedbackUrl);

  expect(response.status).toBe(401);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  await expect(response.json()).resolves.toMatchObject({
    status: 401,
    code: 'AUT_003',
  });
  expect(recentForParticipant).not.toHaveBeenCalled();
});

it('학생 대시보드와 같이 SessionGuard 하나만 붙인다', () => {
  const handler: unknown = Object.getOwnPropertyDescriptor(
    MilestoneDocumentFeedbackController.prototype,
    'recentFeedback',
  )?.value;

  expect(typeof handler).toBe('function');
  if (typeof handler !== 'function') return;
  expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([SessionGuard]);
});
