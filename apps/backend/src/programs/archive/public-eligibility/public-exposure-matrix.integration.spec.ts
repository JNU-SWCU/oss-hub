import {
  AffiliationKind,
  ApplicationStatus,
  CollectionRepositoryPresence,
  MemberKind,
  ProgramCategory,
  RepositoryProvisionJobStatus,
  RepositorySource,
  RepositoryVisibility,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../../../test/integration-database.guard';
import { AuditLogRepository } from '../../../audit-log/audit-log.repository';
import { AuditLogService } from '../../../audit-log/audit-log.service';
import { REPOSITORY_PUBLISH_AUDIT_ACTIONS } from '../../../audit-log/audit-log-metadata';
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
);

const PREFIX = 'synthetic-exposure-matrix';
const now = () => new Date();

/**
 * 랭킹은 "가입자 전원이 행을 가진다"가 제품 정책이라(`ranking.service.ts`), 한
 * Postgres를 공유하는 CI에서는 형제 스펙이 심은 가입자도 같은 목록에 들어온다.
 * 그래서 첫 페이지만 보면 이 스펙의 fixture가 0점 동률 뒤로 밀려 보이지 않을 수
 * 있다 — 순서 의존이다. 목록 전체를 페이징해 모으면 "이 fixture가 랭킹에 있다/
 * 없다"를 페이지 경계와 무관하게 같은 강도로 말할 수 있다.
 */
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

let studentIdSequence = 910_000;

/**
 * 순위에 오를 학생 fixture 한 명분 — legacy 칸과 canonical 행을 동시에 반환한다.
 *
 * 둘을 묶어 둔 이유는 둘이 갈라지면 backfill 불변식이 이 파일뿐 아니라 같은 PostgreSQL 을
 * 쓰는 다른 스펙까지 멈췄 버리기 때문이다.
 */
function canonicalStudentFields(name: string, department: string) {
  studentIdSequence += 1;
  const studentId = String(studentIdSequence);
  return {
    name,
    studentId,
    department,
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

/**
 * 시나리오 하나(applicant/application/repository)를 만든다. 기본은 platform-private, 미발행.
 *
 * #617 단계 D 이후 `Repository`와 `GithubRepository`는 한 테이블이다 — platform 발행 상태
 * (applicationId/programId/visibility/publishedAt)와 collection 관측 상태
 * (presence/lastCompleteInventoryObservedAt/…)가 같은 행, 같은 컬럼을 공유한다. 이 함수는
 * 실제 provisioning writer(`recordRepository()`, `repository-provision-state.repository.ts`)를
 * 그대로 미러링해 행을 만든다 — 그 writer는 create에서 `presence: PRESENT`를 항상 쓰므로
 * (인벤토리 스윕이 한 번도 안 돈 채로 생성됐다는 사실을 아직 "부재"로 표현할 길이 없다),
 * 여기서도 동일하게 PRESENT로 만든다. outcome-3의 "미관측" 기대치가 이 사실 때문에
 * 달라지는 지점은 그 테스트 본문의 주석에서 별도로 설명한다.
 */
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
      // 순위 자격은 canonical `UserProfile.memberKind`가 정한다 — 학생 지원자 fixture는
      // 그 유형을 실제로 갖고 있어야 랭킹 단언이 공허해지지 않는다. legacy 칸과 같은 값으로
      // 둔다 — 형제 스펙이 돌리는 backfill 불변식은 두 면이 갈라지면 전체를 멈췄다.
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

/**
 * 저장소 하나의 collection 관측(visibility/presence/observedAt)을 **기존 행에** 반영한다.
 *
 * #617 단계 D 이전에는 `observeCollection`이 `createScenario`와 별개 행(별개 id, 같은
 * `githubRepositoryId`)을 만들었다 — 단일 테이블이 된 지금은 `githubRepositoryId` 가 전역
 * unique라 그렇게 하면 P2002가 난다. 실제 인벤토리 스윕(`recordRepositoryObservation()`,
 * `collection-incremental.repository.ts`)도 `githubRepositoryId`로 upsert하는 같은 행을
 * 갱신할 뿐이므로, 여기서도 `update()`로 그 패턴을 그대로 미러링한다 — provisioning 컬럼
 * (applicationId/programId/teamId/publishedAt)은 손대지 않는다.
 */
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

/**
 * 기여자 2명(소유자 + 다른 기여자)을 저장소 하나에 심는다.
 *
 * 표시명 원본이 `User` 로 바뀌었으므로(ADR-010 §4) 기여 행만 심으면
 * `githubLogin` 이 빈 문자열로 나온다. 가입자만 적재한다는 불변식(§5)상
 * 모든 `Contribution.githubId` 는 `User` 에 있어야 하므로, fixture 도 그렇게 심는다.
 */
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
  // 옛 스키마는 기여자 집계와 저장소 총계가 다른 테이블이라 같은 (저장소, 날짜)에
  // 두 행이 공존했다. `Contribution` 은 사람 축 하나뿐이고 키가
  // (repositoryId, githubId, date) 이므로 저장소 총계 행을 따로 넣지 않는다 —
  // 넣으면 소유자 행과 PK 가 충돌한다. 총계가 필요하면 읽을 때 합친다.
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

    // outcome-3: 발행 완료했지만 collection이 아직 한 번도 (재)관측하지 않음(unknown ≠ revoke).
    // 알려진 갭 — #617 이전에는 "CollectionRepository 행 자체가 없다"가 미관측의 증거였다.
    // 단일 테이블이 된 지금은 provisioning writer(`recordRepository()`)가 create에서
    // `presence: PRESENT`를 항상 쓰므로, 행이 생기는 순간 이미 PRESENT다 — 인벤토리 스윕이
    // 한 번도 안 돌았다는 사실을 표현할 별도 축이 없다. `observed`(=profile projection)의
    // 실제 계산(`getRepositoryCumulativeMetrics`)은 `visibility: PUBLIC, presence: PRESENT`만
    // 보고 `lastCompleteInventoryObservedAt`은 보지 않으므로, 이 시나리오는 이제 observed:
    // true로 판정된다 — "그래야 한다"가 아니라 "지금 그렇다"의 characterization이다.
    outcome3 = await createScenario({
      key: 'outcome-3',
      programId: PROGRAM_ENDED_ID,
      isRepositoryPublicationPlanned: true,
      visibility: RepositoryVisibility.PUBLIC,
      publishedAt: PUBLISHED_AT,
    });
    // 의도적으로 observeCollection을 호출하지 않는다 — 그래도 presence는 provisioning
    // 기본값(PRESENT)이다. Contribution도 심지 않으므로 지표는 여전히 0/0/0이다.

    // outcome-4: 발행 완료 + collection이 private로 관측했지만 그 관측이 발행 "이전"(stale) —
    // 회수하지 않는다(stale-allow). 단일 visibility 컬럼에서는 "나중에 쓴 쪽이 이긴다"가 곧
    // staleness 해소 메커니즘이다 — 그래서 이 fixture는 실제 사건 순서(제공 당시 private →
    // 스윕이 이전 상태를 stale하게 재확인 → platform이 나중에 발행)대로 세 번 쓴다. 마지막
    // 쓰기(발행)가 이겨서 최종 상태는 PUBLIC이다. `isPublicEligible`의 관측-시각 비교 분기는
    // 이제 이 경로에서 도달 불가능해졌지만(바깥 질의가 이미 visibility: PUBLIC만 통과시키므로),
    // list/detail/profile 노출이라는 관측 가능한 결과는 동일하게 보존된다.
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
    // ranking 배제가 "현재 관측(presence PRESENT)"을 실제로 반영하는지 의미 있게 증명하려면
    // 기여자 데이터가 존재해야 한다 — 없으면 배제 단언이 트리비얼하게 참이 되어버린다.
    await seedContributors(
      outcome4.repositoryId,
      GITHUB_ID_BASE + 900_005n,
      `${PREFIX}-outcome-4-applicant-login`,
      GITHUB_ID_BASE + 900_006n,
      `${PREFIX}-outcome-4-other-login`,
    );

    // outcome-5: 발행 완료 + collection이 private/missing으로 관측했고 그 관측이 발행
    // "이후"(out-of-band 변경) — 즉시 회수한다. observeCollection이 createScenario 이후에
    // 실행되므로(사건 순서: 발행 → 스윕이 나중에 회수를 확인) 마지막 쓰기(스윕)가 이겨서
    // 최종 상태는 PRIVATE/ABSENT다.
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

    // outcome-6: 공개 계획 OFF — 4중 게이트 중 REPOSITORY_PUBLICATION_NOT_PLANNED에서 막힌다.
    // 알려진 갭 — #617 이전에는 별도 observeCollection 호출로 "collection은 이미 PUBLIC/PRESENT로
    // 본다"는 platform 결정과의 어긋남을 fixture로 만들 수 있었다. 단일 visibility 컬럼이 된
    // 지금은 그 어긋남 자체를 동시에 표현할 수 없다(한 컬럼에 두 값이 동시에 있을 수 없다) —
    // 그런데 그 어긋남을 표현할 필요도 없어졌다: ranking은 사람 축만 읽어 저장소 관측
    // 상태를 아예 참조하지 않으므로, 어느 쪽 값이든 랭킹 결과가 달라지지 않는다. 그래서
    // observeCollection 호출을 아예 지운다 — platform Repository는 PRIVATE로 남고,
    // ranking은 여전히 platform 결정과 무관하게 가입자 행을 노출한다.
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

    // outcome-7: 공개 계획 ON이지만 프로그램 미종료 — PROGRAM_NOT_ENDED에서 막힌다.
    // outcome-6과 동일한 이유로 별도 observeCollection 호출이 필요 없다(presence는 provisioning
    // 기본값으로 이미 PRESENT다).
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

    // outcome-8: 4중 게이트 전부 통과 — 수동 공개 확정이 성공한다. program-ended에는
    // milestone이 없으므로 requiredMilestonesApproved는 공집합 전칭으로 참이다.
    // "collection unchanged" 차원(platform 수동 공개는 collection 관측 컬럼을 건드리지
    // 않는다)은 이제 별도 observeCollection 호출로 증명할 수 없다 — 같은 행의 같은
    // visibility 컬럼에 미리 PUBLIC을 써 두면 아래 CAS의 "PRIVATE → PUBLIC" 전이 전제
    // 자체가 깨진다(이미 PUBLIC이라 no-op이 되어 정확히 1건 전이라는 단언이 무너진다).
    // presence는 provisioning 기본값(PRESENT)만으로 이미 발행 후 list/detail/profile 노출에
    // 충분하므로, observeCollection 없이도 커버리지 손실이 없다.
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
      // #617 단계 D 이후 platform 상태와 collection 관측이 한 행이므로 정리도 한 번이면 된다.
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

      // PM 확정 정책 — 닉네임을 가진 canonical 학생 가입자는 전원 ranking에 행을 갖는다
      // (`ranking.service.ts`의 `buildEntries`, `total > 0` 필터 없음). ranking은 이제
      // 사람 축(`GithubUserActivityHistory`)만 읽으므로 저장소 축 기여(`Contribution`)는
      // 어느 저장소에 있든 랭킹 수치에 들어오지 않는다 — 이 fixture는 사람 축 관측을
      // 심지 않았으니 행은 존재하되 5종 전부 0이어야 한다.
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
      // #617 단계 D 이전에는 이 저장소가 "미관측"이라 observed: false / metrics: null이었다.
      // 단계 D 이후 presence는 provisioning 시점(recordRepository)부터 PRESENT로 고정되고
      // getRepositoryCumulativeMetrics는 lastCompleteInventoryObservedAt을 필터링에 쓰지
      // 않으므로, 실제 inventory sweep이 한 번도 없었어도 observed: true가 된다. 기여자를
      // seedContributors로 심지 않았으니 own contribution이 없어 수치는 0/0/0이다.
      expect(profile.projects[0]?.observed).toBe(true);
      expect(profile.projects[0]?.metrics).toEqual({
        commitCount: 0,
        pullRequestCount: 0,
        releaseCount: 0,
      });
      // #893 — observed는 위 characterization대로 여전히 true지만(이 갭 자체는 고치지 않는다),
      // lastCompleteInventoryObservedAt이 없으므로 hasCollectedData는 false다. 프런트는
      // observed 단독이 아니라 이 필드로 "첫 sweep 전" 상태를 "관측된 0"과 구분해서 보여준다.
      expect(profile.projects[0]?.hasCollectedData).toBe(false);

      // ranking은 저장소 관측 상태를 아예 보지 않는다(사람 축 전환). PM 확정 정책상
      // canonical 학생 가입자는 전원 ranking에 행을 갖고, 사람 축 관측이 없으니 5종 전부 0이다.
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

      // 두 축 MECE의 실물 증거다. fixture는 이 PRIVATE 저장소에 저장소 축 기여
      // (`Contribution` — commit 5 / PR 2 / release 1)를 심었지만, ranking은 사람 축
      // (`GithubUserActivityHistory`)만 읽으므로 그 수치가 공개 랭킹에 단 하나도 나타나지
      // 않는다. 가입자라 행 자체는 있고 값이 전부 0이다 — "행이 없다"가 아니라 "행은 있고
      // 0이다"가 비공개 저장소 활동 비노출의 증거다.
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

      // ranking은 저장소 관측(presence/visibility)을 아예 참조하지 않는다 — outcome-4와
      // 결과가 같은 이유가 바로 그것이다. PM 확정 정책상 가입자는 전원 ranking에 행을
      // 가지므로 "행이 없다"가 아니라 "행은 있고 0이다"로 증명한다.
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

      // ranking은 platform publish 상태도 저장소 관측 상태도 전혀 참조하지 않는다
      // (`getPublicRankingMetrics`는 사람 축 `GithubUserActivityHistory`와 가입자 목록만
      // 읽는다). 그래서 가입자인 이상 이 지원자도 랭킹 목록에는 행을 갖는다 — 수치가
      // 아니라 "행의 존재"만 여기서 고정한다.
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

  it('outcome-9: 공개 가능한 기여가 하나도 없는 사용자는 존재하지 않는 사용자와 동일한 404이고, list/detail/profile/ranking 직렬화 결과 어디에도 금지 키(실명/학번/이메일/역할/계정상태/제출내용/거절사유/provision 에러 등)가 없다 — 학과는 ranking 전용 공개 필드로만 나간다', async () => {
    const bystanderId = `${PREFIX}-outcome-9-bystander`;
    await prisma.user.create({
      data: {
        id: bystanderId,
        githubId: nextGithubId(),
        nickname: `${PREFIX}-outcome-9-bystander-login`,
        selectedMemberKind: MemberKind.STUDENT,
        // 금지 키 누출 검사용 fixture — 순위에 행이 나오려면 canonical 학생이어야 하고,
        // backfill 불변식을 건드리지 않으려면 legacy 칸과 바이트 단위로 같아야 한다.
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
      const rankingEntries = await collectRankingEntries();

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
        bigintSafeStringify(rankingEntries),
      ].join('\n');

      // 실명·학번은 어느 공개 표면에도 없다 — 이 불변식은 사람 축 전환 이후에도 그대로다.
      expect(serialized).not.toContain('synthetic-forbidden-real-name');
      expect(serialized).not.toContain(`${PREFIX}-forbidden-student-id`);
      // ranking은 이제 학과를 의도적으로 내려준다(owner 결정 2026-08-19 — 학과는 공개
      // 가능 정보). 그래서 `"department"` 키 금지는 list/detail/profile에만 적용하고,
      // ranking에는 "이 사용자의 학과가 정확히 그 값으로 나온다"를 따로 고정한다 —
      // 금지 목록에서 빼기만 하면 무엇이 나가는지 아무도 안 보게 된다.
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
        // #617 단계 D 이후 GithubRepository 한 테이블에 collection-control 메타데이터
        // (nextRunAt/lastSuccessAt/failureCount/presence)가 platform 노출 컬럼과 함께
        // 있으니, public 직렬화 결과에 이들이 새지 않는다는 걸 명시적으로 고정한다.
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
