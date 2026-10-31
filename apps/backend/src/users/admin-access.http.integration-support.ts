import { STATELESS_PROVIDERS } from '../../test/stateless-providers.fixture';
import { canonicalUserCreateFromLabel } from './canonical-user-fixture';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import type { AccountStatus } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { AuditLogRepository } from '../platform/audit-log.repository';
import { AuditLogService } from '../platform/audit-log.service';
import { AuthConfig } from '../platform/auth.config';
import { AuthService } from '../auth/auth.service';
import { OriginGuard } from '../platform/origin.guard';
import { ProblemDetailFilter } from '../platform/problem-detail.filter';
import { PrismaService } from '../platform/prisma.service';
import { AccessRequestsController } from '../staff/access-requests.controller';
import { UserAccessController } from '../admin/user-access.controller';
import { AdminAccessRepository } from './admin-access.repository';
import { AdminAccessService } from './admin-access.service';
import { AdminProfileRepository } from './admin-profile.repository';
import { AdminProfileService } from './admin-profile.service';
import { AuthSessionService } from '../platform/auth-session.service';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';
import { UserProfileService } from './user-profile.service';
import { AdminAccessMutationService } from './admin-access-mutation.service';
import { AdminProfileMutationService } from './admin-profile-mutation.service';
import {
  GLOBAL_AUTHENTICATION_GUARD_PROVIDERS,
  databaseSessionPrincipal,
} from '../../test/global-authentication-guard.fixture';

const authSessionService = new AuthSessionService();

const sessionSecret = new Uint8Array(32).fill(17);
const ADMIN_ACCESS_ALLOWED_ORIGIN = 'http://frontend.test';

export class AdminAccessHttpHarness {
  constructor(
    private readonly fixtureNamespace: string,
    private readonly githubIdBase: bigint,
  ) {}

  readonly prisma = new PrismaService();
  private application: INestApplication | null = null;
  private baseUrl = '';
  private sequence = 0;

  async start(): Promise<void> {
    await this.prisma.$connect();
    const moduleRef = await Test.createTestingModule({
      controllers: [UserAccessController, AccessRequestsController],
      providers: [
        ...STATELESS_PROVIDERS,
        AdminAccessService,
        AdminAccessRepository,
        AdminAccessMutationService,
        AdminProfileService,
        AdminProfileRepository,
        AdminProfileMutationService,
        AuditLogService,
        AuditLogRepository,
        AuditLogMetadataService,
        UserProfileService,
        AuthSessionService,
        ...GLOBAL_AUTHENTICATION_GUARD_PROVIDERS,
        OriginGuard,
        { provide: PrismaService, useValue: this.prisma },
        {
          provide: AuthConfig,
          useValue: {
            sessionSecret,
            allowedOrigin: ADMIN_ACCESS_ALLOWED_ORIGIN,
            useSecureCookies: false,
          },
        },
        {
          provide: AuthService,
          useValue: {
            getMe: (githubId: bigint) =>
              databaseSessionPrincipal(this.prisma, githubId),
          },
        },
      ],
    })
      .useMocker((token) => (token === Function ? undefined : {}))
      .compile();
    this.application = moduleRef.createNestApplication();
    this.application.setGlobalPrefix('api/v1');
    this.application.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    this.application.useGlobalFilters(new ProblemDetailFilter());
    await this.application.listen(0, '127.0.0.1');
    this.baseUrl = await this.application.getUrl();
  }

  async stop(): Promise<void> {
    await this.application?.close();
    await this.prisma.$disconnect();
  }

  async createUser(
    label: string,
    role: 'STUDENT' | 'STAFF' | 'ADMIN' | null,
    accountStatus: AccountStatus,
  ) {
    this.sequence += 1;
    return this.prisma.user.create({
      data: canonicalUserCreateFromLabel(role, {
        id: `test:pr03:admin-access-http:${this.fixtureNamespace}:${label}:${this.sequence}`,
        githubId: this.githubIdBase + BigInt(this.sequence),
        nickname: `synthetic-http-${label}-${this.sequence}`,
        accountStatus,
      }),
      select: { id: true, githubId: true, nickname: true },
    });
  }

  async request(
    method: 'GET' | 'PATCH',
    path: string,
    githubId?: bigint,
    body?: Readonly<Record<string, unknown>>,
  ): Promise<Response> {
    const headers: Record<string, string> = {};
    if (githubId !== undefined) {
      headers.cookie = await this.cookie(githubId);
    }
    if (method === 'PATCH') {
      headers.origin = ADMIN_ACCESS_ALLOWED_ORIGIN;
      headers['content-type'] = 'application/json';
    }
    return fetch(`${this.baseUrl}/api/v1${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  async createPendingRequest(userId: string) {
    return this.prisma.staffAccessRequest.create({
      data: {
        id: `${userId}:pending`,
        userId,
        status: 'PENDING',
      },
      select: { id: true },
    });
  }

  async demoteAllActiveAdmins(): Promise<void> {
    await this.prisma.user.updateMany({
      where: { hasAdminAccess: true, accountStatus: 'ACTIVE' },
      data: { hasAdminAccess: false, hasStaffAccess: true },
    });
  }

  private async cookie(githubId: bigint): Promise<string> {
    return `${authSessionService.sessionCookieName(false)}=${await authSessionService.issueSessionToken(
      sessionSecret,
      githubId,
      0,
    )}`;
  }
}
