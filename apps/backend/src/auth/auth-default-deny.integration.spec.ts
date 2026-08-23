import { randomBytes } from 'node:crypto';
import {
  type CanActivate,
  Controller,
  type ExecutionContext,
  ForbiddenException,
  Get,
  type INestApplication,
  Injectable,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AccountStatus, MemberKind } from '@prisma/client';
import type { Request } from 'express';
import { AuthModule } from './auth.module';
import { OptionalSession, Public } from './auth-route-metadata';
import { AuthConfig } from './auth.config';
import { AuthService } from './auth.service';
import { sessionCookieName } from './cookies';
import type { AuthUser } from './domain/auth-user';
import { issueSessionToken } from './session-token';
import { ProblemDetailFilter } from '../common/problem-detail.filter';
import { PrismaModule } from '../prisma/prisma.module';

const sessionSecret = new Uint8Array(randomBytes(32));
const githubId = 424242n;
const activeUser: AuthUser = {
  id: 'synthetic-default-deny-user',
  githubId,
  nickname: 'synthetic-user',
  avatarUrl: null,
  accountStatus: AccountStatus.ACTIVE,
  memberKind: MemberKind.STUDENT,
  hasStaffAccess: false,
  hasAdminAccess: false,
  isProfileComplete: true,
};

type PrincipalShape = Readonly<{
  id: string;
  githubId: bigint;
  role: 'STUDENT' | 'STAFF' | 'ADMIN' | null;
}>;

type PrincipalRequest = Request & Readonly<{ principal: PrincipalShape }>;

@Injectable()
class PrincipalProbeService {
  read(principal: PrincipalShape): Readonly<{
    userId: string;
    githubId: string;
    role: 'STUDENT' | 'STAFF' | 'ADMIN' | null;
  }> {
    return {
      userId: principal.id,
      githubId: principal.githubId.toString(10),
      role: principal.role,
    };
  }
}

@Injectable()
class StaffFixtureGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<PrincipalRequest>();
    if (request.principal.role !== 'STAFF') {
      throw new ForbiddenException();
    }
    return true;
  }
}

@Controller('auth-boundary-fixture')
class AuthBoundaryFixtureController {
  constructor(private readonly probe: PrincipalProbeService) {}

  @Get('public')
  @Public()
  publicRoute(): Readonly<{ access: 'public' }> {
    return { access: 'public' };
  }

  @Get('optional')
  @OptionalSession()
  optionalRoute(): Readonly<{ access: 'optional' }> {
    return { access: 'optional' };
  }

  @Get('unannotated')
  unannotated(
    @Req() request: PrincipalRequest,
  ): ReturnType<PrincipalProbeService['read']> {
    return this.probe.read(request.principal);
  }

  @Get('staff')
  @UseGuards(StaffFixtureGuard)
  staffRoute(): Readonly<{ access: 'staff' }> {
    return { access: 'staff' };
  }
}

describe('global default-deny authentication boundary', () => {
  let application: INestApplication;
  let baseUrl: string;
  let sessionCookie: string;
  let currentUser: AuthUser = activeUser;

  beforeAll(async () => {
    const authService = {
      findActivePrincipal: jest
        .fn()
        .mockImplementation(() => Promise.resolve(currentUser)),
      findMe: jest.fn().mockImplementation(() => Promise.resolve(currentUser)),
      getMe: jest.fn().mockImplementation(() => Promise.resolve(currentUser)),
    };
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, AuthModule],
      controllers: [AuthBoundaryFixtureController],
      providers: [PrincipalProbeService, StaffFixtureGuard],
    })
      .overrideProvider(AuthConfig)
      .useValue({
        allowedOrigin: 'http://frontend.test',
        frontendUrl: 'http://frontend.test',
        sessionSecret,
        useSecureCookies: false,
      })
      .overrideProvider(AuthService)
      .useValue(authService)
      .compile();

    application = moduleRef.createNestApplication();
    application.setGlobalPrefix('api/v1');
    application.useGlobalFilters(new ProblemDetailFilter());
    await application.listen(0, '127.0.0.1');
    baseUrl = await application.getUrl();
    sessionCookie = `${sessionCookieName(false)}=${await issueSessionToken(
      sessionSecret,
      githubId,
    )}`;
  });

  afterAll(async () => {
    await application.close();
  });

  beforeEach(() => {
    currentUser = activeUser;
  });

  it('returns 401 when an unannotated route is anonymous', async () => {
    // Given: an unannotated route and no session cookie.
    // When: the route is requested through the real Nest HTTP pipeline.
    const response = await fetch(
      `${baseUrl}/api/v1/auth-boundary-fixture/unannotated`,
    );

    // Then: the global boundary denies it before the controller runs.
    expect(response.status).toBe(401);
  });

  it('honors public metadata for an anonymous request', async () => {
    // Given: an explicitly public route.
    // When: the route is requested without a session cookie.
    const response = await fetch(
      `${baseUrl}/api/v1/auth-boundary-fixture/public`,
    );

    // Then: the route preserves its anonymous success contract.
    expect(response.status).toBe(200);
  });

  it('honors optional-session metadata for an anonymous request', async () => {
    // Given: an explicitly optional-session route.
    // When: the route is requested without a session cookie.
    const response = await fetch(
      `${baseUrl}/api/v1/auth-boundary-fixture/optional`,
    );

    // Then: the route succeeds with private no-store session semantics.
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('passes a database-backed active principal to a representative service', async () => {
    // Given: a valid identity token and current mutable authority from the DB seam.
    currentUser = { ...activeUser, role: 'STAFF' };

    // When: the unannotated route is requested with the same identity token.
    const response = await fetch(
      `${baseUrl}/api/v1/auth-boundary-fixture/unannotated`,
      { headers: { cookie: sessionCookie } },
    );

    // Then: the service receives the current account principal, including DB role.
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      userId: activeUser.id,
      githubId: githubId.toString(10),
      selectedMemberKind: MemberKind.STAFF,
      hasStaffAccess: true,
    });
  });

  it('returns 403 when an authenticated principal lacks route authority', async () => {
    // Given: a valid authenticated STUDENT principal.
    // When: the staff-only route is requested.
    const response = await fetch(
      `${baseUrl}/api/v1/auth-boundary-fixture/staff`,
      { headers: { cookie: sessionCookie } },
    );

    // Then: authentication succeeds and authority denial remains 403.
    expect(response.status).toBe(403);
  });
});
