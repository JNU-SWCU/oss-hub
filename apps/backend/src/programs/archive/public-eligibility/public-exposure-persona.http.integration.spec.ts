import {
  AccountStatus,
  ApplicationStatus,
  CollectionRepositoryPresence,
  MemberKind,
  ProgramCategory,
  RepositoryProvisionJobStatus,
  RepositorySource,
  RepositoryVisibility,
  StaffAccessRequestStatus,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../../../test/integration-database.guard';
import {
  ACCESS_AUDIT_ACTIONS,
  ACCESS_AUDIT_EVENT_KINDS,
  createAccessAuditMetadata,
} from '../../../audit-log/audit-log-metadata';
import { PublicExposurePersonaHttpHarness } from './public-exposure-persona.http.integration-support';

/**
 * 계획 todo 23 — public-exposure-matrix.integration.spec.ts(DB 레벨, 서비스 직접 조립)가
 * 미룬 "실제 wire-format" 증명을 real HTTP 응답 바디로 맡는다. 가드를 모킹하지 않고
 * 실제 SessionGuard/OriginGuard/SubmissionReviewsStaffGuard와 실제 AuditLogService의
 * ADMIN_ONLY 검사를 anonymous/STUDENT/STAFF/ADMIN 4-페르소나로 그대로 통과시킨다.
 */
assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const PREFIX = 'synthetic-exposure-persona';
/** 실명이 채워진 persona — 공개 랭킹 응답에 이 문자열이 나오면 즉시 실패다. */
const NAMED_PERSONA_REAL_NAME = 'synthetic-forbidden-persona-real-name';
const NAMED_PERSONA_DEPARTMENT = 'synthetic-persona-department';
/** 사람 축 관측 fixture 연도. 직전 연도에도 행을 심어 연도 필터를 증명한다. */
const RANKING_FIXTURE_YEAR = 2026;
const harness = new PublicExposurePersonaHttpHarness(PREFIX);

// `harness.createUser`가 만드는 페르소나 nickname의 공통 접두사다(`${PREFIX}-http-<label>-<seq>-login`).
// `GET /audit-logs`의 `actor` 필터는 `User.nickname`에 대한 contains라, 이 값 하나로 "이 파일의
// 페르소나가 쓴 감사 행"만 남긴 창을 서버에서 만들 수 있다.
const OWN_AUDIT_ACTOR_FILTER = `${PREFIX}-http-`;

// #622 회귀 고정용 — 다른 스펙 파일이 같은 append-only AuditLog 테이블에 남기는 행을 흉내낸다.
// `OWN_AUDIT_ACTOR_FILTER`에 일부러 걸리지 않는 이름을 쓴다(그래야 "이 파일 밖의 행"이 된다).
const FOREIGN_SUITE_ACTOR_ID = 'synthetic-foreign-audit-suite-actor';
const FOREIGN_SUITE_ROLE_REQUEST_ID =
  'synthetic-foreign-audit-suite-role-request';

const PROGRAM_ID = `${PREFIX}-program`;
const PUBLISHED_AT = new Date('2026-06-01T00:00:00.000Z');

/** `GET /ranking` 이 허용하는 최대 pageSize(`ranking-query.dto.ts`). */
const RANKING_MAX_PAGE_SIZE = 100;

type RankingWireBody = {
  readonly items: Record<string, unknown>[];
  readonly total: number;
};

/**
 * `GET /ranking` 응답 전 페이지를 실제 HTTP 로 모은다.
 *
 * 랭킹은 "canonical 학생 가입자는 전원이 행을 갖는다"가 제품 정책이라
 * (`ranking.repository.ts`), Postgres 를 공유하는 CI 에서는 형제 스펙이 심은 학생도
 * 같은 목록에 정당하게 들어온다. 기본
 * pageSize 는 20 이므로 첫 페이지만 보면 이 파일의 persona 가 0점 동률 뒤로 밀려
 * 보이지 않을 수 있다 — 실행 순서에 따라 초록/빨강이 갈리는 defect 다. 전 페이지를
 * 모으면 "이 persona 가 어떻게 보이는가"를 페이지 경계와 무관하게 못 박을 수 있고,
 * 그러면서도 persona 가 목록에서 통째로 빠지면 여전히 빨강이다.
 */
async function fetchRankingPages(
  query: string,
  githubId?: bigint,
): Promise<{
  readonly response: Response;
  readonly items: RankingWireBody['items'];
}> {
  const first = await harness.request(
    'GET',
    `${query}&page=1&pageSize=${RANKING_MAX_PAGE_SIZE}`,
    githubId,
  );
  if (first.status !== 200) return { response: first, items: [] };
  const firstBody = (await first.clone().json()) as RankingWireBody;
  const items = [...firstBody.items];
  const pageCount = Math.ceil(firstBody.total / RANKING_MAX_PAGE_SIZE);
  for (let page = 2; page <= pageCount; page += 1) {
    const next = await harness.request(
      'GET',
      `${query}&page=${page}&pageSize=${RANKING_MAX_PAGE_SIZE}`,
      githubId,
    );
    expect(next.status).toBe(200);
    items.push(...((await next.json()) as RankingWireBody).items);
  }
  return { response: first, items };
}

let studentPersona: Awaited<ReturnType<typeof harness.createUser>>;
/** legacy `User.name` 이 비어 있는 두 번째 학생 — canonical 실명만 가진 행을 본다. */
let canonicalOnlyStudentPersona: Awaited<ReturnType<typeof harness.createUser>>;
let staffPersona: Awaited<ReturnType<typeof harness.createUser>>;
let adminPersona: Awaited<ReturnType<typeof harness.createUser>>;

let publicProject: {
  repositoryId: string;
  applicantId: string;
  githubRepositoryId: bigint;
};
let gateRepoForStaff: { repositoryId: string; githubRepositoryId: bigint };
let gateRepoForAdmin: { repositoryId: string; githubRepositoryId: bigint };

async function createRepositoryFixture(params: {
  readonly key: string;
  readonly visibility: RepositoryVisibility;
  readonly publishedAt: Date | null;
}): Promise<{
  readonly applicantId: string;
  readonly repositoryId: string;
  readonly githubRepositoryId: bigint;
  readonly repositoryName: string;
}> {
  const applicantId = `${PREFIX}-${params.key}-applicant`;
  const githubRepositoryId = 8_930_000_000_000n + BigInt(hashKey(params.key));
  await harness.prisma.user.create({
    data: {
      id: applicantId,
      githubId: 8_940_000_000_000n + BigInt(hashKey(params.key)),
      nickname: `${PREFIX}-${params.key}-applicant-login`,
      selectedMemberKind: MemberKind.STUDENT,
    },
  });
  const applicationId = `${PREFIX}-${params.key}-application`;
  const teamId = `${PREFIX}-${params.key}-team`;
  await harness.prisma.team.create({
    data: {
      id: teamId,
      programId: PROGRAM_ID,
      name: `${PREFIX}-${params.key}-team`,
      joinCodeDigest: `${PREFIX}-${params.key}-team-digest`,
      leaderId: applicantId,
    },
  });
  await harness.prisma.teamMember.create({
    data: {
      id: `${PREFIX}-${params.key}-team-member`,
      teamId,
      programId: PROGRAM_ID,
      userId: applicantId,
    },
  });
  await harness.prisma.application.create({
    data: {
      id: applicationId,
      programId: PROGRAM_ID,
      applicantId,
      teamId,
      answers: { syntheticFixture: true },
      applicationTemplateVersion: 1,
      status: ApplicationStatus.APPROVED,
      isRepositoryPublicationPlanned: true,
      processedAt: new Date(),
    },
  });
  const repositoryId = `${PREFIX}-${params.key}-repository`;
  const repositoryName = `${PREFIX}-${params.key}-repo`;
  await harness.prisma.githubRepository.create({
    data: {
      id: repositoryId,
      applicationId,
      programId: PROGRAM_ID,
      githubRepositoryId,
      nameWithOwner: `synthetic-org/${repositoryName}`,
      source: RepositorySource.ORG_PROVISIONED,
      visibility: params.visibility,
      publishedAt: params.publishedAt,
    },
  });
  await harness.prisma.repositoryProvisionJob.create({
    data: {
      id: `${PREFIX}-${params.key}-job`,
      applicationId,
      repositoryId,
      status: RepositoryProvisionJobStatus.SUCCEEDED,
      nextAttemptAt: new Date(),
      startedAt: new Date(),
      finishedAt: new Date(),
    },
  });
  return { applicantId, repositoryId, githubRepositoryId, repositoryName };
}

function hashKey(key: string): number {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) % 900_000;
  }
  return hash;
}

describe('public/admin exposure — HTTP 4-페르소나 매트릭스 (todo 23)', () => {
  beforeAll(async () => {
    await harness.start();

    await harness.prisma.program.create({
      data: {
        id: PROGRAM_ID,
        name: `${PREFIX}-program`,
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

    // 순위 노출은 권한이 아니라 canonical 회원 유형이 가른다 — 학생 persona만 STUDENT 유형을
    // 달고, 교직원·관리자 persona는 STAFF 유형이라 같은 공개 라우트를 200으로 열면서도
    // 순위 목록에는 실리지 않는다.
    studentPersona = await harness.createUser(
      'student',
      'STUDENT',
      undefined,
      MemberKind.STUDENT,
    );
    canonicalOnlyStudentPersona = await harness.createUser(
      'canonical-only-student',
      'STUDENT',
      undefined,
      MemberKind.STUDENT,
    );
    staffPersona = await harness.createUser(
      'staff',
      'STAFF',
      undefined,
      MemberKind.STAFF,
    );
    adminPersona = await harness.createUser(
      'admin',
      'ADMIN',
      undefined,
      MemberKind.STAFF,
    );

    // 공개 라우트 4종(list/detail/profile/ranking)이 4-페르소나 모두에게 동일하게 열려
    // 있음을 증명할 happy-path 공개 프로젝트.
    const published = await createRepositoryFixture({
      key: 'published',
      visibility: RepositoryVisibility.PUBLIC,
      publishedAt: PUBLISHED_AT,
    });
    publicProject = published;
    // 같은 githubRepositoryId 행을 collection 관찰 필드로 갱신한다(#617 단계 D 이후
    // applicationId 행과 collection 행은 같은 유일 행이라 별도 create가 P2002를 낸다).
    await harness.prisma.githubRepository.update({
      where: { id: published.repositoryId },
      data: {
        githubOrganizationId: 8_900_000_000_001n,
        defaultBranch: 'main',
        presence: CollectionRepositoryPresence.PRESENT,
        lastCompleteInventoryObservedAt: new Date('2026-06-15T00:00:00.000Z'),
      },
    });
    await harness.prisma.contribution.createMany({
      data: [
        {
          repositoryId: published.repositoryId,
          githubId: 8_950_000_000_001n,
          date: new Date(Date.UTC(2026, 0, 2)),
          commitCount: 5,
          pullRequestCount: 2,
          releaseCount: 1,
        },
      ],
    });
    // 옛 저장소 총계 행은 넣지 않는다 — `Contribution` 은 사람 축 하나이고
    // 키가 (repositoryId, githubId, date) 라 위 행과 PK 가 충돌한다(ADR-010 §4).

    // 공개 랭킹 실명 비노출을 실물 HTTP 응답으로 증명할 fixture — DB 에 실명이
    // **채워져 있는데도** 응답에 나오지 않아야 한다. 동시에 연도가 둘인 사람 축 관측을
    // 심어, 연도 질의가 요청한 해만 집계하는지(과거 연도 혼입 없음)도 같은 fixture 로 본다.
    await harness.prisma.user.update({
      where: { id: studentPersona.id },
      data: {
        // canonical 프로필이 있으면 공개 응답은 legacy 칸이 아니라 이쪽을 읽는다
        // (`profile-compatibility.ts`) — 실명 비노출 단언이 공허해지지 않게 둘 다 채운다.
        profile: {
          update: {
            name: NAMED_PERSONA_REAL_NAME,
            department: NAMED_PERSONA_DEPARTMENT,
            affiliationName: NAMED_PERSONA_DEPARTMENT,
          },
        },
      },
    });
    await harness.prisma.githubUserActivityHistory.createMany({
      data: [
        {
          githubId: studentPersona.githubId,
          githubLogin: studentPersona.nickname ?? '',
          year: RANKING_FIXTURE_YEAR,
          commitCount: 10,
          pullRequestCount: 4,
          issueCount: 3,
          repositoryCount: 2,
          starCount: 1,
          observedAt: new Date('2026-08-19T00:00:00.000Z'),
        },
        {
          githubId: studentPersona.githubId,
          githubLogin: studentPersona.nickname ?? '',
          year: RANKING_FIXTURE_YEAR - 1,
          commitCount: 1_000,
          pullRequestCount: 1_000,
          issueCount: 1_000,
          repositoryCount: 1_000,
          starCount: 1_000,
          observedAt: new Date('2025-12-31T00:00:00.000Z'),
        },
      ],
    });

    // 4중 게이트를 전부 통과하는 PRIVATE 저장소 2개 — 하나는 STAFF가, 하나는 ADMIN이
    // 실제 HTTP POST로 확정한다(둘 다 SubmissionReviewsStaffGuard를 통과해야 하는
    // STAFF+ADMIN 게이트라는 걸 증명). AuditLog 라우트는 반대로 ADMIN 전용임을 별도로
    // 증명한다 — 두 게이트의 범위가 다르다는 게 staff/admin regression의 핵심이다.
    gateRepoForStaff = await createRepositoryFixture({
      key: 'gate-staff',
      visibility: RepositoryVisibility.PRIVATE,
      publishedAt: null,
    });
    gateRepoForAdmin = await createRepositoryFixture({
      key: 'gate-admin',
      visibility: RepositoryVisibility.PRIVATE,
      publishedAt: null,
    });
  });

  afterAll(async () => {
    try {
      await harness.prisma.contribution.deleteMany({
        where: { repositoryId: { startsWith: `${PREFIX}-` } },
      });
      await harness.prisma.githubUserActivityHistory.deleteMany({
        where: { githubId: studentPersona.githubId },
      });
      await harness.prisma.repositoryProvisionJob.deleteMany({
        where: { id: { startsWith: `${PREFIX}-` } },
      });
      await harness.prisma.githubRepository.deleteMany({
        where: { id: { startsWith: `${PREFIX}-` } },
      });
      await harness.prisma.application.deleteMany({
        where: { id: { startsWith: `${PREFIX}-` } },
      });
      await harness.prisma.teamMember.deleteMany({
        where: { id: { startsWith: `${PREFIX}-` } },
      });
      await harness.prisma.team.deleteMany({
        where: { id: { startsWith: `${PREFIX}-` } },
      });
      // AuditLog는 append-only다 — 이 파일이 만든 REPOSITORY_PUBLISHED 행은 지우지 않고,
      // 그 행들이 actorId로 FK 참조하는 STAFF/ADMIN persona User도 `not: [...]`로 정리
      // 대상에서 제외한다(`submission-reviews.integration.spec.ts`와 동일한 관행).
      // 같은 이유로 `FOREIGN_SUITE_ACTOR_ID`도 남긴다 — 그 id는 `${PREFIX}-`로 시작하지
      // 않으므로 아래 deleteMany의 대상이 아니다.
      await harness.prisma.user.deleteMany({
        where: {
          id: { startsWith: `${PREFIX}-` },
          NOT: { id: { in: [staffPersona.id, adminPersona.id] } },
        },
      });
      await harness.prisma.program.deleteMany({
        where: { id: PROGRAM_ID },
      });
    } finally {
      await harness.stop();
    }
  });

  it('공개 라우트(list/detail/profile/ranking)는 익명·STUDENT·STAFF·ADMIN 전부에게 동일하게 200이다', async () => {
    const personas: (bigint | undefined)[] = [
      undefined,
      studentPersona.githubId,
      staffPersona.githubId,
      adminPersona.githubId,
    ];

    const allBodies: unknown[] = [];
    // Public class (anonymous · STUDENT) — 실명 금지 검사는 이쪽에만 건다.
    const publicClassRankingItemLists: Record<string, unknown>[][] = [];
    const staffClassRankingItemLists: Record<string, unknown>[][] = [];
    const publicItemKeys = [
      'commitCount',
      'department',
      'displayName',
      'githubLogin',
      'issueCount',
      'pullRequestCount',
      'rank',
      'repositoryCount',
      'starCount',
      'total',
    ];
    const staffItemKeys = [...publicItemKeys, 'name'].sort();
    for (const githubId of personas) {
      const [list, detail, profile, ranking] = await Promise.all([
        harness.request('GET', '/projects', githubId),
        harness.request(
          'GET',
          `/projects/${publicProject.githubRepositoryId}`,
          githubId,
        ),
        harness.request(
          'GET',
          `/users/${publicProject.applicantId}/public-profile`,
          githubId,
        ),
        fetchRankingPages('/ranking?period=ALL', githubId),
      ]);

      expect([
        list.status,
        detail.status,
        profile.status,
        ranking.response.status,
      ]).toEqual([200, 200, 200, 200]);

      type WireBody = Record<string, unknown>;
      const [listBody, detailBody, profileBody] = (await Promise.all([
        list.json(),
        detail.json(),
        profile.json(),
      ])) as readonly [WireBody, WireBody, WireBody];
      allBodies.push(listBody, detailBody, profileBody);
      if (githubId === undefined || githubId === studentPersona.githubId) {
        publicClassRankingItemLists.push(ranking.items);
      } else {
        staffClassRankingItemLists.push(ranking.items);
      }

      expect(listBody.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            projectId: publicProject.githubRepositoryId.toString(),
          }),
        ]),
      );
      expect(detailBody).toMatchObject({
        projectId: publicProject.githubRepositoryId.toString(),
        contributors: [expect.objectContaining({})],
      });
      expect(profileBody).toMatchObject({
        userId: publicProject.applicantId,
        projects: [expect.objectContaining({ observed: true })],
      });
      // 이 파일이 심은 persona 가 랭킹 목록에 실제로 있는지를 고정한다 — "뭔가 하나라도
      // 있다"가 아니라 시드 코호트가 있다는 게 이 라우트가 열려 있다는 증거다.
      // 순위에 오를 자격은 canonical 학생뿐이라, 같은 200 응답이더라도 교직·관리자
      // persona 는 목록 안에 없어야 한다 — 라우트 개방과 행 자격은 다른 문제다.
      const rankedLogins = ranking.items.map(
        (item) => item.githubLogin as string,
      );
      expect(rankedLogins).toEqual(
        expect.arrayContaining([
          studentPersona.nickname,
          canonicalOnlyStudentPersona.nickname,
        ]),
      );
      expect(rankedLogins).not.toContain(staffPersona.nickname);
      expect(rankedLogins).not.toContain(adminPersona.nickname);
    }

    // Public items omit `name`. Staff items add `name` and keep displayName as login.
    for (const items of publicClassRankingItemLists) {
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(Object.keys(item).sort()).toEqual(publicItemKeys);
        expect(item).not.toHaveProperty('name');
        expect(item.displayName).toBe(item.githubLogin);
        expect(item.total).toBe(
          (item.commitCount as number) +
            (item.pullRequestCount as number) +
            (item.issueCount as number) +
            (item.repositoryCount as number) +
            (item.starCount as number),
        );
      }
    }
    for (const items of staffClassRankingItemLists) {
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(Object.keys(item).sort()).toEqual(staffItemKeys);
        expect(item).toHaveProperty('name');
        expect(item.displayName).toBe(item.githubLogin);
        expect(item.total).toBe(
          (item.commitCount as number) +
            (item.pullRequestCount as number) +
            (item.issueCount as number) +
            (item.repositoryCount as number) +
            (item.starCount as number),
        );
      }
    }

    // 동일 wire body가 4-페르소나 전부에서 반복 수집된다 — 아래 forbidden-key 검사는
    // 이 실제 HTTP 직렬화 결과에 대해서만 의미가 있다(DB 레벨 파일은 raw 도메인 결과라
    // githubId 등 내부 전용 필드가 남아 있어 이 검사를 미뤘다). `"department"` 는
    // ranking 전용 공개 필드라 여기(list/detail/profile)에서는 여전히 금지다.
    const serialized = JSON.stringify(allBodies);
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
      '"githubId"',
      '"isRepositoryPublicationPlanned"',
      '"lease"',
      '"watermark"',
      '"cursor"',
      '"runId"',
    ]) {
      expect(serialized).not.toContain(forbiddenKey);
    }
    const publicRankingSerialized = JSON.stringify(publicClassRankingItemLists);
    for (const forbiddenKey of [
      '"name"',
      '"studentId"',
      '"email"',
      '"role"',
      '"accountStatus"',
      '"githubId"',
      '"releaseCount"',
    ]) {
      expect(publicRankingSerialized).not.toContain(forbiddenKey);
    }
    const staffRankingSerialized = JSON.stringify(staffClassRankingItemLists);
    for (const forbiddenKey of [
      '"studentId"',
      '"email"',
      '"role"',
      '"accountStatus"',
      '"githubId"',
      '"releaseCount"',
    ]) {
      expect(staffRankingSerialized).not.toContain(forbiddenKey);
    }
    // DB 에 실명이 채워져 있는 persona 인데도 공개 계층 응답 바디에는 그 값이 없다.
    expect(publicRankingSerialized).not.toContain(NAMED_PERSONA_REAL_NAME);
  });

  it('같은 /ranking URL 이 계층별로 다른 표기를 내린다 — 교직원·관리자만 실명을 본다 (todo 15)', async () => {
    const path = `/ranking?year=${RANKING_FIXTURE_YEAR}`;
    const [anonymous, student, staff, admin] = await Promise.all([
      fetchRankingPages(path, undefined),
      fetchRankingPages(path, studentPersona.githubId),
      fetchRankingPages(path, staffPersona.githubId),
      fetchRankingPages(path, adminPersona.githubId),
    ]);
    expect([
      anonymous.response.status,
      student.response.status,
      staff.response.status,
      admin.response.status,
    ]).toEqual([200, 200, 200, 200]);

    // (g) 인증(교직원·관리자) 응답은 공유 캐시에 남지 않는다.
    expect(anonymous.response.headers.get('cache-control')).toBe('no-store');
    expect(student.response.headers.get('cache-control')).toBe('no-store');
    expect(staff.response.headers.get('cache-control')).toBe(
      'private, no-store',
    );
    expect(staff.response.headers.get('vary')).toBe('Cookie');
    expect(admin.response.headers.get('cache-control')).toBe(
      'private, no-store',
    );
    expect(admin.response.headers.get('vary')).toBe('Cookie');

    // (a) 비로그인은 학과를 보고 실명은 보지 않는다.
    const anonymousEntry = anonymous.items.find(
      (item) => item.githubLogin === studentPersona.nickname,
    );
    expect(anonymousEntry).toMatchObject({
      department: NAMED_PERSONA_DEPARTMENT,
      displayName: studentPersona.nickname,
    });
    expect(JSON.stringify(anonymous.items)).not.toContain(
      NAMED_PERSONA_REAL_NAME,
    );

    // (b) STUDENT 세션 응답은 비로그인과 바이트 동일하다.
    expect(JSON.stringify(student.items)).toBe(JSON.stringify(anonymous.items));

    // (c)(d) STAFF·ADMIN keep displayName as githubLogin and put 실명 on `name`.
    for (const staffClassItems of [staff.items, admin.items]) {
      const entry = staffClassItems.find(
        (item) => item.githubLogin === studentPersona.nickname,
      );
      expect(entry).toMatchObject({
        githubLogin: studentPersona.nickname,
        displayName: studentPersona.nickname,
        department: NAMED_PERSONA_DEPARTMENT,
        name: NAMED_PERSONA_REAL_NAME,
      });
    }
    // ADMIN 응답은 STAFF 응답과 같다.
    expect(JSON.stringify(admin.items)).toBe(JSON.stringify(staff.items));

    // (e) legacy `User.name` 이 비어 있어도 표기는 githubLogin 이고 실명 칸은 canonical
    // 프로필을 그대로 실는다 — 순위에 오르는 행은 이제 전부 canonical 프로필을 갖는다.
    const canonicalOnlyProfile = await harness.prisma.userProfile.findUnique({
      where: { userId: canonicalOnlyStudentPersona.id },
      select: { name: true },
    });
    const canonicalOnlyEntry = staff.items.find(
      (item) => item.githubLogin === canonicalOnlyStudentPersona.nickname,
    );
    expect(canonicalOnlyEntry).toMatchObject({
      displayName: canonicalOnlyStudentPersona.nickname,
      name: canonicalOnlyProfile?.name,
    });
    // 교직원 persona 는 교직원 열람자 응답에서도 목록에 없다.
    expect(
      staff.items.some((item) => item.githubLogin === staffPersona.nickname),
    ).toBe(false);

    // (f) 등수 순서는 네 계층이 완전히 같다 — 실명이 순서를 바트지 않는다.
    const order = (items: Record<string, unknown>[]) =>
      items.map((item) => `${String(item.rank)}:${String(item.githubLogin)}`);
    expect(order(student.items)).toEqual(order(anonymous.items));
    expect(order(staff.items)).toEqual(order(anonymous.items));
    expect(order(admin.items)).toEqual(order(anonymous.items));
  });

  it('연도 질의는 그 해 관측만 합산한다 — 지난 연도 행이 있어도 섞이지 않는다', async () => {
    const ranking = await fetchRankingPages(
      `/ranking?year=${RANKING_FIXTURE_YEAR}`,
      undefined,
    );
    expect(ranking.response.status).toBe(200);
    const entry = ranking.items.find(
      (item) => item.githubLogin === studentPersona.nickname,
    );
    // fixture 는 올해 10/4/3/2/1, 지난해 1000×5 를 심었다 — 지난해가 새면 total 이
    // 5020 이 된다.
    expect(entry).toMatchObject({
      displayName: studentPersona.nickname,
      department: NAMED_PERSONA_DEPARTMENT,
      commitCount: 10,
      pullRequestCount: 4,
      issueCount: 3,
      repositoryCount: 2,
      starCount: 1,
      total: 20,
    });
    expect(JSON.stringify(ranking.items)).not.toContain(
      NAMED_PERSONA_REAL_NAME,
    );
  });

  it('POST /repositories/:id/publish — 익명은 401, STUDENT는 403, STAFF/ADMIN은 200이다(실제 SessionGuard+SubmissionReviewsStaffGuard)', async () => {
    const anonymous = await harness.request(
      'POST',
      `/repositories/${gateRepoForStaff.repositoryId}/publish`,
      undefined,
      { isConfirmed: true },
    );
    expect(anonymous.status).toBe(401);
    await expect(anonymous.json()).resolves.toMatchObject({ code: 'AUT_003' });

    const student = await harness.request(
      'POST',
      `/repositories/${gateRepoForStaff.repositoryId}/publish`,
      studentPersona.githubId,
      { isConfirmed: true },
    );
    expect(student.status).toBe(403);
    await expect(student.json()).resolves.toMatchObject({ code: 'SUB_002' });

    harness.githubPublishRepositoryMock?.mockResolvedValue({
      githubRepositoryId: gateRepoForStaff.githubRepositoryId,
      name: `${PREFIX}-gate-staff-repo`,
      nameWithOwner: `synthetic-org/${PREFIX}-gate-staff-repo`,
      url: `https://github.invalid/${PREFIX}/${PREFIX}-gate-staff-repo`,
      visibility: RepositoryVisibility.PUBLIC,
      description: null,
    });
    const staff = await harness.request(
      'POST',
      `/repositories/${gateRepoForStaff.repositoryId}/publish`,
      staffPersona.githubId,
      { isConfirmed: true },
    );
    expect(staff.status).toBe(200);
    await expect(staff.json()).resolves.toMatchObject({
      repositoryId: gateRepoForStaff.repositoryId,
      visibility: RepositoryVisibility.PUBLIC,
    });

    harness.githubPublishRepositoryMock?.mockResolvedValue({
      githubRepositoryId: gateRepoForAdmin.githubRepositoryId,
      name: `${PREFIX}-gate-admin-repo`,
      nameWithOwner: `synthetic-org/${PREFIX}-gate-admin-repo`,
      url: `https://github.invalid/${PREFIX}/${PREFIX}-gate-admin-repo`,
      visibility: RepositoryVisibility.PUBLIC,
      description: null,
    });
    const admin = await harness.request(
      'POST',
      `/repositories/${gateRepoForAdmin.repositoryId}/publish`,
      adminPersona.githubId,
      { isConfirmed: true },
    );
    expect(admin.status).toBe(200);
    await expect(admin.json()).resolves.toMatchObject({
      repositoryId: gateRepoForAdmin.repositoryId,
      visibility: RepositoryVisibility.PUBLIC,
    });

    // 허용되지 않은 Origin은 SessionGuard를 통과해도 실제 OriginGuard가 별도로 막는다.
    const wrongOrigin = await harness.request(
      'POST',
      `/repositories/${gateRepoForAdmin.repositoryId}/publish`,
      adminPersona.githubId,
      { isConfirmed: true },
      { origin: 'http://evil-persona.test' },
    );
    expect(wrongOrigin.status).toBe(403);
    await expect(wrongOrigin.json()).resolves.toMatchObject({
      code: 'AUT_002',
    });

    const auditRows = await harness.prisma.auditLog.findMany({
      where: { targetType: 'REPOSITORY', action: 'REPOSITORY_PUBLISHED' },
    });
    expect(
      auditRows.some((row) => row.targetId === gateRepoForStaff.repositoryId),
    ).toBe(true);
    expect(
      auditRows.some((row) => row.targetId === gateRepoForAdmin.repositoryId),
    ).toBe(true);
  });

  it('GET /audit-logs — 익명은 401, STUDENT/STAFF는 403(ADMIN 전용), ADMIN만 200이고 action registry·no-forbidden-key를 만족한다', async () => {
    // POST 테스트가 이미 REPOSITORY_PUBLISHED 행 2건을 만들어 뒀다(describe 블록 실행 순서
    // 보장 — Jest는 같은 describe 안의 it을 정의 순서대로 순차 실행한다).
    const anonymous = await harness.request('GET', '/audit-logs');
    expect(anonymous.status).toBe(401);
    await expect(anonymous.json()).resolves.toMatchObject({ code: 'AUT_003' });

    const student = await harness.request(
      'GET',
      '/audit-logs',
      studentPersona.githubId,
    );
    expect(student.status).toBe(403);
    await expect(student.json()).resolves.toMatchObject({ code: 'AUD_001' });

    // 핵심 회귀 포인트: 저장소 공개 확정은 STAFF도 되지만, 감사 로그 열람은 ADMIN 전용이다
    // — 같은 "STAFF" 역할이 라우트에 따라 다른 결과를 받는다(staff/admin regression, todo 22).
    const staff = await harness.request(
      'GET',
      '/audit-logs',
      staffPersona.githubId,
    );
    expect(staff.status).toBe(403);
    await expect(staff.json()).resolves.toMatchObject({ code: 'AUD_001' });

    // #622 — 이 파일 밖의 스위트(`users/admin-access-mutation.integration.spec.ts`)가 같은
    // append-only AuditLog 테이블에 남기는 행을 여기서 직접 재현한다. 그 스위트가 먼저 돌면
    // 전역 "최근 N건" 창에 딱 이 모양의 행이 섞여 들어와 아래 금지 키 검사가 깨졌었다.
    // 이 fixture 덕분에 "누가 먼저 도는가"와 무관하게 이 파일 하나로 격리를 증명한다.
    await harness.prisma.user.create({
      data: {
        id: FOREIGN_SUITE_ACTOR_ID,
        githubId: 8_970_000_000_001n,
        nickname: `${FOREIGN_SUITE_ACTOR_ID}-login`,
        // 이 행의 actor 역할은 검사와 무관하다. append-only 원장이라 이 User는 FK 때문에
        // 정리되지 않고 남으므로, 전역 ADMIN 수를 세는 다른 스펙과 얽히지 않게 STAFF로 둔다.
        selectedMemberKind: MemberKind.STAFF,
        hasStaffAccess: true,
      },
    });
    await harness.prisma.auditLog.create({
      data: {
        actorId: FOREIGN_SUITE_ACTOR_ID,
        action: ACCESS_AUDIT_ACTIONS.ROLE_REQUEST_REJECTED,
        targetType: 'ROLE_REQUEST',
        targetId: FOREIGN_SUITE_ROLE_REQUEST_ID,
        metadata: createAccessAuditMetadata({
          eventKind: ACCESS_AUDIT_EVENT_KINDS.ROLE_REQUEST_REJECTED,
          rejectionReason: 'synthetic-foreign-suite-rejection-reason',
          actor: {
            githubLogin: `${FOREIGN_SUITE_ACTOR_ID}-login`,
            displayName: null,
          },
          target: {
            githubLogin: `${FOREIGN_SUITE_ROLE_REQUEST_ID}-login`,
            displayName: null,
          },
          before: {
            role: null,
            accountStatus: AccountStatus.ACTIVE,
            requestStatus: StaffAccessRequestStatus.PENDING,
          },
          after: {
            role: null,
            accountStatus: AccountStatus.ACTIVE,
            requestStatus: StaffAccessRequestStatus.REJECTED,
          },
        }),
      },
    });

    // 조회 창을 endpoint가 이미 제공하는 `actor` 필터로 이 파일의 페르소나가 쓴 행에 한정한다.
    // 전역 최근 N건(`?limit=100`)을 그대로 보면 다른 스펙 파일이 만든 행이 창에 들어와 결과가
    // 실행 순서에 좌우된다(#622). 좁히는 것은 "어느 데이터를 보는가"이며, 아래 금지 키 목록은
    // 그대로 유지한다 — 노출 계약 자체는 조금도 무르게 하지 않는다.
    const admin = await harness.request(
      'GET',
      `/audit-logs?limit=100&actor=${encodeURIComponent(OWN_AUDIT_ACTOR_FILTER)}`,
      adminPersona.githubId,
    );
    expect(admin.status).toBe(200);
    const adminBody = (await admin.json()) as {
      items: readonly Record<string, unknown>[];
      total: number;
    };

    // 창이 실제로 닫혀 있다는 증거 — 방금 심은 외부 스위트 모방 행이 가장 최근 행인데도
    // 응답에 없고, 이 파일이 만든 REPOSITORY_PUBLISHED 2건이 전부다. `limit=100`이 기대 건수보다
    // 훨씬 넉넉하므로 이 2건은 잘려서가 아니라 필터로 좁혀진 결과다.
    expect(adminBody.total).toBe(2);
    expect([...adminBody.items].map((item) => item.targetId).sort()).toEqual(
      [gateRepoForAdmin.repositoryId, gateRepoForStaff.repositoryId].sort(),
    );

    const published = adminBody.items.filter(
      (item) =>
        item.action === 'REPOSITORY_PUBLISHED' &&
        (item.targetId === gateRepoForStaff.repositoryId ||
          item.targetId === gateRepoForAdmin.repositoryId),
    );
    expect(published).toHaveLength(2);
    for (const item of published) {
      expect(item.targetType).toBe('REPOSITORY');
      expect(typeof item.actor).toBe('string');
      expect(item.actor).not.toBe(staffPersona.id);
      expect(item.actor).not.toBe(adminPersona.id);
    }

    const serialized = JSON.stringify(adminBody);
    for (const forbiddenKey of [
      '"name"',
      '"studentId"',
      '"department"',
      '"email"',
      '"answers"',
      '"rejectionReason"',
      '"lease"',
      '"watermark"',
      '"cursor"',
      '"runId"',
    ]) {
      expect(serialized).not.toContain(forbiddenKey);
    }
  });
});
