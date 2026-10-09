import { authorityFactsFor } from '../../../users/repository/canonical-user-fixture';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { AccountStatus, AffiliationKind, MemberKind } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { AuditLogController } from '../../../audit-log/controller/audit-log.controller';
import { AuditLogRepository } from '../../../audit-log/repository/audit-log.repository';
import { AuditLogService } from '../../../audit-log/service/audit-log.service';
import { AuthConfig } from '../../../auth/auth.config';
import { AuthenticationGuard } from '../../../auth/controller/authentication.guard';
import { AuthService } from '../../../auth/service/auth.service';

type ActivePrincipal = Awaited<ReturnType<AuthService['getMe']>>;
import { sessionCookieName } from '../../../auth/domain/cookies';
import { OriginGuard } from '../../../auth/controller/origin.guard';
import { issueSessionToken } from '../../../auth/domain/session-token';
import { SessionGuard } from '../../../auth/controller/session.guard';
import { ProblemDetailFilter } from '../../../common/controller/problem-detail.filter';
import { PrismaService } from '../../../prisma/prisma.service';
import { loadRuntimeConfig } from '../../../runtime-config/runtime-config';
import type { GithubAppClient } from '../../../github/gateway/github-app.client';
import { RepositoriesRepository } from '../../../github/repository/repositories.repository';
import { RepositoriesService } from '../../../github/service/repositories.service';
import { RankingController } from '../../../ranking/controller/ranking.controller';
import { RankingRepository } from '../../../ranking/repository/ranking.repository';
import { RankingService } from '../../../ranking/service/ranking.service';
import { PublicProjectsController } from '../public-projects/public-projects.controller';
import { PublicProjectsRepository } from '../public-projects/public-projects.repository';
import { PublicProjectsService } from '../public-projects/public-projects.service';
import { PublicUserProfileController } from '../public-projects/public-user-profile.controller';
import { SubmissionRepositoryPublishingController } from '../../../submission-reviews/controller/submission-reviews.controller';
import { SubmissionReviewsRepository } from '../../../submission-reviews/repository/submission-reviews.repository';
import { SubmissionReviewsService } from '../../../submission-reviews/service/submission-reviews.service';
import { UsersAuthorityService } from '../../../users/service/authority.service';
import { UsersAuthorityRepository } from '../../../users/repository/authority.repository';
import { ProgramMetricsRepository } from '../../repository/program-metrics.repository';
import { PublicEligibilityService } from './public-eligibility.service';

const sessionSecret = new Uint8Array(32).fill(23);

const SYNTHETIC_SESSION_SECRET =
  Buffer.from(sessionSecret).toString('base64url');
export const PUBLIC_EXPOSURE_PERSONA_ALLOWED_ORIGIN =
  'http://frontend-persona.test';

function makePersonaPrincipal(githubId: bigint): ActivePrincipal {
  return {
    id: `synthetic-${githubId.toString()}`,
    githubId,
    nickname: `synthetic-${githubId.toString()}-login`,
    name: null,
    avatarUrl: null,
    accountStatus: AccountStatus.ACTIVE,
    sessionVersion: 0,
    memberKind: null,
    hasStaffAccess: false,
    hasAdminAccess: false,
    isProfileComplete: false,
  };
}

export class PublicExposurePersonaHttpHarness {
  constructor(private readonly fixtureNamespace: string) {}

  readonly prisma = new PrismaService();
  readonly metrics = new ProgramMetricsRepository(this.prisma);
  private application: INestApplication | null = null;
  private baseUrl = '';
  private sequence = 0;
  githubPublishRepositoryMock: jest.MockedFunction<
    GithubAppClient['publishRepository']
  > | null = null;

  async start(): Promise<void> {
    await this.prisma.$connect();

    const eligibilityService = new PublicEligibilityService(this.metrics);
    const publicProjectsRepository = new PublicProjectsRepository(this.prisma);
    const publicProjectsService = new PublicProjectsService(
      publicProjectsRepository,
      eligibilityService,
      this.metrics,
      loadRuntimeConfig({ SESSION_SECRET: SYNTHETIC_SESSION_SECRET }),
    );
    const rankingService = new RankingService(
      new RankingRepository(this.prisma),
    );

    const github = {
      publishRepository: jest.fn(),
    } as jest.Mocked<Pick<GithubAppClient, 'publishRepository'>>;
    const auditLogService = new AuditLogService(
      new AuditLogRepository(this.prisma),
    );
    const repositoriesRepository = new RepositoriesRepository(this.prisma);
    const repositoriesService = new RepositoriesService(
      repositoriesRepository,
      github,
      auditLogService,
    );
    const submissionReviewsService = new SubmissionReviewsService(
      new SubmissionReviewsRepository(this.prisma),
      repositoriesService,
      new UsersAuthorityService(new UsersAuthorityRepository(this.prisma)),
    );
    this.githubPublishRepositoryMock = github.publishRepository;

    const moduleRef = await Test.createTestingModule({
      controllers: [
        PublicProjectsController,
        PublicUserProfileController,
        RankingController,
        SubmissionRepositoryPublishingController,
        AuditLogController,
      ],
      providers: [
        { provide: PublicProjectsService, useValue: publicProjectsService },
        { provide: RankingService, useValue: rankingService },
        {
          provide: SubmissionReviewsService,
          useValue: submissionReviewsService,
        },
        { provide: AuditLogService, useValue: auditLogService },
        AuthenticationGuard,
        SessionGuard,
        OriginGuard,
        { provide: PrismaService, useValue: this.prisma },
        {
          provide: AuthConfig,
          useValue: {
            sessionSecret,
            allowedOrigin: PUBLIC_EXPOSURE_PERSONA_ALLOWED_ORIGIN,
            useSecureCookies: false,
          },
        },
        {
          provide: AuthService,
          useValue: {
            getMe: jest
              .fn<Promise<ActivePrincipal>, [bigint]>()
              .mockImplementation((githubId) =>
                Promise.resolve(makePersonaPrincipal(githubId)),
              ),
            findActivePrincipal: jest
              .fn<Promise<ActivePrincipal>, [bigint]>()
              .mockImplementation((githubId) =>
                Promise.resolve(makePersonaPrincipal(githubId)),
              ),
          },
        },
      ],
    }).compile();

    this.application = moduleRef.createNestApplication();
    this.application.useGlobalGuards(moduleRef.get(AuthenticationGuard));
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
    githubIdOverride?: bigint,
    memberKind?: MemberKind,
  ) {
    this.sequence += 1;
    const githubId =
      githubIdOverride ?? BigInt(this.sequence) + 8_998_000_000_000n;
    const canonicalName = `synthetic-${label}-${this.sequence}-name`;
    const canonicalDepartment = `synthetic-${label}-${this.sequence}-department`;
    const canonicalStudentId =
      memberKind === MemberKind.STUDENT
        ? String(970_000 + this.sequence)
        : null;
    return this.prisma.user.create({
      data: {
        id: `${this.fixtureNamespace}-http-${label}-${this.sequence}`,
        githubId,

        nickname: `${this.fixtureNamespace}-http-${label}-${this.sequence}-login`,
        ...authorityFactsFor(role),
        accountStatus: 'ACTIVE',
        ...(memberKind === undefined
          ? {}
          : {
              profile: {
                create: {
                  name: canonicalName,
                  studentId: canonicalStudentId,
                  department: canonicalDepartment,
                  memberKind,
                  affiliationKind:
                    memberKind === MemberKind.STUDENT
                      ? AffiliationKind.DEPARTMENT
                      : AffiliationKind.PROGRAM_OFFICE,
                  affiliationName: canonicalDepartment,
                },
              },
            }),
      },
      select: { id: true, githubId: true, nickname: true },
    });
  }

  async request(
    method: 'GET' | 'POST',
    path: string,
    githubId?: bigint,
    body?: Readonly<Record<string, unknown>>,
    options: { readonly origin?: string | false } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {};
    if (githubId !== undefined) {
      headers.cookie = await this.cookie(githubId);
    }
    if (method === 'POST') {
      headers['content-type'] = 'application/json';
      const origin =
        options.origin === undefined
          ? PUBLIC_EXPOSURE_PERSONA_ALLOWED_ORIGIN
          : options.origin;
      if (origin !== false) {
        headers.origin = origin;
      }
    }
    return fetch(`${this.baseUrl}/api/v1${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  private async cookie(githubId: bigint): Promise<string> {
    return `${sessionCookieName(false)}=${await issueSessionToken(
      sessionSecret,
      githubId,
      0,
    )}`;
  }
}
