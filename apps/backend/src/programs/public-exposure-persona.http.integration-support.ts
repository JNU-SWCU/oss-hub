import { PublicEligibilityRepository } from './public-eligibility.repository';
import { authorityFactsFor } from '../users/canonical-user-fixture';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { AccountStatus, AffiliationKind, MemberKind } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { AuditLogController } from '../admin/audit-log.controller';
import { AuditLogRepository } from '../platform/audit-log.repository';
import { AuditLogService } from '../platform/audit-log.service';
import { AuthConfig } from '../platform/auth.config';
import { AuthenticationGuard } from '../auth/authentication.guard';
import { AuthService } from '../auth/auth.service';
import { OriginGuard } from '../platform/origin.guard';
import { ProblemDetailFilter } from '../platform/problem-detail.filter';
import { PrismaService } from '../platform/prisma.service';
import { loadRuntimeConfig } from '../platform/runtime-config.config';
import type { GithubAppClient } from '../github/github-app.client';
import { RepositoriesRepository } from '../github/repositories.repository';
import { RepositoriesService } from '../github/repositories.service';
import { RankingController } from '../ranking/ranking.controller';
import { RankingRepository } from '../ranking/ranking.repository';
import { RankingService } from '../ranking/ranking.service';
import { PublicProjectsController } from './public-projects.controller';
import { PublicProjectsRepository } from './public-projects.repository';
import {
  PublicProjectsService,
  PublicEligibilityService,
} from './public-projects.service';
import { PublicUserProfileController } from './public-user-profile.controller';
import { SubmissionRepositoryPublishingController } from './submission-repository-publishing.controller';
import { SubmissionReviewsRepository } from './submission-reviews.repository';
import { SubmissionReviewsService } from './submission-reviews.service';
import { PublicProjectMetricsRepository } from './public-project-metrics.repository';
import { AuditLogMetadataService } from '../platform/audit-log-metadata.service';
import { AuthSessionService } from '../platform/auth-session.service';
import { RepositoryPublishService } from '../github/repository-publish.service';
import { RepositoryUrlService } from '../github/repository-url.service';
import { RankingYearService } from '../ranking/ranking-year.service';
import { MilestoneCompletionService } from './milestone-completion.service';
import { SubmissionFileRulesService } from './submission-file-rules.service';
import { databaseSessionPrincipal } from '../../test/global-authentication-guard.fixture';

const authSessionService = new AuthSessionService();

type ActivePrincipal = Awaited<ReturnType<AuthService['getMe']>>;

const sessionSecret = new Uint8Array(32).fill(23);

const SYNTHETIC_SESSION_SECRET =
  Buffer.from(sessionSecret).toString('base64url');
const PUBLIC_EXPOSURE_PERSONA_ALLOWED_ORIGIN = 'http://frontend-persona.test';

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
  readonly metrics = new PublicProjectMetricsRepository(this.prisma);
  readonly eligibilityMetrics = new PublicEligibilityRepository(this.prisma);
  private application: INestApplication | null = null;
  private baseUrl = '';
  private sequence = 0;
  githubPublishRepositoryMock: jest.MockedFunction<
    GithubAppClient['publishRepository']
  > | null = null;

  async start(): Promise<void> {
    await this.prisma.$connect();

    const eligibilityService = new PublicEligibilityService(
      this.eligibilityMetrics,
    );
    const publicProjectsRepository = new PublicProjectsRepository(this.prisma);
    const publicProjectsService = new PublicProjectsService(
      publicProjectsRepository,
      eligibilityService,
      this.metrics,
      loadRuntimeConfig({ SESSION_SECRET: SYNTHETIC_SESSION_SECRET }),
      new RepositoryUrlService(),
    );
    const rankingService = new RankingService(
      new RankingRepository(this.prisma),
      new RankingYearService(),
    );

    const github = {
      publishRepository: jest.fn(),
    } as jest.Mocked<Pick<GithubAppClient, 'publishRepository'>>;
    const auditLogService = new AuditLogService(
      new AuditLogRepository(this.prisma),
      new AuditLogMetadataService(),
    );
    const repositoriesRepository = new RepositoriesRepository(this.prisma);
    const repositoriesService = new RepositoriesService(
      repositoriesRepository,
      github as unknown as GithubAppClient,
      auditLogService,
      new AuditLogMetadataService(),
      new RepositoryUrlService(),
    );
    const submissionReviewsService = new SubmissionReviewsService(
      new SubmissionReviewsRepository(this.prisma),
      repositoriesService,
      new RepositoryPublishService(),
      new RepositoryUrlService(),
      new MilestoneCompletionService(),
      new SubmissionFileRulesService(),
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
        RankingYearService,
        {
          provide: SubmissionReviewsService,
          useValue: submissionReviewsService,
        },
        { provide: AuditLogService, useValue: auditLogService },
        AuthSessionService,
        AuthenticationGuard,
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
            getMe: async (githubId: bigint) => ({
              ...makePersonaPrincipal(githubId),
              ...(await databaseSessionPrincipal(this.prisma, githubId)),
            }),
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
    return `${authSessionService.sessionCookieName(false)}=${await authSessionService.issueSessionToken(
      sessionSecret,
      githubId,
      0,
    )}`;
  }
}
