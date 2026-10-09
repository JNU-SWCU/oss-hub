import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AccountStatus } from '@prisma/client';
import { AuthConfig } from '../../auth/auth.config';
import { AuthService } from '../../auth/service/auth.service';
import { sessionCookieName } from '../../auth/domain/cookies';
import { OriginGuard } from '../../auth/controller/origin.guard';
import { issueSessionToken } from '../../auth/domain/session-token';
import { SessionGuard } from '../../auth/controller/session.guard';
import { ProblemDetailFilter } from '../../common/problem-detail.filter';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersAuthorityService } from '../../users/service/authority.service';
import { BoardController } from './board.controller';
import { BoardRepository } from '../repository/board.repository';
import { BoardService } from '../service/board.service';

const sessionSecret = new Uint8Array(32).fill(19);
const allowedOrigin = 'http://frontend.test';
const actor: {
  id: string;
  hasStaffAccess: boolean;
  hasAdminAccess: boolean;
  accountStatus: AccountStatus;
} = {
  id: 'synthetic-actor',
  hasStaffAccess: false,
  hasAdminAccess: false,
  accountStatus: AccountStatus.ACTIVE,
};
const prisma = {
  user: { findUnique: jest.fn<Promise<typeof actor | null>, []>() },
  application: { findFirst: jest.fn<Promise<{ id: string } | null>, []>() },
};
const repository = {
  findAccessActor: jest.fn(() => prisma.user.findUnique()),
  isApprovedParticipant: jest.fn(
    async () => (await prisma.application.findFirst()) !== null,
  ),
  findByProgramId: jest.fn().mockResolvedValue({ items: [], total: 0 }),
};

describe('board authorization HTTP characterization', () => {
  let application: INestApplication;
  let baseUrl: string;
  let cookie: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [BoardController],
      providers: [
        BoardService,
        {
          provide: UsersAuthorityService,
          useValue: new UsersAuthorityService({
            findActorByGithubId: () => prisma.user.findUnique(),
          }),
        },
        SessionGuard,
        OriginGuard,
        { provide: BoardRepository, useValue: repository },
        { provide: PrismaService, useValue: prisma },
        {
          provide: AuthService,
          useValue: {
            getMe: jest
              .fn()
              .mockResolvedValue({ id: actor.id, sessionVersion: 0 }),
          },
        },
        {
          provide: AuthConfig,
          useValue: { sessionSecret, allowedOrigin, useSecureCookies: false },
        },
      ],
    }).compile();
    application = moduleRef.createNestApplication();
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
    cookie = `${sessionCookieName(false)}=${await issueSessionToken(sessionSecret, 5001n, 0)}`;
  });
  afterAll(async () => application.close());
  beforeEach(() => {
    prisma.user.findUnique.mockResolvedValue(actor);
    prisma.application.findFirst.mockResolvedValue(null);
  });

  it.each([
    ['STUDENT', false, false, AccountStatus.ACTIVE, false, 403],
    ['inactive STAFF', true, false, AccountStatus.DEACTIVATED, false, 403],
    ['STAFF', true, false, AccountStatus.ACTIVE, false, 200],
    ['ADMIN', false, true, AccountStatus.ACTIVE, false, 200],
    ['approved participant', false, false, AccountStatus.ACTIVE, true, 200],
    ['unapproved participant', false, false, AccountStatus.ACTIVE, false, 403],
  ] as const)(
    'pins valid list response for %s',
    async (
      _role,
      hasStaffAccess,
      hasAdminAccess,
      accountStatus,
      participant,
      status,
    ) => {
      prisma.user.findUnique.mockResolvedValue({
        ...actor,
        hasStaffAccess,
        hasAdminAccess,
        accountStatus,
      });
      prisma.application.findFirst.mockResolvedValue(
        participant ? { id: 'synthetic-application' } : null,
      );
      const response = await fetch(
        `${baseUrl}/programs/synthetic-program/board/posts`,
        { headers: { cookie } },
      );
      expect(response.status).toBe(status);
      const body: unknown = await response.json();
      if (status === 200)
        expect(body).toEqual({ items: [], total: 0, page: 1, limit: 20 });
      else
        expect(body).toEqual({
          type: 'about:blank',
          instance: '/programs/synthetic-program/board/posts',
          detail: '이 프로그램 게시판에 접근할 권한이 없습니다.',
          code: 'BRD_001',
          status: 403,
          title: 'FORBIDDEN',
        });
    },
  );

  it('pins anonymous authentication', async () => {
    const response = await fetch(
      `${baseUrl}/programs/synthetic-program/board/posts`,
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: 'AUT_003',
      status: 401,
    });
  });

  it.each(['STUDENT', 'inactive STAFF'] as const)(
    'validates invalid query before denying %s',
    async (role) => {
      if (role === 'inactive STAFF')
        prisma.user.findUnique.mockResolvedValue({
          ...actor,
          hasStaffAccess: true,
          accountStatus: AccountStatus.DEACTIVATED,
        });
      const response = await fetch(
        `${baseUrl}/programs/synthetic-program/board/posts?page=invalid`,
        { headers: { cookie } },
      );
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: 'SYS_003',
        status: 400,
      });
    },
  );

  for (const inactiveStaff of [false, true]) {
    it.each([
      ['POST', '', {}],
      ['PATCH', '/synthetic-post', {}],
      ['PATCH', '/synthetic-post/pin', { pinned: 'invalid' }],
      ['POST', '/synthetic-post/comments', {}],
    ] as const)(
      `validates invalid body before authorization (inactiveStaff=${inactiveStaff}): %s %s`,
      async (method, suffix, body) => {
        if (inactiveStaff)
          prisma.user.findUnique.mockResolvedValue({
            ...actor,
            hasStaffAccess: true,
            accountStatus: AccountStatus.DEACTIVATED,
          });
        const response = await fetch(
          `${baseUrl}/programs/synthetic-program/board/posts${suffix}`,
          {
            method,
            headers: {
              cookie,
              origin: allowedOrigin,
              'content-type': 'application/json',
            },
            body: JSON.stringify(body),
          },
        );
        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
          code: 'SYS_003',
          status: 400,
        });
      },
    );

    it.each([undefined, 'http://invalid.test'])(
      `rejects Origin before authorization (inactiveStaff=${inactiveStaff}): %s`,
      async (origin) => {
        if (inactiveStaff)
          prisma.user.findUnique.mockResolvedValue({
            ...actor,
            hasStaffAccess: true,
            accountStatus: AccountStatus.DEACTIVATED,
          });
        const response = await fetch(
          `${baseUrl}/programs/synthetic-program/board/posts`,
          {
            method: 'POST',
            headers: {
              cookie,
              ...(origin === undefined ? {} : { origin }),
              'content-type': 'application/json',
            },
            body: JSON.stringify({ title: '합성 제목', body: '합성 본문' }),
          },
        );
        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toMatchObject({
          code: 'AUT_002',
          status: 403,
        });
      },
    );
  }

  it('keeps malformed path params behind board authorization because no param pipe exists', async () => {
    const response = await fetch(
      `${baseUrl}/programs/invalid/board/posts/invalid`,
      { headers: { cookie } },
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'BRD_001',
      status: 403,
    });
  });
});
