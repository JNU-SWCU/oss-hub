import {
  ApplicationStatus,
  CollectionRepositoryPresence,
  ProgramCategory,
  RepositoryProvisionJobStatus,
  RepositorySource,
  RepositoryVisibility,
  Role,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { AuditLogRepository } from '../audit-log/audit-log.repository';
import { AuditLogService } from '../audit-log/audit-log.service';
import { REPOSITORY_PUBLISH_AUDIT_ACTIONS } from '../audit-log/audit-log-metadata';
import {
  createCollectionReadPortForIntegrationTest,
  type CollectionReadPort,
} from '../collection/collection-read.port';
import { PrismaService } from '../prisma/prisma.service';
import { loadRuntimeConfig } from '../runtime-config/runtime-config';
import type { GithubAppClient } from '../repositories/github-app.client';
import { RepositoriesRepository } from '../repositories/repositories.repository';
import { RepositoriesService } from '../repositories/repositories.service';
import { RankingService } from '../ranking/ranking.service';
import { UserDisplayNameRepository } from '../users/user-display-name.repository';
import { PublicProjectsErrorCode } from '../public-projects/public-projects-error-code.enum';
import { PublicProjectsRepository } from '../public-projects/public-projects.repository';
import { PublicProjectsService } from '../public-projects/public-projects.service';
import { SubmissionReviewsErrorCode } from '../submission-reviews/submission-reviews-error-code.enum';
import { SubmissionReviewsRepository } from '../submission-reviews/submission-reviews.repository';
import { SubmissionReviewsService } from '../submission-reviews/submission-reviews.service';
import { PublicEligibilityService } from './public-eligibility.service';

/**
 * 계획 todo 23 — W4 최종 통합 검증. todos 15–22가 각각 증명한 조각(순수 eligibility fence,
 * 공개 projects keyset 질의, 공개 프로필, ranking 공개 라우트, 수동 공개 확정 4중 게이트+CAS,
 * 감사 로그)을 하나의 synthetic fixture 매트릭스로 다시 조립해 outcome 1–9로 증명한다.
 *
 * 이 파일은 서비스를 Nest DI 없이 직접 `new`로 조립한다(기존 통합 테스트 관행 — 예:
 * `submission-reviews.integration.spec.ts`, `public-user-profile.integration.spec.ts`).
 * HTTP 레벨 4-페르소나 매트릭스는 `public-exposure-persona.http.integration.spec.ts`가 별도로 맡는다.
 *
 * 실 GitHub org/repo/user 데이터는 전혀 쓰지 않는다 — 모든 id는 `PREFIX` 네임스페이스의
 * 합성 값이다.
 */
assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

/** QA40 — 커서 암호화 키 파생용 합성 값. 실 배포 시크릿과 무관하다. */
const SYNTHETIC_SESSION_SECRET = Buffer.from(
  'synthetic-public-projects-integration-secret',
).toString('base64url');

const prisma = new PrismaService();
const collection: CollectionReadPort =
  createCollectionReadPortForIntegrationTest(prisma);
const eligibilityService = new PublicEligibilityService(collection);
const publicProjectsRepository = new PublicProjectsRepository(prisma);
const publicProjectsService = new PublicProjectsService(
  publicProjectsRepository,
  eligibilityService,
  collection,
  loadRuntimeConfig({ SESSION_SECRET: SYNTHETIC_SESSION_SECRET }),
);
const rankingService = new RankingService(
  collection,
  new UserDisplayNameRepository(prisma),
);

const github = {
  publishRepository: jest.fn(),
} as jest.Mocked<Pick<GithubAppClient, 'publishRepository'>>;
const auditLogService = new AuditLogService(new AuditLogRepository(prisma));
const repositoriesRepository = new RepositoriesRepository(prisma);
const repositoriesService = new RepositoriesService(
  repositoriesRepository,
  github,
  auditLogService,
);
const submissionReviewsService = new SubmissionReviewsService(
  new SubmissionReviewsRepository(prisma),
  repositoriesService,
);

const PREFIX = 'synthetic-exposure-matrix';
const now = () => new Date();

const PROGRAM_ENDED_ID = `${PREFIX}-program-ended`;
const PROGRAM_NOT_ENDED_ID = `${PREFIX}-program-not-ended`;

// 수동 공개 확정을 호출하는 "심사자/관리자" actor는 시나리오 지원자와 완전히 분리된
// 전용 User다(고정 id/githubId, `nextGithubId()` 시퀀스 밖). append-only AuditLog가
// `actorId`로 이 User를 FK 참조하게 되므로, `afterAll`에서도 이 User만은 지우지 않는다
// — `submission-reviews.integration.spec.ts`의 REVIEWER_ID 관행과 동일하다.
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

/** 시나리오 하나(applicant/application/repository)를 만든다. 기본은 platform-private, 미발행. */
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
  readonly repositoryName: string;
}> {
  const applicantId = `${PREFIX}-${params.key}-applicant`;
  await prisma.user.create({
    data: {
      id: applicantId,
      githubId: nextGithubId(),
      nickname: `${PREFIX}-${params.key}-applicant-login`,
      role: Role.STUDENT,
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
  const repositoryName = `${PREFIX}-${params.key}-repo`;
  await prisma.repository.create({
    data: {
      id: repositoryId,
      applicationId,
      programId: params.programId,
      githubRepositoryId,
      name: repositoryName,
      url: `https://github.invalid/${PREFIX}/${repositoryName}`,
      visibility: params.visibility,
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
    repositoryName,
  };
}

/** 저장소 하나의 collection 관측(visibility/presence/observedAt)을 심는다. */
async function observeCollection(params: {
  readonly key: string;
  readonly githubRepositoryId: bigint;
  readonly visibility: RepositoryVisibility;
  readonly presence: CollectionRepositoryPresence;
  readonly observedAt: Date | null;
}): Promise<string> {
  const collectionRepositoryId = `${PREFIX}-${params.key}-collection-repository`;
  await prisma.githubRepository.create({
    data: {
      id: collectionRepositoryId,
      githubOrganizationId: 8_900_000_000_000n,
      githubRepositoryId: params.githubRepositoryId,
      nameWithOwner: `synthetic-org/${PREFIX}-${params.key}`,
      defaultBranch: 'main',
      source: RepositorySource.ORG_PROVISIONED,
      visibility: params.visibility,
      presence: params.presence,
      lastCompleteInventoryObservedAt: params.observedAt,
    },
  });
  return collectionRepositoryId;
}

/** 기여자 2명(소유자 + 다른 기여자)을 저장소 하나에 심는다. */
async function seedContributors(
  collectionRepositoryId: string,
  ownerGithubId: bigint,
  ownerLogin: string,
  otherGithubId: bigint,
  otherLogin: string,
): Promise<void> {
  await prisma.collectionContributorYearAggregate.createMany({
    data: [
      {
        repositoryId: collectionRepositoryId,
        githubUserId: ownerGithubId,
        githubLogin: ownerLogin,
        year: 2026,
        commitCount: 5,
        pullRequestCount: 2,
        releaseCount: 1,
      },
      {
        repositoryId: collectionRepositoryId,
        githubUserId: otherGithubId,
        githubLogin: otherLogin,
        year: 2026,
        commitCount: 3,
        pullRequestCount: 1,
        releaseCount: 0,
      },
    ],
  });
  await prisma.collectionRepositoryYearAggregate.create({
    data: {
      repositoryId: collectionRepositoryId,
      year: 2026,
      commitCount: 8,
      pullRequestCount: 3,
      releaseCount: 1,
    },
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
        category: ProgramCategory.BASIC,
        applicationTemplateKey: 'synthetic-template',
        applicationTemplateVersion: 1,
        applicationStartAt: new Date('2026-01-01T00:00:00.000Z'),
        applicationEndAt: new Date('2026-02-01T00:00:00.000Z'),
        endAt: new Date('2026-05-15T00:00:00.000Z'),
        description: 'synthetic-description — program already ended',
      },
    });
    await prisma.program.create({
      data: {
        id: PROGRAM_NOT_ENDED_ID,
        name: `${PREFIX}-program-not-ended`,
        organizer: 'synthetic-organizer',
        category: ProgramCategory.BASIC,
        applicationTemplateKey: 'synthetic-template',
        applicationTemplateVersion: 1,
        applicationStartAt: new Date('2026-01-01T00:00:00.000Z'),
        applicationEndAt: new Date('2026-02-01T00:00:00.000Z'),
        endAt: null,
        description: 'synthetic-description — program never ended',
      },
    });

    await prisma.user.create({
      data: {
        id: REVIEWER_ID,
        githubId: REVIEWER_GITHUB_ID,
        nickname: `${PREFIX}-reviewer-login`,
        role: Role.ADMIN,
      },
    });

    // outcome-1: platform-private, 발행된 적 없음(publishedAt null) — 공개 계획 ON, 프로그램 종료.
    outcome1 = await createScenario({
      key: 'outcome-1',
      programId: PROGRAM_ENDED_ID,
      isRepositoryPublicationPlanned: true,
      visibility: RepositoryVisibility.PRIVATE,
      publishedAt: null,
    });

    // outcome-2: 발행 완료 + collection이 발행 "이후"에 PUBLIC/PRESENT로 관측(happy path).
    outcome2 = await createScenario({
      key: 'outcome-2',
      programId: PROGRAM_ENDED_ID,
      isRepositoryPublicationPlanned: true,
      visibility: RepositoryVisibility.PUBLIC,
      publishedAt: PUBLISHED_AT,
    });
    const outcome2Collection = await observeCollection({
      key: 'outcome-2',
      githubRepositoryId: outcome2.githubRepositoryId,
      visibility: RepositoryVisibility.PUBLIC,
      presence: CollectionRepositoryPresence.PRESENT,
      observedAt: AFTER_PUBLISH,
    });
    await seedContributors(
      outcome2Collection,
      GITHUB_ID_BASE + 900_001n,
      `${PREFIX}-outcome-2-owner-login`,
      GITHUB_ID_BASE + 900_002n,
      `${PREFIX}-outcome-2-other-login`,
    );

    // outcome-3: 발행 완료했지만 collection이 아직 한 번도 관측하지 않음(unknown ≠ revoke).
    outcome3 = await createScenario({
      key: 'outcome-3',
      programId: PROGRAM_ENDED_ID,
      isRepositoryPublicationPlanned: true,
      visibility: RepositoryVisibility.PUBLIC,
      publishedAt: PUBLISHED_AT,
    });
    // 의도적으로 CollectionRepository 행을 만들지 않는다 — unobserved.

    // outcome-4: 발행 완료 + collection이 private/missing으로 관측했지만 그 관측이 발행
    // "이전"(stale) — 회수하지 않는다(stale-allow).
    outcome4 = await createScenario({
      key: 'outcome-4',
      programId: PROGRAM_ENDED_ID,
      isRepositoryPublicationPlanned: true,
      visibility: RepositoryVisibility.PUBLIC,
      publishedAt: PUBLISHED_AT,
    });
    const outcome4Collection = await observeCollection({
      key: 'outcome-4',
      githubRepositoryId: outcome4.githubRepositoryId,
      visibility: RepositoryVisibility.PRIVATE,
      presence: CollectionRepositoryPresence.PRESENT,
      observedAt: BEFORE_PUBLISH,
    });
    // ranking 배제가 "현재 관측(PRIVATE)"을 실제로 반영하는지 의미 있게 증명하려면 기여자
    // 데이터가 존재해야 한다 — 없으면 배제 단언이 트리비얼하게 참이 되어버린다.
    await seedContributors(
      outcome4Collection,
      GITHUB_ID_BASE + 900_005n,
      `${PREFIX}-outcome-4-applicant-login`,
      GITHUB_ID_BASE + 900_006n,
      `${PREFIX}-outcome-4-other-login`,
    );

    // outcome-5: 발행 완료 + collection이 private/missing으로 관측했고 그 관측이 발행
    // "이후"(out-of-band 변경) — 즉시 회수한다.
    outcome5 = await createScenario({
      key: 'outcome-5',
      programId: PROGRAM_ENDED_ID,
      isRepositoryPublicationPlanned: true,
      visibility: RepositoryVisibility.PUBLIC,
      publishedAt: PUBLISHED_AT,
    });
    const outcome5Collection = await observeCollection({
      key: 'outcome-5',
      githubRepositoryId: outcome5.githubRepositoryId,
      visibility: RepositoryVisibility.PRIVATE,
      presence: CollectionRepositoryPresence.ABSENT,
      observedAt: AFTER_PUBLISH,
    });
    await seedContributors(
      outcome5Collection,
      GITHUB_ID_BASE + 900_007n,
      `${PREFIX}-outcome-5-applicant-login`,
      GITHUB_ID_BASE + 900_008n,
      `${PREFIX}-outcome-5-other-login`,
    );

    // outcome-6: 공개 계획 OFF — 4중 게이트 중 REPOSITORY_PUBLICATION_NOT_PLANNED에서 막힌다.
    // collection은 (out-of-band로) 이미 이 저장소를 PUBLIC/PRESENT로 본다 — platform 결정과
    // collection 관측이 어긋나는 경우를 시뮬레이션한다.
    outcome6 = await createScenario({
      key: 'outcome-6',
      programId: PROGRAM_ENDED_ID,
      isRepositoryPublicationPlanned: false,
      visibility: RepositoryVisibility.PRIVATE,
      publishedAt: null,
    });
    const outcome6Collection = await observeCollection({
      key: 'outcome-6',
      githubRepositoryId: outcome6.githubRepositoryId,
      visibility: RepositoryVisibility.PUBLIC,
      presence: CollectionRepositoryPresence.PRESENT,
      observedAt: now(),
    });
    await seedContributors(
      outcome6Collection,
      GITHUB_ID_BASE + 900_009n,
      `${PREFIX}-outcome-6-applicant-login`,
      GITHUB_ID_BASE + 900_010n,
      `${PREFIX}-outcome-6-other-login`,
    );

    // outcome-7: 공개 계획 ON이지만 프로그램 미종료 — PROGRAM_NOT_ENDED에서 막힌다.
    // 마찬가지로 collection은 이미 PUBLIC/PRESENT로 관측한다(out-of-band).
    outcome7 = await createScenario({
      key: 'outcome-7',
      programId: PROGRAM_NOT_ENDED_ID,
      isRepositoryPublicationPlanned: true,
      visibility: RepositoryVisibility.PRIVATE,
      publishedAt: null,
    });
    const outcome7Collection = await observeCollection({
      key: 'outcome-7',
      githubRepositoryId: outcome7.githubRepositoryId,
      visibility: RepositoryVisibility.PUBLIC,
      presence: CollectionRepositoryPresence.PRESENT,
      observedAt: now(),
    });
    await seedContributors(
      outcome7Collection,
      GITHUB_ID_BASE + 900_011n,
      `${PREFIX}-outcome-7-applicant-login`,
      GITHUB_ID_BASE + 900_012n,
      `${PREFIX}-outcome-7-other-login`,
    );

    // outcome-8: 4중 게이트 전부 통과 — 수동 공개 확정이 성공한다. program-ended에는
    // milestone이 없으므로 requiredMilestonesApproved는 공집합 전칭으로 참이다.
    outcome8 = await createScenario({
      key: 'outcome-8',
      programId: PROGRAM_ENDED_ID,
      isRepositoryPublicationPlanned: true,
      visibility: RepositoryVisibility.PRIVATE,
      publishedAt: null,
    });
    // collection은 발행 전부터 이미 이 저장소를 PUBLIC/PRESENT로 관측했다 — "collection
    // unchanged" 차원: platform 수동 공개는 collection 테이블을 전혀 건드리지 않는다.
    const outcome8Collection = await observeCollection({
      key: 'outcome-8',
      githubRepositoryId: outcome8.githubRepositoryId,
      visibility: RepositoryVisibility.PUBLIC,
      presence: CollectionRepositoryPresence.PRESENT,
      observedAt: BEFORE_PUBLISH,
    });
    await seedContributors(
      outcome8Collection,
      GITHUB_ID_BASE + 900_003n,
      `${PREFIX}-outcome-8-owner-login`,
      GITHUB_ID_BASE + 900_004n,
      `${PREFIX}-outcome-8-other-login`,
    );
  });

  afterAll(async () => {
    try {
      await prisma.collectionContributorYearAggregate.deleteMany({
        where: { repositoryId: { startsWith: `${PREFIX}-` } },
      });
      await prisma.collectionRepositoryYearAggregate.deleteMany({
        where: { repositoryId: { startsWith: `${PREFIX}-` } },
      });
      await prisma.githubRepository.deleteMany({
        where: { id: { startsWith: `${PREFIX}-` } },
      });
      await prisma.repositoryProvisionJob.deleteMany({
        where: { id: { startsWith: `${PREFIX}-` } },
      });
      await prisma.repository.deleteMany({
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
      // AuditLog는 append-only(트리거로 삭제/수정을 막는다) — 이 테스트가 만든 synthetic
      // REPOSITORY_PUBLISHED 행은 의도적으로 지우지 않는다(다른 append-only 통합 테스트와
      // 동일한 관행). 그 행들이 `actorId`로 REVIEWER_ID를 FK 참조하므로, REVIEWER_ID User는
      // `${PREFIX}-` 정리 대상에서 제외한다 — 지우면 FK 위반으로 cleanup 자체가 실패한다.
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

  it('outcome-1: platform-private 저장소는 발행 전이라 list/detail/profile/ranking 어디에도 절대 나타나지 않는다', async () => {
    const page = await publicProjectsService.findPage(undefined, 50);
    expect(page.items.some((item) => item.id === outcome1.repositoryId)).toBe(
      false,
    );

    await expect(
      publicProjectsService.findDetail(outcome1.githubRepositoryId.toString()),
    ).rejects.toMatchObject({
      errorCode: { code: PublicProjectsErrorCode.PROJECT_NOT_FOUND },
    });

    await expect(
      publicProjectsService.findProfile(outcome1.applicantId),
    ).rejects.toMatchObject({
      errorCode: { code: PublicProjectsErrorCode.USER_PROFILE_NOT_FOUND },
    });

    const ranking = await rankingService.findPage('all', 1, 100);
    expect(
      ranking.items.some(
        (entry) => entry.githubLogin === `${PREFIX}-outcome-1-applicant-login`,
      ),
    ).toBe(false);
  });

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

    const ranking = await rankingService.findPage('all', 1, 100);
    const rankedLogins = ranking.items.map((entry) => entry.githubLogin);
    expect(rankedLogins).toEqual(
      expect.arrayContaining([
        `${PREFIX}-outcome-2-owner-login`,
        `${PREFIX}-outcome-2-other-login`,
      ]),
    );
  });

  it('outcome-3: 발행됐지만 collection이 아직 관측하지 않은 저장소는 list/detail/profile에는 보이되(unknown≠revoke) ranking에는 아직 나타나지 않는다', async () => {
    const page = await publicProjectsService.findPage(undefined, 50);
    expect(page.items.some((item) => item.id === outcome3.repositoryId)).toBe(
      true,
    );

    await expect(
      publicProjectsService.findDetail(outcome3.githubRepositoryId.toString()),
    ).resolves.toMatchObject({ row: { id: outcome3.repositoryId } });

    const profile = await publicProjectsService.findProfile(
      outcome3.applicantId,
    );
    expect(profile.projects).toHaveLength(1);
    expect(profile.projects[0]?.observed).toBe(false);
    expect(profile.projects[0]?.metrics).toBeNull();

    // ranking은 CollectionRepository 행 자체가 있어야만 그 저장소의 기여자를 합산한다 —
    // 행이 아예 없으니(unobserved) 이 지원자의 로그인은 ranking에 등장할 수 없다.
    const ranking = await rankingService.findPage('all', 1, 100);
    expect(
      ranking.items.some(
        (entry) => entry.githubLogin === `${PREFIX}-outcome-3-applicant-login`,
      ),
    ).toBe(false);
  });

  it('outcome-4: collection이 private/missing으로 관측했지만 발행 이전(stale)이면 list/detail/profile은 그대로 노출하되(stale-allow) ranking은 현재 관측 상태(PRIVATE)를 그대로 반영해 제외한다', async () => {
    const page = await publicProjectsService.findPage(undefined, 50);
    expect(page.items.some((item) => item.id === outcome4.repositoryId)).toBe(
      true,
    );

    await expect(
      publicProjectsService.findDetail(outcome4.githubRepositoryId.toString()),
    ).resolves.toMatchObject({ row: { id: outcome4.repositoryId } });

    const ranking = await rankingService.findPage('all', 1, 100);
    expect(
      ranking.items.some(
        (entry) => entry.githubLogin === `${PREFIX}-outcome-4-applicant-login`,
      ),
    ).toBe(false);
  });

  it('outcome-5: collection이 private/missing으로 관측했고 발행 이후(out-of-band 변경)면 즉시 회수되어 list/detail/profile/ranking 어디에도 없다', async () => {
    const page = await publicProjectsService.findPage(undefined, 50);
    expect(page.items.some((item) => item.id === outcome5.repositoryId)).toBe(
      false,
    );

    await expect(
      publicProjectsService.findDetail(outcome5.githubRepositoryId.toString()),
    ).rejects.toMatchObject({
      errorCode: { code: PublicProjectsErrorCode.PROJECT_NOT_FOUND },
    });

    await expect(
      publicProjectsService.findProfile(outcome5.applicantId),
    ).rejects.toMatchObject({
      errorCode: { code: PublicProjectsErrorCode.USER_PROFILE_NOT_FOUND },
    });

    const ranking = await rankingService.findPage('all', 1, 100);
    expect(
      ranking.items.some(
        (entry) => entry.githubLogin === `${PREFIX}-outcome-5-applicant-login`,
      ),
    ).toBe(false);
  });

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

      const persisted = await prisma.repository.findUniqueOrThrow({
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

      // 알려진 갭: ranking은 platform publish 상태를 전혀 참조하지 않는다
      // (`CollectionReadService.getPublicRankingMetrics`가 `CollectionRepository.visibility`/
      // `presence`만 본다 — `Repository.visibility`/`isRepositoryPublicationPlanned`는 관여하지
      // 않는다). 이 outcome은 그 현재 동작을 characterization으로 고정한다 — "그래야 한다"가
      // 아니라 "지금 그렇다"의 증거다.
      const ranking = await rankingService.findPage('all', 1, 100);
      expect(
        ranking.items.some(
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

      const persisted = await prisma.repository.findUniqueOrThrow({
        where: { id: outcome7.repositoryId },
      });
      expect(persisted.visibility).toBe(RepositoryVisibility.PRIVATE);

      const page = await publicProjectsService.findPage(undefined, 50);
      expect(page.items.some((item) => item.id === outcome7.repositoryId)).toBe(
        false,
      );

      const ranking = await rankingService.findPage('all', 1, 100);
      expect(
        ranking.items.some(
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
      url: `https://github.invalid/${PREFIX}/${outcome8.repositoryName}`,
      visibility: RepositoryVisibility.PUBLIC,
      description: null,
    });

    const publishedAt = new Date('2026-05-20T00:00:00.000Z');
    const first = await submissionReviewsService.publishRepository(
      outcome8.repositoryId,
      REVIEWER_GITHUB_ID,
      publishedAt,
    );
    // 중복 확인(같은 저장소를 다시 확인 클릭) — 이미 PUBLIC이므로 no-op으로 같은 상태를
    // 반환하고 GitHub API도, 두 번째 audit도 만들지 않는다.
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

  it('outcome-9: 공개 가능한 기여가 하나도 없는 사용자는 존재하지 않는 사용자와 동일한 404이고, list/detail/profile/ranking 직렬화 결과 어디에도 금지 키(실명/학번/학과/이메일/역할/계정상태/제출내용/거절사유/provision 에러/raw githubId 등)가 없다', async () => {
    const bystanderId = `${PREFIX}-outcome-9-bystander`;
    await prisma.user.create({
      data: {
        id: bystanderId,
        githubId: nextGithubId(),
        nickname: `${PREFIX}-outcome-9-bystander-login`,
        role: Role.STUDENT,
        profile: {
          create: {
            name: 'synthetic-forbidden-real-name',
            studentId: `${PREFIX}-forbidden-student-id`,
            department: 'synthetic-forbidden-department',
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

      // 이 파일은 ADR-003 모듈 경계상 다른 모듈의 dto/domain을 직접 import할 수 없어(모듈
      // 밖 서비스 조합 테스트라 public-eligibility 모듈 소속), 여기서는 서비스가 반환하는
      // 원본 결과(response DTO로 변환되기 이전의 내부 표현)에 대해 금지 키 부재를 증명한다 —
      // repository select가 애초에 그 필드들을 읽지 않는다는 더 강한 증거다. 실제 wire-format
      // (controller가 최종 직렬화하는 JSON)에 대한 동등한 증명은
      // `public-exposure-persona.http.integration.spec.ts`가 real HTTP 응답 바디로 맡는다.
      //
      // 주의: `"githubId"`는 여기서는 검사하지 않는다 — `PublicUserIdentity.githubId`(raw
      // bigint)는 프로필 조회 내부에서 다른 collection 조인 키로 쓰기 위해 의도적으로
      // 내부 표현에 남아 있고, 실제로 wire에 노출되지 않도록 걷어내는 건 DTO 계층의 책임이다
      // (`PublicUserProfileResponseDto`는 githubId를 절대 노출하지 않는다). 그 경계는 raw
      // 도메인 결과가 아니라 DTO/wire-format에서만 의미 있게 검증되므로, 그 증명 역시
      // `public-exposure-persona.http.integration.spec.ts`로 미룬다.
      const page = await publicProjectsService.findPage(undefined, 50);
      const detail = await publicProjectsService.findDetail(
        outcome2.githubRepositoryId.toString(),
      );
      const profile = await publicProjectsService.findProfile(
        outcome2.applicantId,
      );
      const ranking = await rankingService.findPage('all', 1, 100);

      // raw 도메인 결과에는 bigint 필드(githubRepositoryId/githubId)가 그대로 남아 있어
      // 기본 JSON.stringify는 TypeError를 던진다 — bigint를 문자열로 바꾸는 replacer로
      // 우회한다(직렬화 가능하게 만들 뿐, 값 자체를 숨기거나 왜곡하지 않는다).
      const bigintSafeStringify = (value: unknown): string =>
        JSON.stringify(value, (_key: string, val: unknown) =>
          typeof val === 'bigint' ? val.toString() : val,
        );
      const serialized = [
        bigintSafeStringify(page),
        bigintSafeStringify(detail),
        bigintSafeStringify(profile),
        bigintSafeStringify(ranking),
      ].join('\n');

      expect(serialized).not.toContain('synthetic-forbidden-real-name');
      expect(serialized).not.toContain(`${PREFIX}-forbidden-student-id`);
      expect(serialized).not.toContain('synthetic-forbidden-department');
      for (const forbiddenKey of [
        '"name"',
        '"studentId"',
        '"department"',
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
      ]) {
        expect(serialized).not.toContain(forbiddenKey);
      }
    } finally {
      await prisma.userProfile.deleteMany({ where: { userId: bystanderId } });
      await prisma.user.delete({ where: { id: bystanderId } });
    }
  });
});
