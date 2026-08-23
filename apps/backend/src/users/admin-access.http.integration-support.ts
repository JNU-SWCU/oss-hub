import { canonicalUserCreateFromLabel } from './canonical-user-fixture';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import type { AccountStatus } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { AuditLogRepository } from '../audit-log/audit-log.repository';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuthConfig } from '../auth/auth.config';
import { AuthService } from '../auth/auth.service';
import { sessionCookieName } from '../auth/cookies';
import { OriginGuard } from '../auth/origin.guard';
import { issueSessionToken } from '../auth/session-token';
import { SessionGuard } from '../auth/session.guard';
import { ProblemDetailFilter } from '../common/problem-detail.filter';
import { PrismaService } from '../prisma/prisma.service';
import { AdminAccessController } from './admin-access.controller';
import { AdminAccessRepository } from './admin-access.repository';
import { AdminAccessService } from './admin-access.service';
import { AdminProfileRepository } from './admin-profile.repository';
import { AdminProfileService } from './admin-profile.service';

const sessionSecret = new Uint8Array(32).fill(17);
export const ADMIN_ACCESS_ALLOWED_ORIGIN = 'http://frontend.test';

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
      controllers: [AdminAccessController],
      providers: [
        AdminAccessService,
        AdminAccessRepository,
        AdminProfileService,
        AdminProfileRepository,
        AuditLogService,
        AuditLogRepository,
        SessionGuard,
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
          useValue: { getMe: jest.fn().mockResolvedValue({ id: 'synthetic' }) },
        },
      ],
    }).compile();
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
    role: 'STUDENT' | 'STAFF' | 'ADMIN' | null  ,
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
    return `${sessionCookieName(false)}=${await issueSessionToken(
      sessionSecret,
      githubId,
    )}`;
  }
}
