import {
  AccountStatus,
  ApplicationStatus,
  CollectionRepositoryPresence,
  ProgramCategory,
  Role,
  RepositoryProvisionJobStatus,
  RepositorySource,
  RepositoryVisibility,
  RoleRequestStatus,
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
        contributors: [expect.objectContaining({})],
      });
      expect(profileBody).toMatchObject({
        userId: publicProject.applicantId,
        projects: [expect.objectContaining({ observed: true })],
      });
      expect(rankingBody.items).toEqual(
        expect.arrayContaining([expect.objectContaining({})]),
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
        role: Role.STAFF,
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
            requestStatus: RoleRequestStatus.PENDING,
          },
          after: {
            role: null,
            accountStatus: AccountStatus.ACTIVE,
            requestStatus: RoleRequestStatus.REJECTED,
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
