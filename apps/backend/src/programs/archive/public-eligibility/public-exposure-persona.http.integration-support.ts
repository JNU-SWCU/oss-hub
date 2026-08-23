import { authorityFactsFor } from '../../../users/canonical-user-fixture';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { AffiliationKind, MemberKind } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { AuditLogController } from '../../../audit-log/audit-log.controller';
import { AuditLogRepository } from '../../../audit-log/audit-log.repository';
import { AuditLogService } from '../../../audit-log/audit-log.service';
import { AuthConfig } from '../../../auth/auth.config';
import { AuthService } from '../../../auth/auth.service';
import { sessionCookieName } from '../../../auth/cookies';
import { OriginGuard } from '../../../auth/origin.guard';
import { issueSessionToken } from '../../../auth/session-token';
import { SessionGuard } from '../../../auth/session.guard';
import { ProblemDetailFilter } from '../../../common/problem-detail.filter';
import { PrismaService } from '../../../prisma/prisma.service';
import { loadRuntimeConfig } from '../../../runtime-config/runtime-config';
import type { GithubAppClient } from '../../../github/github-app.client';
import { RepositoriesRepository } from '../../../github/repository/repositories.repository';
import { RepositoriesService } from '../../../github/service/repositories.service';
import { RankingController } from '../../../ranking/controller/ranking.controller';
import { RankingRepository } from '../../../ranking/repository/ranking.repository';
import { RankingService } from '../../../ranking/service/ranking.service';
import { PublicProjectsController } from '../public-projects/public-projects.controller';
import { PublicProjectsRepository } from '../public-projects/public-projects.repository';
import { PublicProjectsService } from '../public-projects/public-projects.service';
import { PublicUserProfileController } from '../public-projects/public-user-profile.controller';
import { SubmissionRepositoryPublishingController } from '../../../submission-reviews/submission-reviews.controller';
import { SubmissionReviewsRepository } from '../../../submission-reviews/submission-reviews.repository';
import { SubmissionReviewsService } from '../../../submission-reviews/submission-reviews.service';
import { SubmissionReviewsStaffGuard } from '../../../submission-reviews/submission-reviews-staff.guard';
import { ProgramMetricsRepository } from '../../repository/program-metrics.repository';
import { PublicEligibilityService } from './public-eligibility.service';

const sessionSecret = new Uint8Array(32).fill(23);
/**
 * QA40 — 공개 프로젝트 커서 키는 배포에서도 `SESSION_SECRET`에서 파생하므로, harness도
 * 위 세션 시크릿을 그대로 base64url로 넘겨 실제 배선과 같은 경로를 탄다.
 */
const SYNTHETIC_SESSION_SECRET =
  Buffer.from(sessionSecret).toString('base64url');
export const PUBLIC_EXPOSURE_PERSONA_ALLOWED_ORIGIN =
  'http://frontend-persona.test';

/**
 * 계획 todo 23 — HTTP 4-페르소나(익명/STUDENT/STAFF/ADMIN) 매트릭스 전용 harness.
 * `AdminAccessHttpHarness`(`../users/admin-access.http.integration-support.ts`)와 동일한
 * 관행을 따른다 — 서비스는 Nest DI 없이 직접 `new`로 조립해 `useValue`로 등록하고, 가드만
 * Nest DI로 실제 인스턴스화한다(guard mocking 없음, 실제 SessionGuard/OriginGuard/
 * SubmissionReviewsStaffGuard가 실제 쿠키/세션/역할을 검사한다).
 */
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
      { requireOrganization: () => 'synthetic-org' },
    );
    const submissionReviewsService = new SubmissionReviewsService(
      new SubmissionReviewsRepository(this.prisma),
      repositoriesService,
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
        SessionGuard,
        OriginGuard,
        SubmissionReviewsStaffGuard,
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

  /**
   * `memberKind`를 주면 canonical `UserProfile`까지 같이 심는다 — 순위 노출은 권한이
   * 아니라 이 칸이 정하므로, 회원 유형을 입어야 persona가 랭킹을 대표할 수 있다.
   *
   * legacy 칸과 canonical 행을 반드시 같은 값으로 둔다 — 공유 PostgreSQL 을 쓰는 통합
   * 실행에서 형제 스펙이 돌리는 backfill 불변식이 불일치 행 하나로 전체를 멈추기 때문이다.
   */
  async createUser(
    label: string,
    role: 'STUDENT' | 'STAFF' | 'ADMIN' | null  ,
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
        // id와 nickname을 의도적으로 다른 문자열로 둔다 — audit-log 응답의 `actor`는
        // `AuditLog.actorId`가 가리키는 User의 **nickname**이지 raw internal id가 아니다
        // (`audit-log.repository.ts`: `actor: log.actor.nickname`). id와 nickname이 같은
        // 문자열이면 "actor가 raw id가 아니다"라는 단언이 항상 공허하게 실패해 이 구분을
        // 증명하지 못한다.
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
    )}`;
  }
}
