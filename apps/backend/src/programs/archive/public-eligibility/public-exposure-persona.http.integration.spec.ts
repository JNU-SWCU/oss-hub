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
  ProgramTrackType,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../../../test/integration-database.guard';
import {
  ACCESS_AUDIT_ACTIONS,
  ACCESS_AUDIT_EVENT_KINDS,
  createAccessAuditMetadata,
} from '../../../audit-log/domain/audit-log-metadata';
import { PublicExposurePersonaHttpHarness } from './public-exposure-persona.http.integration-support';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const PREFIX = 'synthetic-exposure-persona';

const NAMED_PERSONA_REAL_NAME = 'synthetic-forbidden-persona-real-name';
const NAMED_PERSONA_DEPARTMENT = 'synthetic-persona-department';

const RANKING_FIXTURE_YEAR = 2026;
const harness = new PublicExposurePersonaHttpHarness(PREFIX);

const OWN_AUDIT_ACTOR_FILTER = `${PREFIX}-http-`;

const FOREIGN_SUITE_ACTOR_ID = 'synthetic-foreign-audit-suite-actor';
const FOREIGN_SUITE_ROLE_REQUEST_ID =
  'synthetic-foreign-audit-suite-role-request';

const PROGRAM_ID = `${PREFIX}-program`;
const PUBLISHED_AT = new Date('2026-06-01T00:00:00.000Z');

const RANKING_MAX_PAGE_SIZE = 100;

type RankingWireBody = {
  readonly items: Record<string, unknown>[];
  readonly total: number;
};

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
        trackType: ProgramTrackType.EXTRACURRICULAR,
        category: ProgramCategory.BASIC,
        applicationTemplateKey: 'synthetic-template',
        applicationTemplateVersion: 1,
        applicationStartAt: new Date('2026-01-01T00:00:00.000Z'),
        applicationEndAt: new Date('2026-02-01T00:00:00.000Z'),
        endAt: new Date('2026-05-15T00:00:00.000Z'),
        description: 'synthetic-description — program already ended',
      },
    });

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

    const published = await createRepositoryFixture({
      key: 'published',
      visibility: RepositoryVisibility.PUBLIC,
      publishedAt: PUBLISHED_AT,
    });
    publicProject = published;

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

    await harness.prisma.user.update({
      where: { id: studentPersona.id },
      data: {
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

    const publicClassRankingItemLists: Record<string, unknown>[][] = [];
    const memberClassRankingItemLists: Record<string, unknown>[][] = [];
    const staffClassRankingItemLists: Record<string, unknown>[][] = [];

    const publicItemKeys = [
      'commitCount',
      'githubLogin',
      'pullRequestCount',
      'rank',
    ];

    const memberItemKeys = [
      'commitCount',
      'githubLogin',
      'issueCount',
      'pullRequestCount',
      'rank',
      'repositoryCount',
      'starCount',
      'total',
    ];

    const staffItemKeys = [
      'commitCount',
      'department',
      'displayName',
      'githubLogin',
      'issueCount',
      'name',
      'pullRequestCount',
      'rank',
      'repositoryCount',
      'starCount',
      'total',
    ].sort();
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
      if (githubId === undefined) {
        publicClassRankingItemLists.push(ranking.items);
      } else if (githubId === studentPersona.githubId) {
        memberClassRankingItemLists.push(ranking.items);
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

    for (const items of publicClassRankingItemLists) {
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(Object.keys(item).sort()).toEqual(publicItemKeys);
        expect(item).not.toHaveProperty('name');
        expect(item).not.toHaveProperty('department');
        expect(item).not.toHaveProperty('displayName');
      }
    }
    for (const items of memberClassRankingItemLists) {
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(Object.keys(item).sort()).toEqual(memberItemKeys);

        expect(item).not.toHaveProperty('name');
        expect(item).not.toHaveProperty('department');
        expect(item).not.toHaveProperty('displayName');
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
      '"department"',
      '"displayName"',
      '"email"',
      '"role"',
      '"accountStatus"',
      '"githubId"',
      '"releaseCount"',
      '"issueCount"',
      '"repositoryCount"',
      '"starCount"',
      '"total"',
    ]) {
      expect(publicRankingSerialized).not.toContain(forbiddenKey);
    }
    const memberRankingSerialized = JSON.stringify(memberClassRankingItemLists);
    for (const forbiddenKey of [
      '"name"',
      '"studentId"',
      '"department"',
      '"displayName"',
      '"email"',
      '"role"',
      '"accountStatus"',
      '"githubId"',
      '"releaseCount"',
    ]) {
      expect(memberRankingSerialized).not.toContain(forbiddenKey);
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

    expect(publicRankingSerialized).not.toContain(NAMED_PERSONA_REAL_NAME);
    expect(memberRankingSerialized).not.toContain(NAMED_PERSONA_REAL_NAME);
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

    expect(anonymous.response.headers.get('cache-control')).toBe('no-store');
    expect(student.response.headers.get('cache-control')).toBe(
      'private, no-store',
    );
    expect(student.response.headers.get('vary')).toBe('Cookie');
    expect(staff.response.headers.get('cache-control')).toBe(
      'private, no-store',
    );
    expect(staff.response.headers.get('vary')).toBe('Cookie');
    expect(admin.response.headers.get('cache-control')).toBe(
      'private, no-store',
    );
    expect(admin.response.headers.get('vary')).toBe('Cookie');

    const anonymousEntry = anonymous.items.find(
      (item) => item.githubLogin === studentPersona.nickname,
    );
    expect(anonymousEntry).toMatchObject({
      githubLogin: studentPersona.nickname,
      commitCount: 10,
      pullRequestCount: 4,
    });
    expect(anonymousEntry).not.toHaveProperty('department');
    expect(anonymousEntry).not.toHaveProperty('name');
    expect(anonymousEntry).not.toHaveProperty('displayName');
    expect(JSON.stringify(anonymous.items)).not.toContain(
      NAMED_PERSONA_REAL_NAME,
    );
    expect(JSON.stringify(anonymous.items)).not.toContain(
      NAMED_PERSONA_DEPARTMENT,
    );

    const studentEntry = student.items.find(
      (item) => item.githubLogin === studentPersona.nickname,
    );
    expect(studentEntry).toMatchObject({
      githubLogin: studentPersona.nickname,
      commitCount: 10,
      pullRequestCount: 4,
      issueCount: 3,
      repositoryCount: 2,
      starCount: 1,
      total: 20,
    });
    expect(studentEntry).not.toHaveProperty('department');
    expect(studentEntry).not.toHaveProperty('name');
    expect(studentEntry).not.toHaveProperty('displayName');

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

    expect(JSON.stringify(admin.items)).toBe(JSON.stringify(staff.items));

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

    expect(
      staff.items.some((item) => item.githubLogin === staffPersona.nickname),
    ).toBe(false);

    const order = (items: Record<string, unknown>[]) =>
      items.map((item) => `${String(item.rank)}:${String(item.githubLogin)}`);
    expect(order(student.items)).toEqual(order(anonymous.items));
    expect(order(staff.items)).toEqual(order(anonymous.items));
    expect(order(admin.items)).toEqual(order(anonymous.items));
  });

  it('연도 질의는 그 해 관측만 합산한다 — 지난 연도 행이 있어도 섞이지 않는다', async () => {
    const path = `/ranking?year=${RANKING_FIXTURE_YEAR}`;
    const [ranking, memberRanking] = await Promise.all([
      fetchRankingPages(path, undefined),
      fetchRankingPages(path, studentPersona.githubId),
    ]);
    expect(ranking.response.status).toBe(200);
    expect(memberRanking.response.status).toBe(200);
    const entry = ranking.items.find(
      (item) => item.githubLogin === studentPersona.nickname,
    );

    expect(entry).toMatchObject({
      githubLogin: studentPersona.nickname,
      commitCount: 10,
      pullRequestCount: 4,
    });
    expect(entry).not.toHaveProperty('issueCount');
    expect(entry).not.toHaveProperty('repositoryCount');
    expect(entry).not.toHaveProperty('starCount');
    expect(entry).not.toHaveProperty('total');
    expect(entry).not.toHaveProperty('department');
    expect(entry).not.toHaveProperty('displayName');
    expect(JSON.stringify(ranking.items)).not.toContain(
      NAMED_PERSONA_REAL_NAME,
    );
    expect(JSON.stringify(ranking.items)).not.toContain(
      NAMED_PERSONA_DEPARTMENT,
    );

    const memberEntry = memberRanking.items.find(
      (item) => item.githubLogin === studentPersona.nickname,
    );
    expect(memberEntry).toMatchObject({
      githubLogin: studentPersona.nickname,
      issueCount: 3,
    });
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

    const staff = await harness.request(
      'GET',
      '/audit-logs',
      staffPersona.githubId,
    );
    expect(staff.status).toBe(403);
    await expect(staff.json()).resolves.toMatchObject({ code: 'AUD_001' });

    await harness.prisma.user.create({
      data: {
        id: FOREIGN_SUITE_ACTOR_ID,
        githubId: 8_970_000_000_001n,
        nickname: `${FOREIGN_SUITE_ACTOR_ID}-login`,

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
