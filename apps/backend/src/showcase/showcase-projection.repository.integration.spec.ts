import {
  ApplicationStatus,
  ProgramCategory,
  RepositoryVisibility,
  Role,
} from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ShowcaseProjectionRepository } from './showcase-projection.repository';
import { ShowcaseProjectionService } from './showcase-projection.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const repository = new ShowcaseProjectionRepository();
const service = new ShowcaseProjectionService(prisma, repository);
const PREFIX = 'synthetic-public-showcase';
const PROGRAM_ID = `${PREFIX}-program`;
const USER_ID = `${PREFIX}-user`;
const OTHER_USER_ID = `${PREFIX}-other-user`;
const APPLICATION_IDS = [
  `${PREFIX}-eligible-application`,
  `${PREFIX}-ineligible-application`,
] as const;
const REPOSITORY_IDS = [
  `${PREFIX}-eligible-repository`,
  `${PREFIX}-ineligible-repository`,
] as const;
const NOW = new Date('2026-07-26T00:00:00.000Z');

describe('ShowcaseProjectionRepository integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.createMany({
      data: [
        {
          id: USER_ID,
          githubId: 8_400_000_000_001n,
          nickname: `${PREFIX}-login`,
          avatarUrl: 'https://avatars.example/synthetic.png',
          role: Role.STUDENT,
        },
        {
          id: OTHER_USER_ID,
          githubId: 8_400_000_000_002n,
          nickname: `${PREFIX}-other-login`,
          avatarUrl: null,
          role: Role.STUDENT,
        },
      ],
    });
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
        endAt: new Date('2026-07-25T00:00:00.000Z'),
        description: 'synthetic-description',
      },
    });
    await prisma.application.createMany({
      data: APPLICATION_IDS.map((id, index) => ({
        id,
        programId: PROGRAM_ID,
        applicantId: index === 0 ? USER_ID : OTHER_USER_ID,
        answers: {},
        applicationTemplateVersion: 1,
        status: ApplicationStatus.APPROVED,
      })),
    });
    await prisma.repository.createMany({
      data: [
        {
          id: REPOSITORY_IDS[0],
          applicationId: APPLICATION_IDS[0],
          programId: PROGRAM_ID,
          githubRepositoryId: 8_500_000_000_001n,
          name: `${PREFIX}-eligible`,
          url: `https://github.com/JNU-SWCU/${PREFIX}-eligible`,
          visibility: RepositoryVisibility.PUBLIC,
          publishedAt: new Date('2026-07-25T00:00:00.000Z'),
        },
        {
          id: REPOSITORY_IDS[1],
          applicationId: APPLICATION_IDS[1],
          programId: PROGRAM_ID,
          githubRepositoryId: 8_500_000_000_002n,
          name: `${PREFIX}-ineligible`,
          url: `https://github.com/JNU-SWCU/${PREFIX}-ineligible`,
          visibility: RepositoryVisibility.PUBLIC,
          publishedAt: null,
        },
      ],
    });
  });

  afterAll(async () => {
    try {
      await prisma.publicShowcaseContributor.deleteMany({
        where: { repositoryId: { in: [...REPOSITORY_IDS] } },
      });
      await prisma.publicShowcaseRepository.deleteMany({
        where: { repositoryId: { in: [...REPOSITORY_IDS] } },
      });
      await prisma.repository.deleteMany({
        where: { id: { in: [...REPOSITORY_IDS] } },
      });
      await prisma.application.deleteMany({
        where: { id: { in: [...APPLICATION_IDS] } },
      });
      await prisma.program.deleteMany({ where: { id: PROGRAM_ID } });
      await prisma.user.deleteMany({
        where: { id: { in: [USER_ID, OTHER_USER_ID] } },
      });
    } finally {
      await prisma.$disconnect();
    }
  });

  it('backfills only eligible public rows and exposes projection allowlist fields', async () => {
    const result = await service.backfillAll(NOW);
    expect(result.projected).toBeGreaterThanOrEqual(1);
    expect(result.skipped).toBeGreaterThanOrEqual(1);

    const rows = await prisma.publicShowcaseRepository.findMany({
      where: { repositoryId: { in: [...REPOSITORY_IDS] } },
      select: {
        repositoryId: true,
        githubRepositoryId: true,
        repositoryName: true,
        repositoryUrl: true,
        publishedAt: true,
        programId: true,
        programName: true,
        programCategory: true,
        programEndAt: true,
        teamName: true,
        displayName: true,
        approvedSubmissionCount: true,
        projectedAt: true,
        contributors: {
          select: { userId: true, githubNickname: true, avatarUrl: true },
        },
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      repositoryId: REPOSITORY_IDS[0],
      repositoryName: `${PREFIX}-eligible`,
      displayName: `${PREFIX}-login`,
      approvedSubmissionCount: 0,
      contributors: [
        {
          userId: USER_ID,
          githubNickname: `${PREFIX}-login`,
          avatarUrl: 'https://avatars.example/synthetic.png',
        },
      ],
    });
  });
  /**
   * todo 16 — 이 writer가 채우는 legacy projection 테이블은 todo 20까지 구버전 호환용으로
   * 남지만, 그것을 읽던 공개 컨트롤러(`ShowcasePublicController`/`Service`)는 제거되어 이제
   * 어떤 라우트도 이 테이블을 서빙하지 않는다(구 라우트는 404 — `public-projects` 쪽 스펙이
   * 다룬다). 이 테스트는 오직 writer의 projection 산출물 자체에 private 필드가 없다는 계약만
   * 직접 테이블을 읽어 검증한다.
   */
  it('projects only allowlisted fields without private data', async () => {
    const rows = await prisma.publicShowcaseRepository.findMany({
      where: { repositoryId: { in: [...REPOSITORY_IDS] } },
      select: {
        repositoryId: true,
        contributors: {
          select: { userId: true, githubNickname: true, avatarUrl: true },
        },
      },
    });
    const serialized = JSON.stringify(rows);

    expect(rows).toContainEqual(
      expect.objectContaining({ repositoryId: REPOSITORY_IDS[0] }),
    );
    expect(rows).not.toContainEqual(
      expect.objectContaining({ repositoryId: REPOSITORY_IDS[1] }),
    );
    for (const forbiddenField of [
      'answers',
      'email',
      'phone',
      'studentId',
      'lastErrorMessage',
    ]) {
      expect(serialized).not.toContain(`"${forbiddenField}"`);
    }
  });

  it('revokes a projection synchronously when eligibility is lost', async () => {
    await prisma.repository.update({
      where: { id: REPOSITORY_IDS[0] },
      data: { visibility: RepositoryVisibility.PRIVATE },
    });

    await expect(
      service.projectRepository(REPOSITORY_IDS[0], NOW),
    ).resolves.toBe('revoked');
    await expect(
      prisma.publicShowcaseRepository.findUnique({
        where: { repositoryId: REPOSITORY_IDS[0] },
      }),
    ).resolves.toBeNull();
  });
});
