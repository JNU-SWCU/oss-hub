import {
  AffiliationKind,
  ApplicationStatus,
  CollectionRepositoryPresence,
  MemberKind,
  ProgramCategory,
  RepositoryProvisionJobStatus,
  RepositorySource,
  RepositoryVisibility,
  ProgramTrackType,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../../../test/integration-database.guard';
import { AuditLogRepository } from '../../../audit-log/repository/audit-log.repository';
import { AuditLogService } from '../../../audit-log/service/audit-log.service';
import { REPOSITORY_PUBLISH_AUDIT_ACTIONS } from '../../../audit-log/domain/audit-log-metadata';
import {
  repositoryNameFromNameWithOwner,
  repositoryUrlFromNameWithOwner,
} from '../../../github/repository-identity';
import { PrismaService } from '../../../prisma/prisma.service';
import { ProgramMetricsRepository } from '../../repository/program-metrics.repository';
import { loadRuntimeConfig } from '../../../runtime-config/runtime-config';
import type { GithubAppClient } from '../../../github/github-app.client';
import { RepositoriesRepository } from '../../../github/repository/repositories.repository';
import { RepositoriesService } from '../../../github/service/repositories.service';
import { RankingRepository } from '../../../ranking/repository/ranking.repository';
import { RankingService } from '../../../ranking/service/ranking.service';
import { PublicProjectsErrorCode } from '../public-projects/public-projects-error-code.enum';
import { PublicProjectsRepository } from '../public-projects/public-projects.repository';
import { PublicProjectsService } from '../public-projects/public-projects.service';
import { SubmissionReviewsErrorCode } from '../../../submission-reviews/submission-reviews-error-code.enum';
import { SubmissionReviewsRepository } from '../../../submission-reviews/submission-reviews.repository';
import { SubmissionReviewsService } from '../../../submission-reviews/submission-reviews.service';
import { UsersAuthorityService } from '../../../users/service/authority.service';
import { UsersAuthorityRepository } from '../../../users/repository/authority.repository';
import { PublicEligibilityService } from './public-eligibility.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const SYNTHETIC_SESSION_SECRET = Buffer.from(
  'synthetic-public-projects-integration-secret',
).toString('base64url');

const prisma = new PrismaService();
const metrics = new ProgramMetricsRepository(prisma);
const eligibilityService = new PublicEligibilityService(metrics);
const publicProjectsRepository = new PublicProjectsRepository(prisma);
const publicProjectsService = new PublicProjectsService(
  publicProjectsRepository,
  eligibilityService,
  metrics,
  loadRuntimeConfig({ SESSION_SECRET: SYNTHETIC_SESSION_SECRET }),
);
const rankingService = new RankingService(new RankingRepository(prisma));

const github = {
  publishRepository: jest.fn(),
} as jest.Mocked<Pick<GithubAppClient, 'publishRepository'>>;
const auditLogService = new AuditLogService(new AuditLogRepository(prisma));
const repositoriesRepository = new RepositoriesRepository(prisma);
const organizationConfig = { requireOrganization: () => 'synthetic-org' };
const repositoriesService = new RepositoriesService(
  repositoriesRepository,
  github,
  auditLogService,
  organizationConfig,
);
const submissionReviewsService = new SubmissionReviewsService(
  new SubmissionReviewsRepository(prisma),
  repositoriesService,
  new UsersAuthorityService(new UsersAuthorityRepository(prisma)),
);

const PREFIX = 'synthetic-exposure-matrix';
const now = () => new Date();

const RANKING_PAGE_SIZE = 100;

async function collectRankingEntries(): Promise<
  Awaited<ReturnType<typeof rankingService.findPage>>['items']
> {
  const first = await rankingService.findPage(
    'all',
    1,
    RANKING_PAGE_SIZE,
    null,
  );
  const items = [...first.items];
  const pageCount = Math.ceil(first.total / RANKING_PAGE_SIZE);
  for (let page = 2; page <= pageCount; page += 1) {
    const next = await rankingService.findPage(
      'all',
      page,
      RANKING_PAGE_SIZE,
      null,
    );
    items.push(...next.items);
  }
  return items;
}

const PROGRAM_ENDED_ID = `${PREFIX}-program-ended`;
const PROGRAM_NOT_ENDED_ID = `${PREFIX}-program-not-ended`;

const REVIEWER_ID = `${PREFIX}-reviewer`;
const REVIEWER_GITHUB_ID = 8_999_000_000_000n;

const GITHUB_ID_BASE = 8_910_000_000_000n;
const REPOSITORY_ID_BASE = 8_920_000_000_000n;
let githubIdSequence = 0n;
let repositoryIdSequence = 0n;

function nextGithubId(): bigint {
  githubIdSequence += 1n;
  return GITHUB_ID_BASE + githubIdSequence;
}

function nextGithubRepositoryId(): bigint {
  repositoryIdSequence += 1n;
  return REPOSITORY_ID_BASE + repositoryIdSequence;
}

let studentIdSequence = 910_000;

function canonicalStudentFields(name: string, department: string) {
  studentIdSequence += 1;
  const studentId = String(studentIdSequence);
  return {
    profile: {
      create: {
        name,
        studentId,
        department,
        memberKind: MemberKind.STUDENT,
        affiliationKind: AffiliationKind.DEPARTMENT,
        affiliationName: department,
      },
    },
  };
}

function applicantProfileFields(key: string) {
  return canonicalStudentFields(
    `synthetic-${key}-applicant-name`,
    `synthetic-${key}-applicant-department`,
  );
}

function contributorProfileFields(githubId: bigint) {
  const suffix = githubId.toString();
  return canonicalStudentFields(
    `synthetic-contributor-${suffix}-name`,
    `synthetic-contributor-${suffix}-department`,
  );
}

async function createScenario(params: {
  readonly key: string;
  readonly programId: string;
  readonly isRepositoryPublicationPlanned: boolean;
  readonly visibility: RepositoryVisibility;
  readonly publishedAt: Date | null;
  readonly provisionStatus?: RepositoryProvisionJobStatus;
}): Promise<{
  readonly applicantId: string;
  readonly applicationId: string;
  readonly repositoryId: string;
  readonly githubRepositoryId: bigint;
  readonly nameWithOwner: string;
  readonly repositoryName: string;
}> {
  const applicantId = `${PREFIX}-${params.key}-applicant`;
  await prisma.user.create({
    data: {
      id: applicantId,
      githubId: nextGithubId(),
      nickname: `${PREFIX}-${params.key}-applicant-login`,
      selectedMemberKind: MemberKind.STUDENT,

      ...applicantProfileFields(params.key),
    },
  });

  const applicationId = `${PREFIX}-${params.key}-application`;
  const teamId = `${PREFIX}-${params.key}-team`;
  await prisma.team.create({
    data: {
      id: teamId,
      programId: params.programId,
      name: `${PREFIX}-${params.key}-team`,
      joinCodeDigest: `${PREFIX}-${params.key}-team-digest`,
      leaderId: applicantId,
    },
  });
  await prisma.teamMember.create({
    data: {
      id: `${PREFIX}-${params.key}-team-member`,
      teamId,
      programId: params.programId,
      userId: applicantId,
    },
  });
  await prisma.application.create({
    data: {
      id: applicationId,
      programId: params.programId,
      applicantId,
      teamId,
      answers: { syntheticFixture: true },
      applicationTemplateVersion: 1,
      status: ApplicationStatus.APPROVED,
      isRepositoryPublicationPlanned: params.isRepositoryPublicationPlanned,
      processedAt: now(),
    },
  });

  const repositoryId = `${PREFIX}-${params.key}-repository`;
  const githubRepositoryId = nextGithubRepositoryId();
  const nameWithOwner = `synthetic-org/${PREFIX}-${params.key}`;
  await prisma.githubRepository.create({
    data: {
      id: repositoryId,
      applicationId,
      programId: params.programId,
      githubRepositoryId,
      nameWithOwner,
      source: RepositorySource.ORG_PROVISIONED,
      visibility: params.visibility,
      presence: CollectionRepositoryPresence.PRESENT,
      publishedAt: params.publishedAt,
    },
  });

  await prisma.repositoryProvisionJob.create({
    data: {
      id: `${PREFIX}-${params.key}-job`,
      applicationId,
      repositoryId,
      status: params.provisionStatus ?? RepositoryProvisionJobStatus.SUCCEEDED,
      nextAttemptAt: now(),
      startedAt: now(),
      finishedAt: now(),
    },
  });

  return {
    applicantId,
    applicationId,
    repositoryId,
    githubRepositoryId,
    nameWithOwner,
    repositoryName: repositoryNameFromNameWithOwner(nameWithOwner),
  };
}

async function observeCollection(params: {
  readonly githubRepositoryId: bigint;
  readonly visibility: RepositoryVisibility;
  readonly presence: CollectionRepositoryPresence;
  readonly observedAt: Date | null;
}): Promise<void> {
  await prisma.githubRepository.update({
    where: { githubRepositoryId: params.githubRepositoryId },
    data: {
      githubOrganizationId: 8_900_000_000_000n,
      defaultBranch: 'main',
      archived: false,
      visibility: params.visibility,
      presence: params.presence,
      lastCompleteInventoryObservedAt: params.observedAt,
    },
  });
}

async function seedContributors(
  repositoryId: string,
  ownerGithubId: bigint,
  ownerLogin: string,
  otherGithubId: bigint,
  otherLogin: string,
): Promise<void> {
  for (const [githubId, nickname] of [
    [ownerGithubId, ownerLogin],
    [otherGithubId, otherLogin],
  ] as const) {
    await prisma.user.upsert({
      where: { githubId },
      update: { nickname },
      create: {
        id: `${PREFIX}-contributor-${githubId.toString()}`,
        githubId,
        nickname,
        selectedMemberKind: MemberKind.STUDENT,
        ...contributorProfileFields(githubId),
      },
    });
  }

  await prisma.contribution.createMany({
    data: [
      {
        repositoryId,
        githubId: ownerGithubId,
        date: new Date(Date.UTC(2026, 0, 2)),
        commitCount: 5,
        pullRequestCount: 2,
        releaseCount: 1,
      },
      {
        repositoryId,
        githubId: otherGithubId,
        date: new Date(Date.UTC(2026, 0, 2)),
        commitCount: 3,
        pullRequestCount: 1,
        releaseCount: 0,
      },
    ],
  });
}

const PUBLISHED_AT = new Date('2026-06-01T00:00:00.000Z');
const BEFORE_PUBLISH = new Date('2026-05-01T00:00:00.000Z');
const AFTER_PUBLISH = new Date('2026-06-15T00:00:00.000Z');

let outcome1: Awaited<ReturnType<typeof createScenario>>;
let outcome2: Awaited<ReturnType<typeof createScenario>>;
let outcome3: Awaited<ReturnType<typeof createScenario>>;
let outcome4: Awaited<ReturnType<typeof createScenario>>;
let outcome5: Awaited<ReturnType<typeof createScenario>>;
let outcome6: Awaited<ReturnType<typeof createScenario>>;
let outcome7: Awaited<ReturnType<typeof createScenario>>;
let outcome8: Awaited<ReturnType<typeof createScenario>>;

describe('public/admin exposure matrix (todo 23) — outcome 1–9', () => {
  beforeAll(async () => {
    await prisma.$connect();

    await prisma.program.create({
      data: {
        id: PROGRAM_ENDED_ID,
        name: `${PREFIX}-program-ended`,
        organizer: 'synthetic-organizer',
        trackType: ProgramTrackType.EXTRACURRICULAR,
        category: ProgramCategory.BASIC,
        applicationTemplateKey: 'synthetic-template',
        applicationTemplateVersion: 1,
        applicationStartAt: new Date('2026-01-01T00:00:00.000Z'),
        applicationEndAt: new Date('2026-02-01T00:00:00.000Z'),
        startAt: new Date('2026-02-02T00:00:00.000Z'),
        endAt: new Date('2026-05-15T00:00:00.000Z'),
        description: 'synthetic-description — program already ended',
      },
    });
    await prisma.program.create({
      data: {
        id: PROGRAM_NOT_ENDED_ID,
        name: `${PREFIX}-program-not-ended`,
        organizer: 'synthetic-organizer',
        trackType: ProgramTrackType.EXTRACURRICULAR,
        category: ProgramCategory.BASIC,
        applicationTemplateKey: 'synthetic-template',
        applicationTemplateVersion: 1,
        applicationStartAt: new Date('2026-01-01T00:00:00.000Z'),
        applicationEndAt: new Date('2026-02-01T00:00:00.000Z'),
        startAt: new Date('2026-02-02T00:00:00.000Z'),
        endAt: new Date('2027-05-15T00:00:00.000Z'),
        description: 'synthetic-description — program never ended',
      },
    });

    await prisma.user.create({
      data: {
        id: REVIEWER_ID,
        githubId: REVIEWER_GITHUB_ID,
        nickname: `${PREFIX}-reviewer-login`,
        hasAdminAccess: true,
      },
    });

    outcome1 = await createScenario({
      key: 'outcome-1',
      programId: PROGRAM_ENDED_ID,
      isRepositoryPublicationPlanned: true,
      visibility: RepositoryVisibility.PRIVATE,
      publishedAt: null,
    });

    outcome2 = await createScenario({
      key: 'outcome-2',
      programId: PROGRAM_ENDED_ID,
      isRepositoryPublicationPlanned: true,
      visibility: RepositoryVisibility.PUBLIC,
      publishedAt: PUBLISHED_AT,
    });
    await observeCollection({
      githubRepositoryId: outcome2.githubRepositoryId,
      visibility: RepositoryVisibility.PUBLIC,
      presence: CollectionRepositoryPresence.PRESENT,
      observedAt: AFTER_PUBLISH,
    });
    await seedContributors(
      outcome2.repositoryId,
      GITHUB_ID_BASE + 900_001n,
      `${PREFIX}-outcome-2-owner-login`,
      GITHUB_ID_BASE + 900_002n,
      `${PREFIX}-outcome-2-other-login`,
    );

    outcome3 = await createScenario({
      key: 'outcome-3',
      programId: PROGRAM_ENDED_ID,
      isRepositoryPublicationPlanned: true,
      visibility: RepositoryVisibility.PUBLIC,
      publishedAt: PUBLISHED_AT,
    });

    outcome4 = await createScenario({
      key: 'outcome-4',
      programId: PROGRAM_ENDED_ID,
      isRepositoryPublicationPlanned: true,
      visibility: RepositoryVisibility.PRIVATE,
      publishedAt: null,
    });
    await observeCollection({
      githubRepositoryId: outcome4.githubRepositoryId,
      visibility: RepositoryVisibility.PRIVATE,
      presence: CollectionRepositoryPresence.PRESENT,
      observedAt: BEFORE_PUBLISH,
    });
    await prisma.githubRepository.update({
      where: { id: outcome4.repositoryId },
      data: {
        visibility: RepositoryVisibility.PUBLIC,
        publishedAt: PUBLISHED_AT,
      },
    });

    await seedContributors(
      outcome4.repositoryId,
      GITHUB_ID_BASE + 900_005n,
      `${PREFIX}-outcome-4-applicant-login`,
      GITHUB_ID_BASE + 900_006n,
      `${PREFIX}-outcome-4-other-login`,
    );

    outcome5 = await createScenario({
      key: 'outcome-5',
      programId: PROGRAM_ENDED_ID,
      isRepositoryPublicationPlanned: true,
      visibility: RepositoryVisibility.PUBLIC,
      publishedAt: PUBLISHED_AT,
    });
    await observeCollection({
      githubRepositoryId: outcome5.githubRepositoryId,
      visibility: RepositoryVisibility.PRIVATE,
      presence: CollectionRepositoryPresence.ABSENT,
      observedAt: AFTER_PUBLISH,
    });
    await seedContributors(
      outcome5.repositoryId,
      GITHUB_ID_BASE + 900_007n,
      `${PREFIX}-outcome-5-applicant-login`,
      GITHUB_ID_BASE + 900_008n,
      `${PREFIX}-outcome-5-other-login`,
    );

    outcome6 = await createScenario({
      key: 'outcome-6',
      programId: PROGRAM_ENDED_ID,
      isRepositoryPublicationPlanned: false,
      visibility: RepositoryVisibility.PRIVATE,
      publishedAt: null,
    });
    await seedContributors(
      outcome6.repositoryId,
      GITHUB_ID_BASE + 900_009n,
      `${PREFIX}-outcome-6-applicant-login`,
      GITHUB_ID_BASE + 900_010n,
      `${PREFIX}-outcome-6-other-login`,
    );

    outcome7 = await createScenario({
      key: 'outcome-7',
      programId: PROGRAM_NOT_ENDED_ID,
      isRepositoryPublicationPlanned: true,
      visibility: RepositoryVisibility.PRIVATE,
      publishedAt: null,
    });
    await seedContributors(
      outcome7.repositoryId,
      GITHUB_ID_BASE + 900_011n,
      `${PREFIX}-outcome-7-applicant-login`,
      GITHUB_ID_BASE + 900_012n,
      `${PREFIX}-outcome-7-other-login`,
    );

    outcome8 = await createScenario({
      key: 'outcome-8',
      programId: PROGRAM_ENDED_ID,
      isRepositoryPublicationPlanned: true,
      visibility: RepositoryVisibility.PRIVATE,
      publishedAt: null,
    });
    await seedContributors(
      outcome8.repositoryId,
      GITHUB_ID_BASE + 900_003n,
      `${PREFIX}-outcome-8-owner-login`,
      GITHUB_ID_BASE + 900_004n,
      `${PREFIX}-outcome-8-other-login`,
    );
  });

  afterAll(async () => {
    try {
      await prisma.contribution.deleteMany({
        where: { repositoryId: { startsWith: `${PREFIX}-` } },
      });
      await prisma.repositoryProvisionJob.deleteMany({
        where: { id: { startsWith: `${PREFIX}-` } },
      });

      await prisma.githubRepository.deleteMany({
        where: { id: { startsWith: `${PREFIX}-` } },
      });
      await prisma.application.deleteMany({
        where: { id: { startsWith: `${PREFIX}-` } },
      });
      await prisma.teamMember.deleteMany({
        where: { id: { startsWith: `${PREFIX}-` } },
      });
      await prisma.team.deleteMany({
        where: { id: { startsWith: `${PREFIX}-` } },
      });

      await prisma.user.deleteMany({
        where: { id: { startsWith: `${PREFIX}-` }, NOT: { id: REVIEWER_ID } },
      });
      await prisma.program.deleteMany({
        where: { id: { in: [PROGRAM_ENDED_ID, PROGRAM_NOT_ENDED_ID] } },
      });
    } finally {
      await prisma.$disconnect();
    }
  });

  it(
    'outcome-1: platform-private 저장소는 발행 전이라 list/detail/profile에는 나타나지 ' +
      '않지만, 가입자 전원 노출 정책상 ranking에는 0/0/0 행으로 나타난다(집계 대상 ' +
      '저장소가 아니므로 비공개 활동은 새지 않는다)',
    async () => {
      const page = await publicProjectsService.findPage(undefined, 50);
      expect(page.items.some((item) => item.id === outcome1.repositoryId)).toBe(
        false,
      );

      await expect(
        publicProjectsService.findDetail(
          outcome1.githubRepositoryId.toString(),
        ),
      ).rejects.toMatchObject({
        errorCode: { code: PublicProjectsErrorCode.PROJECT_NOT_FOUND },
      });

      await expect(
        publicProjectsService.findProfile(outcome1.applicantId),
      ).rejects.toMatchObject({
        errorCode: { code: PublicProjectsErrorCode.USER_PROFILE_NOT_FOUND },
      });

      const rankingEntries = await collectRankingEntries();
      const outcome1Entry = rankingEntries.find(
        (entry) => entry.githubLogin === `${PREFIX}-outcome-1-applicant-login`,
      );
      expect(outcome1Entry).toBeDefined();
      expect(outcome1Entry).toMatchObject({
        commitCount: 0,
        pullRequestCount: 0,
        issueCount: 0,
        repositoryCount: 0,
        starCount: 0,
        total: 0,
      });
    },
  );

  it('outcome-2: 발행 후 collection이 최신 관측으로 PUBLIC/PRESENT를 확인하면 list/detail/profile/ranking 전부에 노출되고 기여자 2명이 정확히 분리된다', async () => {
    const page = await publicProjectsService.findPage(undefined, 50);
    expect(page.items.some((item) => item.id === outcome2.repositoryId)).toBe(
      true,
    );

    const detail = await publicProjectsService.findDetail(
      outcome2.githubRepositoryId.toString(),
    );
    expect(detail.contributors).toHaveLength(2);
    expect(detail.contributors.map((c) => c.githubLogin).sort()).toEqual(
      [
        `${PREFIX}-outcome-2-owner-login`,
        `${PREFIX}-outcome-2-other-login`,
      ].sort(),
    );

    const profile = await publicProjectsService.findProfile(
      outcome2.applicantId,
    );
    expect(profile.projects).toHaveLength(1);
    expect(profile.projects[0]?.observed).toBe(true);

    const rankedLogins = (await collectRankingEntries()).map(
      (entry) => entry.githubLogin,
    );
    expect(rankedLogins).toEqual(
      expect.arrayContaining([
        `${PREFIX}-outcome-2-owner-login`,
        `${PREFIX}-outcome-2-other-login`,
      ]),
    );
  });

  it(
    "outcome-3 [알려진 갭 — report-don't-fix]: 발행됐지만 collection이 아직 " +
      '한 번도 (재)관측하지 않은 저장소도 list/detail/profile에는 보이고, #617 단계 D 이후 ' +
      'presence가 provisioning 시점부터 PRESENT라 profile에서도 observed: true(수치 0/0/0)로 ' +
      '판정된다 — 실제 inventory sweep 없이도 관측된 것처럼 보이는 것이 옛 2테이블 설계 대비 ' +
      '동작 변화이며, "그래야 한다"가 아니라 "지금 그렇다"의 characterization이다',
    async () => {
      const page = await publicProjectsService.findPage(undefined, 50);
      expect(page.items.some((item) => item.id === outcome3.repositoryId)).toBe(
        true,
      );

      await expect(
        publicProjectsService.findDetail(
          outcome3.githubRepositoryId.toString(),
        ),
      ).resolves.toMatchObject({ row: { id: outcome3.repositoryId } });

      const profile = await publicProjectsService.findProfile(
        outcome3.applicantId,
      );
      expect(profile.projects).toHaveLength(1);

      expect(profile.projects[0]?.observed).toBe(true);
      expect(profile.projects[0]?.metrics).toEqual({
        commitCount: 0,
        pullRequestCount: 0,
        releaseCount: 0,
      });

      expect(profile.projects[0]?.hasCollectedData).toBe(false);

      const rankingEntries = await collectRankingEntries();
      const outcome3Entry = rankingEntries.find(
        (entry) => entry.githubLogin === `${PREFIX}-outcome-3-applicant-login`,
      );
      expect(outcome3Entry).toBeDefined();
      expect(outcome3Entry).toMatchObject({
        commitCount: 0,
        pullRequestCount: 0,
        issueCount: 0,
        repositoryCount: 0,
        starCount: 0,
        total: 0,
      });
    },
  );

  it(
    'outcome-4: collection이 PRIVATE/PRESENT로 관측했고 그 관측이 발행 이전(stale)이면 ' +
      'list/detail/profile은 그대로 노출하고(stale-allow), ranking은 저장소 축 기여를 ' +
      '아예 읽지 않으므로 이 비공개(PRIVATE) 저장소 활동이 공개 랭킹으로 새지 않는다',
    async () => {
      const page = await publicProjectsService.findPage(undefined, 50);
      expect(page.items.some((item) => item.id === outcome4.repositoryId)).toBe(
        true,
      );

      await expect(
        publicProjectsService.findDetail(
          outcome4.githubRepositoryId.toString(),
        ),
      ).resolves.toMatchObject({ row: { id: outcome4.repositoryId } });

      const rankingEntries = await collectRankingEntries();
      const outcome4Entry = rankingEntries.find(
        (entry) => entry.githubLogin === `${PREFIX}-outcome-4-applicant-login`,
      );
      expect(outcome4Entry).toBeDefined();
      expect(outcome4Entry).toMatchObject({
        commitCount: 0,
        pullRequestCount: 0,
        issueCount: 0,
        repositoryCount: 0,
        starCount: 0,
        total: 0,
      });
    },
  );

  it(
    'outcome-5: collection이 private/missing으로 관측했고 발행 이후(out-of-band 변경)면 ' +
      '즉시 회수되어 list/detail/profile에는 없고, ranking은 저장소 축을 읽지 않으므로 ' +
      '가입자 행은 있으나 5종 전부 0이다',
    async () => {
      const page = await publicProjectsService.findPage(undefined, 50);
      expect(page.items.some((item) => item.id === outcome5.repositoryId)).toBe(
        false,
      );

      await expect(
        publicProjectsService.findDetail(
          outcome5.githubRepositoryId.toString(),
        ),
      ).rejects.toMatchObject({
        errorCode: { code: PublicProjectsErrorCode.PROJECT_NOT_FOUND },
      });

      await expect(
        publicProjectsService.findProfile(outcome5.applicantId),
      ).rejects.toMatchObject({
        errorCode: { code: PublicProjectsErrorCode.USER_PROFILE_NOT_FOUND },
      });

      const rankingEntries = await collectRankingEntries();
      const outcome5Entry = rankingEntries.find(
        (entry) => entry.githubLogin === `${PREFIX}-outcome-5-applicant-login`,
      );
      expect(outcome5Entry).toBeDefined();
      expect(outcome5Entry).toMatchObject({
        commitCount: 0,
        pullRequestCount: 0,
        issueCount: 0,
        repositoryCount: 0,
        starCount: 0,
        total: 0,
      });
    },
  );

  it(
    "outcome-6 [알려진 갭 — report-don't-fix]: 공개 계획이 OFF라 수동 공개가 " +
      'REPOSITORY_PUBLICATION_NOT_PLANNED로 막혀 platform Repository는 PRIVATE로 남지만, ' +
      'ranking 공개 라우트는 platform 결정과 무관하게 collection 관측(PUBLIC/PRESENT)만 보고 ' +
      '기여자 활동을 그대로 노출한다 — list/detail/profile은 올바르게 숨긴다',
    async () => {
      await expect(
        submissionReviewsService.publishRepository(
          outcome6.repositoryId,
          REVIEWER_GITHUB_ID,
        ),
      ).rejects.toMatchObject({
        errorCode: {
          code: SubmissionReviewsErrorCode.REPOSITORY_PUBLICATION_NOT_PLANNED,
        },
      });

      const persisted = await prisma.githubRepository.findUniqueOrThrow({
        where: { id: outcome6.repositoryId },
      });
      expect(persisted.visibility).toBe(RepositoryVisibility.PRIVATE);
      expect(persisted.publishedAt).toBeNull();

      const page = await publicProjectsService.findPage(undefined, 50);
      expect(page.items.some((item) => item.id === outcome6.repositoryId)).toBe(
        false,
      );
      await expect(
        publicProjectsService.findDetail(
          outcome6.githubRepositoryId.toString(),
        ),
      ).rejects.toMatchObject({
        errorCode: { code: PublicProjectsErrorCode.PROJECT_NOT_FOUND },
      });

      const rankingEntries = await collectRankingEntries();
      expect(
        rankingEntries.some(
          (entry) =>
            entry.githubLogin === `${PREFIX}-outcome-6-applicant-login`,
        ),
      ).toBe(true);
    },
  );

  it(
    "outcome-7 [알려진 갭 — report-don't-fix]: 프로그램 미종료라 수동 공개가 " +
      'PROGRAM_NOT_ENDED로 막혀 platform Repository는 PRIVATE로 남지만, ranking은 이번에도 ' +
      'collection 관측만으로 기여자 활동을 노출한다 — list/detail/profile은 올바르게 숨긴다',
    async () => {
      await expect(
        submissionReviewsService.publishRepository(
          outcome7.repositoryId,
          REVIEWER_GITHUB_ID,
        ),
      ).rejects.toMatchObject({
        errorCode: { code: SubmissionReviewsErrorCode.PROGRAM_NOT_ENDED },
      });

      const persisted = await prisma.githubRepository.findUniqueOrThrow({
        where: { id: outcome7.repositoryId },
      });
      expect(persisted.visibility).toBe(RepositoryVisibility.PRIVATE);

      const page = await publicProjectsService.findPage(undefined, 50);
      expect(page.items.some((item) => item.id === outcome7.repositoryId)).toBe(
        false,
      );

      const rankingEntries = await collectRankingEntries();
      expect(
        rankingEntries.some(
          (entry) =>
            entry.githubLogin === `${PREFIX}-outcome-7-applicant-login`,
        ),
      ).toBe(true);
    },
  );

  it('outcome-8: 4중 게이트를 전부 통과하면 CAS로 정확히 1건만 전이되고(중복 확인 클릭은 no-op) 감사 로그는 REPOSITORY_PUBLISHED exactly-1이며, 이후 list/detail/profile에 즉시 노출된다', async () => {
    github.publishRepository.mockResolvedValue({
      githubRepositoryId: outcome8.githubRepositoryId,
      name: outcome8.repositoryName,
      url: repositoryUrlFromNameWithOwner(outcome8.nameWithOwner),
      nameWithOwner: outcome8.nameWithOwner,
      visibility: RepositoryVisibility.PUBLIC,
      description: null,
    });

    const publishedAt = new Date('2026-05-20T00:00:00.000Z');
    const first = await submissionReviewsService.publishRepository(
      outcome8.repositoryId,
      REVIEWER_GITHUB_ID,
      publishedAt,
    );

    const second = await submissionReviewsService.publishRepository(
      outcome8.repositoryId,
      REVIEWER_GITHUB_ID,
      new Date('2026-05-21T00:00:00.000Z'),
    );

    expect(first.visibility).toBe(RepositoryVisibility.PUBLIC);
    expect(second.visibility).toBe(RepositoryVisibility.PUBLIC);
    expect(second.publishedAt).toEqual(first.publishedAt);
    expect(github.publishRepository).toHaveBeenCalledTimes(1);

    const auditRows = await prisma.auditLog.findMany({
      where: {
        targetType: 'REPOSITORY',
        targetId: outcome8.repositoryId,
        action: REPOSITORY_PUBLISH_AUDIT_ACTIONS.REPOSITORY_PUBLISHED,
      },
    });
    expect(auditRows).toHaveLength(1);

    const page = await publicProjectsService.findPage(undefined, 50);
    expect(page.items.some((item) => item.id === outcome8.repositoryId)).toBe(
      true,
    );

    const detail = await publicProjectsService.findDetail(
      outcome8.githubRepositoryId.toString(),
    );
    expect(detail.contributors).toHaveLength(2);

    const profile = await publicProjectsService.findProfile(
      outcome8.applicantId,
    );
    expect(profile.projects).toHaveLength(1);
    expect(profile.projects[0]?.observed).toBe(true);
  });

  it('outcome-9: 공개 가능한 기여가 하나도 없는 사용자는 존재하지 않는 사용자와 동일한 404이고, list/detail/profile/ranking 직렬화 결과 어디에도 금지 키(실명/학번/이메일/역할/계정상태/제출내용/거절사유/provision 에러 등)가 없다 — 학과는 ranking 전용 공개 필드로만 나간다', async () => {
    const bystanderId = `${PREFIX}-outcome-9-bystander`;
    await prisma.user.create({
      data: {
        id: bystanderId,
        githubId: nextGithubId(),
        nickname: `${PREFIX}-outcome-9-bystander-login`,
        selectedMemberKind: MemberKind.STUDENT,

        profile: {
          create: {
            name: 'synthetic-forbidden-real-name',
            studentId: '990009',
            department: 'synthetic-forbidden-department',
            memberKind: MemberKind.STUDENT,
            affiliationKind: AffiliationKind.DEPARTMENT,
            affiliationName: 'synthetic-forbidden-department',
          },
        },
      },
    });

    try {
      await expect(
        publicProjectsService.findProfile(bystanderId),
      ).rejects.toMatchObject({
        errorCode: { code: PublicProjectsErrorCode.USER_PROFILE_NOT_FOUND },
      });
      await expect(
        publicProjectsService.findProfile('does-not-exist'),
      ).rejects.toMatchObject({
        errorCode: { code: PublicProjectsErrorCode.USER_PROFILE_NOT_FOUND },
      });

      const page = await publicProjectsService.findPage(undefined, 50);
      const detail = await publicProjectsService.findDetail(
        outcome2.githubRepositoryId.toString(),
      );
      const profile = await publicProjectsService.findProfile(
        outcome2.applicantId,
      );
      const rankingEntries = await collectRankingEntries();

      const bigintSafeStringify = (value: unknown): string =>
        JSON.stringify(value, (_key: string, val: unknown) =>
          typeof val === 'bigint' ? val.toString() : val,
        );
      const serialized = [
        bigintSafeStringify(page),
        bigintSafeStringify(detail),
        bigintSafeStringify(profile),
        bigintSafeStringify(rankingEntries),
      ].join('\n');

      expect(serialized).not.toContain('synthetic-forbidden-real-name');
      expect(serialized).not.toContain(`${PREFIX}-forbidden-student-id`);

      const serializedWithoutRanking = [
        bigintSafeStringify(page),
        bigintSafeStringify(detail),
        bigintSafeStringify(profile),
      ].join('\n');
      expect(serializedWithoutRanking).not.toContain(
        'synthetic-forbidden-department',
      );
      expect(serializedWithoutRanking).not.toContain('"department"');
      const bystanderEntry = rankingEntries.find(
        (entry) => entry.githubLogin === `${PREFIX}-outcome-9-bystander-login`,
      );
      expect(bystanderEntry).toMatchObject({
        department: 'synthetic-forbidden-department',
      });
      expect(bystanderEntry).not.toHaveProperty('name');
      expect(bystanderEntry).not.toHaveProperty('studentId');
      for (const forbiddenKey of [
        '"name"',
        '"studentId"',
        '"email"',
        '"role"',
        '"accountStatus"',
        '"answers"',
        '"rejectionReason"',
        '"lastErrorCode"',
        '"lastErrorMessage"',
        '"isRepositoryPublicationPlanned"',
        '"lease"',
        '"watermark"',
        '"cursor"',
        '"runId"',

        '"nextRunAt"',
        '"lastSuccessAt"',
        '"failureCount"',
        '"presence"',
      ]) {
        expect(serialized).not.toContain(forbiddenKey);
      }
    } finally {
      await prisma.userProfile.deleteMany({ where: { userId: bystanderId } });
      await prisma.user.delete({ where: { id: bystanderId } });
    }
  });
});
