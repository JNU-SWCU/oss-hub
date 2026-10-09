import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AccountStatus } from '@prisma/client';
import { AuthConfig } from '../auth/auth.config';
import { AuthService } from '../auth/service/auth.service';
import { sessionCookieName } from '../auth/domain/cookies';
import { OriginGuard } from '../auth/controller/origin.guard';
import { issueSessionToken } from '../auth/domain/session-token';
import { SessionGuard } from '../auth/controller/session.guard';
import { ProblemDetailFilter } from '../common/problem-detail.filter';
import { PrismaService } from '../prisma/prisma.service';
import { BoardAccessGuard } from './board-access.guard';
import { BoardController } from './board.controller';
import { BoardRepository } from './board.repository';
import { BoardService } from './board.service';

const sessionSecret = new Uint8Array(32).fill(19);
const allowedOrigin = 'http://frontend.test';
const actor = {
  id: 'synthetic-actor',
  hasStaffAccess: false,
  hasAdminAccess: false,
  accountStatus: AccountStatus.ACTIVE,
};
const prisma = {
  user: { findUnique: jest.fn() },
  application: { findFirst: jest.fn() },
};
const repository = {
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
        BoardAccessGuard,
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
});
