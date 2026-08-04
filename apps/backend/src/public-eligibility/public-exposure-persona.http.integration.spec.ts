import {
  ApplicationStatus,
  CollectionRepositoryPresence,
  ProgramCategory,
  Role,
  RepositoryProvisionJobStatus,
  RepositorySource,
  RepositoryVisibility,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
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
const harness = new PublicExposurePersonaHttpHarness(PREFIX);

const PROGRAM_ID = `${PREFIX}-program`;
const PUBLISHED_AT = new Date('2026-06-01T00:00:00.000Z');

let studentPersona: Awaited<ReturnType<typeof harness.createUser>>;
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
      role: Role.STUDENT,
    },
  });
  const applicationId = `${PREFIX}-${params.key}-application`;
  await harness.prisma.application.create({
    data: {
      id: applicationId,
      programId: PROGRAM_ID,
      applicantId,
      answers: { syntheticFixture: true },
      applicationTemplateVersion: 1,
      status: ApplicationStatus.APPROVED,
      isRepositoryPublicationPlanned: true,
      processedAt: new Date(),
    },
  });
  const repositoryId = `${PREFIX}-${params.key}-repository`;
  const repositoryName = `${PREFIX}-${params.key}-repo`;
  await harness.prisma.repository.create({
    data: {
      id: repositoryId,
      applicationId,
      programId: PROGRAM_ID,
      githubRepositoryId,
      name: repositoryName,
      url: `https://github.invalid/${PREFIX}/${repositoryName}`,
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

    studentPersona = await harness.createUser('student', Role.STUDENT);
    staffPersona = await harness.createUser('staff', Role.STAFF);
    adminPersona = await harness.createUser('admin', Role.ADMIN);

    // 공개 라우트 4종(list/detail/profile/ranking)이 4-페르소나 모두에게 동일하게 열려
    // 있음을 증명할 happy-path 공개 프로젝트.
    const published = await createRepositoryFixture({
      key: 'published',
      visibility: RepositoryVisibility.PUBLIC,
      publishedAt: PUBLISHED_AT,
    });
    publicProject = published;
    await harness.prisma.githubRepository.create({
      data: {
        id: `${PREFIX}-published-collection-repository`,
        githubOrganizationId: 8_900_000_000_001n,
        githubRepositoryId: published.githubRepositoryId,
        nameWithOwner: `synthetic-org/${PREFIX}-published`,
        defaultBranch: 'main',
        source: RepositorySource.ORG_PROVISIONED,
        visibility: RepositoryVisibility.PUBLIC,
        presence: CollectionRepositoryPresence.PRESENT,
        lastCompleteInventoryObservedAt: new Date('2026-06-15T00:00:00.000Z'),
      },
    });
    await harness.prisma.collectionContributorYearAggregate.createMany({
      data: [
        {
          repositoryId: `${PREFIX}-published-collection-repository`,
          githubUserId: 8_950_000_000_001n,
          githubLogin: `${PREFIX}-published-owner-login`,
          year: 2026,
          commitCount: 5,
          pullRequestCount: 2,
          releaseCount: 1,
        },
      ],
    });
    await harness.prisma.collectionRepositoryYearAggregate.create({
      data: {
        repositoryId: `${PREFIX}-published-collection-repository`,
        year: 2026,
        commitCount: 5,
        pullRequestCount: 2,
        releaseCount: 1,
      },
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
      await harness.prisma.collectionContributorYearAggregate.deleteMany({
        where: { repositoryId: { startsWith: `${PREFIX}-` } },
      });
      await harness.prisma.collectionRepositoryYearAggregate.deleteMany({
        where: { repositoryId: { startsWith: `${PREFIX}-` } },
      });
      await harness.prisma.githubRepository.deleteMany({
        where: { id: { startsWith: `${PREFIX}-` } },
      });
      await harness.prisma.repositoryProvisionJob.deleteMany({
        where: { id: { startsWith: `${PREFIX}-` } },
      });
      await harness.prisma.repository.deleteMany({
        where: { id: { startsWith: `${PREFIX}-` } },
      });
      await harness.prisma.application.deleteMany({
        where: { id: { startsWith: `${PREFIX}-` } },
      });
      // AuditLog는 append-only다 — 이 파일이 만든 REPOSITORY_PUBLISHED 행은 지우지 않고,
      // 그 행들이 actorId로 FK 참조하는 STAFF/ADMIN persona User도 `not: [...]`로 정리
      // 대상에서 제외한다(`submission-reviews.integration.spec.ts`와 동일한 관행).
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
        harness.request('GET', '/ranking?period=ALL', githubId),
      ]);

      expect([
        list.status,
        detail.status,
        profile.status,
        ranking.status,
      ]).toEqual([200, 200, 200, 200]);

      type WireBody = Record<string, unknown>;
      const [listBody, detailBody, profileBody, rankingBody] =
        (await Promise.all([
          list.json(),
          detail.json(),
          profile.json(),
          ranking.json(),
        ])) as readonly [WireBody, WireBody, WireBody, WireBody];
      allBodies.push(listBody, detailBody, profileBody, rankingBody);

      expect(listBody.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            projectId: publicProject.githubRepositoryId.toString(),
          }),
        ]),
      );
      expect(detailBody).toMatchObject({
        projectId: publicProject.githubRepositoryId.toString(),
        contributors: [
          expect.objectContaining({
            githubLogin: `${PREFIX}-published-owner-login`,
          }),
        ],
      });
      expect(profileBody).toMatchObject({
        userId: publicProject.applicantId,
        projects: [expect.objectContaining({ observed: true })],
      });
      expect(rankingBody.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            githubLogin: `${PREFIX}-published-owner-login`,
          }),
        ]),
      );
    }

    // 동일 wire body가 4-페르소나 전부에서 반복 수집된다 — 아래 forbidden-key 검사는
    // 이 실제 HTTP 직렬화 결과에 대해서만 의미가 있다(DB 레벨 파일은 raw 도메인 결과라
    // githubId 등 내부 전용 필드가 남아 있어 이 검사를 미뤘다).
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

    const admin = await harness.request(
      'GET',
      '/audit-logs?limit=100',
      adminPersona.githubId,
    );
    expect(admin.status).toBe(200);
    const adminBody = (await admin.json()) as {
      items: readonly Record<string, unknown>[];
      total: number;
    };
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
