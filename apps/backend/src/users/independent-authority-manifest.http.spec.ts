import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AccountStatus, MemberKind } from '@prisma/client';
import { AuthConfig } from '../auth/auth.config';
import { AuthService } from '../auth/auth.service';
import { sessionCookieName } from '../auth/cookies';
import { OriginGuard } from '../auth/origin.guard';
import { issueSessionToken } from '../auth/session-token';
import { SessionGuard } from '../auth/session.guard';
import { ProblemDetailFilter } from '../common/problem-detail.filter';
import { AdminAccessController } from './admin-access.controller';
import { AdminAccessService } from './admin-access.service';
import { AdminProfileService } from './admin-profile.service';
import { ADMIN_ACCESS_COMMANDS } from './domain/independent-authority';
import { IndependentAuthorityController } from './independent-authority.controller';
import { IndependentAuthorityService } from './independent-authority.service';

const githubId = 9_700_500_001n;
const sessionSecret = new Uint8Array(32).fill(31);
const allowedOrigin = 'http://frontend.test';
const authorityRoutes = [
  ['GET', '/api/v1/users/target/access'],
  ['PATCH', '/api/v1/users/target/staff-access'],
  ['PATCH', '/api/v1/users/target/admin-access'],
] as const;
const patchHeaders = {
  'content-type': 'application/json',
  origin: allowedOrigin,
};
const detail = {
  id: 'target',
  githubLogin: 'synthetic-target',
  name: '합성 학생 관리자',
  role: 'ADMIN',
  memberKind: MemberKind.STUDENT,
  hasStaffAccess: false,
  hasAdminAccess: true,
  accountStatus: AccountStatus.ACTIVE,
  isSelf: false,
  isProfileComplete: true,
  pendingRequest: null,
  lastLoginAt: null,
  profile: {
    name: '합성 학생 관리자',
    studentId: '970050',
    department: '인공지능학부',
    isComplete: true,
  },
};

function createPatchBody(command: string): string {
  return JSON.stringify({ command });
}

describe('canonical authority routes in the auth manifest HTTP surface', () => {
  let application: INestApplication;
  let baseUrl = '';
  let cookie = '';
  const accessService = {
    list: jest.fn(),
    listRequests: jest.fn(),
    facets: jest.fn(),
    get: jest.fn().mockResolvedValue(detail),
    getHistory: jest.fn(),
    patchAccess: jest.fn(),
  };
  const authorityService = {
    patchStaffAccess: jest.fn(),
    patchAdminAccess: jest.fn().mockResolvedValue({
      id: 'target',
      role: 'STUDENT',
      memberKind: MemberKind.STUDENT,
      hasStaffAccess: false,
      hasAdminAccess: false,
    }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminAccessController, IndependentAuthorityController],
      providers: [
        SessionGuard,
        OriginGuard,
        { provide: AdminAccessService, useValue: accessService },
        {
          provide: AdminProfileService,
          useValue: { patchProfile: jest.fn() },
        },
        { provide: IndependentAuthorityService, useValue: authorityService },
        {
          provide: AuthService,
          useValue: {
            getMe: jest
              .fn()
              .mockResolvedValue({ id: 'actor', sessionVersion: 0 }),
          },
        },
        {
          provide: AuthConfig,
          useValue: { sessionSecret, allowedOrigin, useSecureCookies: false },
        },
      ],
    }).compile();
    application = moduleRef.createNestApplication();
    application.setGlobalPrefix('api/v1');
    application.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    application.useGlobalFilters(new ProblemDetailFilter());
    await application.listen(0, '127.0.0.1');
    baseUrl = await application.getUrl();
    cookie = `${sessionCookieName(false)}=${await issueSessionToken(
      sessionSecret,
      githubId,
      0,
    )}`;
  });

  afterAll(async () => application.close());

  it.each(authorityRoutes)(
    '%s %s denies anonymous access',
    async (method, path) => {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          ...patchHeaders,
        },
        body:
          method === 'PATCH'
            ? createPatchBody(ADMIN_ACCESS_COMMANDS.GRANT)
            : undefined,
      });
      expect(response.status).toBe(401);
    },
  );

  it('keeps authenticated detail and admin mutation contracts available', async () => {
    const detailResponse = await fetch(
      `${baseUrl}/api/v1/users/target/access`,
      { headers: { cookie } },
    );
    const mutationResponse = await fetch(
      `${baseUrl}/api/v1/users/target/admin-access`,
      {
        method: 'PATCH',
        headers: {
          ...patchHeaders,
          cookie,
        },
        body: createPatchBody(ADMIN_ACCESS_COMMANDS.REVOKE),
      },
    );

    expect([detailResponse.status, mutationResponse.status]).toEqual([
      200, 200,
    ]);
    await expect(detailResponse.json()).resolves.toMatchObject({
      memberKind: MemberKind.STUDENT,
      hasStaffAccess: false,
      hasAdminAccess: true,
    });
    expect(authorityService.patchAdminAccess).toHaveBeenCalledWith(
      githubId,
      'target',
      { command: ADMIN_ACCESS_COMMANDS.REVOKE },
    );
  });
});
