import {
  ApplicationStatus,
  PrismaClient,
  ProgramCategory,
  RepositoryVisibility,
  Role,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../../../test/integration-database.guard';
import { PrismaService } from '../../../prisma/prisma.service';
import { PublicProjectsRepository } from './public-projects.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const repository = new PublicProjectsRepository(prisma);
const PREFIX = 'synthetic-public-projects';
const PROGRAM_ID = `${PREFIX}-program`;
// 대표 카디널리티 fixture — 페이지네이션 EXPLAIN·N+1 가드 둘 다 이 개수로 충분한 규모를 갖는다.
const PUBLIC_REPOSITORY_COUNT = 40;
const BASE_PUBLISHED_AT = new Date('2026-06-01T00:00:00.000Z');

describe('PublicProjectsRepository integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.program.create({
      data: {
        id: PROGRAM_ID,
        name: `${PREFIX}-program`,
        organizer: 'synthetic-organizer',
        category: ProgramCategory.BASIC,
        applicationTemplateKey: 'synthetic-template',
        applicationTemplateVersion: 1,
        applicationStartAt: new Date('2026-01-01T00:00:00.000Z'),
        applicationEndAt: new Date('2026-02-01T00:00:00.000Z'),
        description: 'synthetic-description',
      },
    });

    const applicantIds = Array.from(
      { length: PUBLIC_REPOSITORY_COUNT },
      (_, index) => `${PREFIX}-applicant-${index}`,
    );
    await prisma.user.createMany({
      data: applicantIds.map((id, index) => ({
        id,
        githubId: 8_600_000_000_000n + BigInt(index),
        nickname: `${PREFIX}-applicant-${index}`,
        role: Role.STUDENT,
      })),
    });
    const applicationIds = applicantIds.map(
      (_, index) => `${PREFIX}-application-${index}`,
    );
    const teamIds = applicantIds.map((_, index) => `${PREFIX}-team-${index}`);
    await prisma.team.createMany({
      data: teamIds.map((id, index) => ({
        id,
        programId: PROGRAM_ID,
        name: `${PREFIX}-team-${index}`,
        joinCodeDigest: `${PREFIX}-team-digest-${index}`,
        leaderId: applicantIds[index]!,
      })),
    });
    await prisma.teamMember.createMany({
      data: teamIds.map((id, index) => ({
        id: `${PREFIX}-team-member-${index}`,
        teamId: id,
        programId: PROGRAM_ID,
        userId: applicantIds[index]!,
      })),
    });
    await prisma.application.createMany({
      data: applicationIds.map((id, index) => ({
        id,
        programId: PROGRAM_ID,
        applicantId: applicantIds[index]!,
        teamId: teamIds[index]!,
        answers: {},
        applicationTemplateVersion: 1,
        status: ApplicationStatus.APPROVED,
      })),
    });
    // publishedAt을 인덱스 정렬 순서(desc)와 다르게 흩뿌려 실제 인덱스 스캔이 정렬을 대신함을 보인다.
    await prisma.repository.createMany({
      data: applicationIds.map((id, index) => ({
        id: `${PREFIX}-repository-${index}`,
        applicationId: id,
        programId: PROGRAM_ID,
        githubRepositoryId: 8_700_000_000_000n + BigInt(index),
        name: `${PREFIX}-repo-${index}`,
        url: `https://github.com/synthetic-org/${PREFIX}-repo-${index}`,
        visibility: RepositoryVisibility.PUBLIC,
        publishedAt: new Date(
          BASE_PUBLISHED_AT.getTime() +
            ((index * 37) % PUBLIC_REPOSITORY_COUNT) * 86_400_000,
        ),
      })),
    });

    // private/unpublished 대조군 — 결과에 절대 섞이지 않아야 한다.
    const privateApplicantId = `${PREFIX}-private-applicant`;
    const unpublishedApplicantId = `${PREFIX}-unpublished-applicant`;
    await prisma.user.createMany({
      data: [
        {
          id: privateApplicantId,
          githubId: 8_600_000_099_001n,
          nickname: `${PREFIX}-private-applicant`,
          role: Role.STUDENT,
        },
        {
          id: unpublishedApplicantId,
          githubId: 8_600_000_099_002n,
          nickname: `${PREFIX}-unpublished-applicant`,
          role: Role.STUDENT,
        },
      ],
    });
    await prisma.team.createMany({
      data: [
        {
          id: `${PREFIX}-private-team`,
          programId: PROGRAM_ID,
          name: `${PREFIX}-private-team`,
          joinCodeDigest: `${PREFIX}-private-team-digest`,
          leaderId: privateApplicantId,
        },
        {
          id: `${PREFIX}-unpublished-team`,
          programId: PROGRAM_ID,
          name: `${PREFIX}-unpublished-team`,
          joinCodeDigest: `${PREFIX}-unpublished-team-digest`,
          leaderId: unpublishedApplicantId,
        },
      ],
    });
    await prisma.teamMember.createMany({
      data: [
        {
          id: `${PREFIX}-private-team-member`,
          teamId: `${PREFIX}-private-team`,
          programId: PROGRAM_ID,
          userId: privateApplicantId,
        },
        {
          id: `${PREFIX}-unpublished-team-member`,
          teamId: `${PREFIX}-unpublished-team`,
          programId: PROGRAM_ID,
          userId: unpublishedApplicantId,
        },
      ],
    });
    await prisma.application.createMany({
      data: [
        {
          id: `${PREFIX}-private-application`,
          programId: PROGRAM_ID,
          applicantId: privateApplicantId,
          teamId: `${PREFIX}-private-team`,
          answers: {},
          applicationTemplateVersion: 1,
          status: ApplicationStatus.APPROVED,
        },
        {
          id: `${PREFIX}-unpublished-application`,
          programId: PROGRAM_ID,
          applicantId: unpublishedApplicantId,
          teamId: `${PREFIX}-unpublished-team`,
          answers: {},
          applicationTemplateVersion: 1,
          status: ApplicationStatus.APPROVED,
        },
      ],
    });
    await prisma.repository.createMany({
      data: [
        {
          id: `${PREFIX}-private-repository`,
          applicationId: `${PREFIX}-private-application`,
          programId: PROGRAM_ID,
          githubRepositoryId: 8_700_000_099_001n,
          name: `${PREFIX}-private-repo`,
          url: `https://github.com/synthetic-org/${PREFIX}-private-repo`,
          visibility: RepositoryVisibility.PRIVATE,
          publishedAt: null,
        },
        {
          id: `${PREFIX}-unpublished-repository`,
          applicationId: `${PREFIX}-unpublished-application`,
          programId: PROGRAM_ID,
          githubRepositoryId: 8_700_000_099_002n,
          name: `${PREFIX}-unpublished-repo`,
          url: `https://github.com/synthetic-org/${PREFIX}-unpublished-repo`,
          visibility: RepositoryVisibility.PUBLIC,
          publishedAt: null,
        },
      ],
    });
  });

  afterAll(async () => {
    try {
      await prisma.repository.deleteMany({
        where: { programId: PROGRAM_ID },
      });
      await prisma.application.deleteMany({ where: { programId: PROGRAM_ID } });
      await prisma.teamMember.deleteMany({ where: { programId: PROGRAM_ID } });
      await prisma.team.deleteMany({ where: { programId: PROGRAM_ID } });
      await prisma.user.deleteMany({
        where: { id: { startsWith: PREFIX } },
      });
      await prisma.program.deleteMany({ where: { id: PROGRAM_ID } });
    } finally {
      await prisma.$disconnect();
    }
  });

  it('listPage는 (publishedAt desc, id desc) 순서로 private/unpublished 저장소를 제외하고 페이지네이션한다', async () => {
    const firstPage = await repository.listPage(null, 10);
    expect(firstPage).toHaveLength(10);
    for (let index = 1; index < firstPage.length; index += 1) {
      const previous = firstPage[index - 1]!;
      const current = firstPage[index]!;
      const isOrdered =
        previous.publishedAt.getTime() > current.publishedAt.getTime() ||
        (previous.publishedAt.getTime() === current.publishedAt.getTime() &&
          previous.id > current.id);
      expect(isOrdered).toBe(true);
    }

    const cursor = {
      publishedAt: firstPage[firstPage.length - 1]!.publishedAt,
      id: firstPage[firstPage.length - 1]!.id,
    };
    const secondPage = await repository.listPage(cursor, 10);
    const firstPageIds = new Set(firstPage.map((row) => row.id));
    for (const row of secondPage) {
      expect(firstPageIds.has(row.id)).toBe(false);
    }

    const allIds = new Set([...firstPage, ...secondPage].map((row) => row.id));
    expect(allIds.has(`${PREFIX}-private-repository`)).toBe(false);
    expect(allIds.has(`${PREFIX}-unpublished-repository`)).toBe(false);
  });

  it('findById는 private/unpublished/미존재 저장소 모두 동일하게 null을 반환한다', async () => {
    const [privateResult, unpublishedResult, missingResult] = await Promise.all(
      [
        repository.findById('8700000099001'),
        repository.findById('8700000099002'),
        repository.findById('8700000099999'),
      ],
    );

    expect(privateResult).toBeNull();
    expect(unpublishedResult).toBeNull();
    expect(missingResult).toBeNull();
  });

  it('findById는 콜론이 섞인 Repository.id를 그대로 받아도(비숫자) DB를 조회하지 않고 null을 반환한다', async () => {
    const result = await repository.findById(
      `${PREFIX}-repository-0`.replace(/-/g, ':'),
    );

    expect(result).toBeNull();
  });

  it(
    '공개 프로젝션 계약(#archive 회귀) — listPage의 모든 행에서 projectId는 프런트 계약 정규식' +
      '(/^[A-Za-z0-9_-]+$/)을 만족하고, Repository.id에 콜론이 섞인 seed 스타일 행도 projectId는' +
      'githubRepositoryId 기반 콜론-free 값이며 githubUrl은 JNU-SWCU 정확 계약을 만족한다',
    async () => {
      const page = await repository.listPage(null, PUBLIC_REPOSITORY_COUNT);
      expect(page.length).toBeGreaterThan(0);
      for (const row of page) {
        expect(row.projectId).toMatch(/^[A-Za-z0-9_-]+$/);
      }

      const contractApplicantId = `${PREFIX}-contract-applicant`;
      const contractApplicationId = `${PREFIX}-contract-application`;
      // 실제 oss-hub seed(`prisma/seeds/oss-hub.ts`)와 동일하게 Repository.id에 콜론을
      // 의도적으로 섞는다 — 이 값이 그대로 공개 projectId로 새는 게 이 회귀의 근본 원인이었다.
      const contractRepositoryId = `seed:public-projects-contract:jnu-repo:repository`;
      const contractGithubRepositoryId = 8_800_000_000_001n;
      const contractRepositoryName = 'public-projects-contract-repo';

      await prisma.user.create({
        data: {
          id: contractApplicantId,
          githubId: 8_600_000_099_101n,
          nickname: `${PREFIX}-contract-applicant`,
          role: Role.STUDENT,
        },
      });
      const contractTeamId = `${PREFIX}-contract-team`;
      await prisma.team.create({
        data: {
          id: contractTeamId,
          programId: PROGRAM_ID,
          name: `${PREFIX}-contract-team`,
          joinCodeDigest: `${PREFIX}-contract-team-digest`,
          leaderId: contractApplicantId,
        },
      });
      await prisma.teamMember.create({
        data: {
          id: `${PREFIX}-contract-team-member`,
          teamId: contractTeamId,
          programId: PROGRAM_ID,
          userId: contractApplicantId,
        },
      });
      await prisma.application.create({
        data: {
          id: contractApplicationId,
          programId: PROGRAM_ID,
          applicantId: contractApplicantId,
          teamId: contractTeamId,
          answers: {},
          applicationTemplateVersion: 1,
          status: ApplicationStatus.APPROVED,
        },
      });
      await prisma.repository.create({
        data: {
          id: contractRepositoryId,
          applicationId: contractApplicationId,
          programId: PROGRAM_ID,
          githubRepositoryId: contractGithubRepositoryId,
          name: contractRepositoryName,
          url: `https://github.com/JNU-SWCU/${contractRepositoryName}`,
          visibility: RepositoryVisibility.PUBLIC,
          publishedAt: BASE_PUBLISHED_AT,
        },
      });

      try {
        const found = await repository.findById(
          contractGithubRepositoryId.toString(),
        );
        expect(found).not.toBeNull();
        expect(found?.projectId).toBe(contractGithubRepositoryId.toString());
        expect(found?.projectId).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(found?.githubUrl).toBe(
          `https://github.com/JNU-SWCU/${contractRepositoryName}`,
        );
      } finally {
        await prisma.repository.delete({ where: { id: contractRepositoryId } });
        await prisma.application.delete({
          where: { id: contractApplicationId },
        });
        await prisma.teamMember.delete({
          where: { id: `${PREFIX}-contract-team-member` },
        });
        await prisma.team.delete({ where: { id: contractTeamId } });
        await prisma.user.delete({ where: { id: contractApplicantId } });
      }
    },
  );

  it(
    'EXPLAIN 증거 — 첫 페이지(cursor 없음)와 다음 페이지(keyset cursor) 조회 모두 ' +
      'Repository_visibility_publishedAt_id_idx 인덱스를 사용한다',
    async () => {
      const firstPagePlan = await explainFirstPage();
      const cursor = {
        publishedAt: new Date(BASE_PUBLISHED_AT.getTime() + 10 * 86_400_000),
        id: `${PREFIX}-repository-0`,
      };
      const cursoredPlan = await explainCursoredPage(cursor);

      expect(queryPlanText(firstPagePlan)).toContain(
        'Repository_visibility_publishedAt_id_idx',
      );
      expect(queryPlanText(cursoredPlan)).toContain(
        'Repository_visibility_publishedAt_id_idx',
      );
    },
  );

  it('N+1 회귀 가드(실 DB) — pageSize가 5에서 40으로 늘어도 listPage는 정확히 1개 쿼리만 낸다', async () => {
    const queryLogClient = new PrismaClient({
      log: [{ emit: 'event', level: 'query' }],
    });
    await queryLogClient.$connect();
    const loggedRepository = new PublicProjectsRepository(
      queryLogClient as unknown as PrismaService,
    );

    try {
      const smallPageQueries = await countRepositoryQueries(
        queryLogClient,
        () => loggedRepository.listPage(null, 6),
      );
      const largePageQueries = await countRepositoryQueries(
        queryLogClient,
        () => loggedRepository.listPage(null, 41),
      );

      expect(smallPageQueries).toBe(1);
      expect(largePageQueries).toBe(1);
      expect(largePageQueries).toBe(smallPageQueries);
    } finally {
      await queryLogClient.$disconnect();
    }
  });
});

type QueryPlanRow = { readonly 'QUERY PLAN': string };

async function explainFirstPage(): Promise<readonly QueryPlanRow[]> {
  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw`SET LOCAL enable_seqscan = off`;
    return transaction.$queryRaw<readonly QueryPlanRow[]>`
      EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
      SELECT id, "publishedAt"
      FROM "Repository"
      WHERE visibility = 'PUBLIC' AND "publishedAt" IS NOT NULL
      ORDER BY "publishedAt" DESC, id DESC
      LIMIT 10
    `;
  });
}

async function explainCursoredPage(cursor: {
  publishedAt: Date;
  id: string;
}): Promise<readonly QueryPlanRow[]> {
  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw`SET LOCAL enable_seqscan = off`;
    return transaction.$queryRaw<readonly QueryPlanRow[]>`
      EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF)
      SELECT id, "publishedAt"
      FROM "Repository"
      WHERE visibility = 'PUBLIC' AND "publishedAt" IS NOT NULL
        AND (
          "publishedAt" < ${cursor.publishedAt}
          OR ("publishedAt" = ${cursor.publishedAt} AND id < ${cursor.id})
        )
      ORDER BY "publishedAt" DESC, id DESC
      LIMIT 10
    `;
  });
}

function queryPlanText(plan: readonly QueryPlanRow[]): string {
  return plan.map((row) => row['QUERY PLAN']).join('\n');
}

async function countRepositoryQueries<
  Client extends {
    $on(event: 'query', callback: (event: { query: string }) => void): void;
  },
>(client: Client, run: () => Promise<unknown>): Promise<number> {
  let count = 0;
  client.$on('query', (event) => {
    if (event.query.includes('"Repository"')) count += 1;
  });
  await run();
  return count;
}
