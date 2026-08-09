import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ProgramsRepository } from './repository/programs.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const DATABASE_CONNECTION_TIMEOUT_MS = 60_000;
const TEST_PREFIX = 'program-list-order:';
const NOW = new Date('2026-08-01T00:00:00.000Z');
const prisma = new PrismaService();
const repository = new ProgramsRepository(prisma);

async function cleanup(): Promise<void> {
  await prisma.program.deleteMany({
    where: { id: { startsWith: TEST_PREFIX } },
  });
}

describe('ProgramsRepository list ordering integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
  }, DATABASE_CONNECTION_TIMEOUT_MS);

  beforeEach(cleanup);
  afterEach(cleanup);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('returns the nearest recruiting deadline on page one across a 21-row boundary', async () => {
    // Given: twenty later deadlines have newer start dates than one urgent row.
    await prisma.program.createMany({
      data: [
        ...Array.from({ length: 20 }, (_, index) => ({
          id: `${TEST_PREFIX}later-${index.toString().padStart(2, '0')}`,
          name: `Page boundary later ${index.toString().padStart(2, '0')}`,
          organizer: 'OSS Hub',
          category: 'CAPSTONE' as const,
          applicationTemplateKey: 'capstone-v1',
          applicationTemplateVersion: 1,
          applicationStartAt: new Date('2026-07-20T00:00:00.000Z'),
          applicationEndAt: new Date('2026-08-30T00:00:00.000Z'),
          endAt: new Date('2026-12-31T00:00:00.000Z'),
          teamMinSize: 1,
          teamMaxSize: 4,
          description: 'Page boundary later fixture',
        })),
        {
          id: `${TEST_PREFIX}urgent`,
          name: 'Page boundary urgent deadline',
          organizer: 'OSS Hub',
          category: 'CAPSTONE' as const,
          applicationTemplateKey: 'capstone-v1',
          applicationTemplateVersion: 1,
          applicationStartAt: new Date('2026-07-01T00:00:00.000Z'),
          applicationEndAt: new Date('2026-08-02T00:00:00.000Z'),
          endAt: new Date('2026-12-31T00:00:00.000Z'),
          teamMinSize: 1,
          teamMaxSize: 4,
          description: 'Urgent deadline fixture',
        },
      ],
    });

    // When: the first page is fetched at the public page size.
    const [items, totalItems] = await repository.listPrograms(
      { page: 1, pageSize: 20, search: 'Page boundary', status: 'all' },
      NOW,
    );

    // Then: pagination happens after the urgent deadline is ordered first.
    expect(totalItems).toBe(21);
    expect(items).toHaveLength(20);
    expect(items[0]?.id).toBe(`${TEST_PREFIX}urgent`);
  });

  it('keeps status-counts partition equal to all (I1) and list totals (I2)', async () => {
    await prisma.program.createMany({
      data: [
        {
          id: `${TEST_PREFIX}recruiting`,
          name: 'Partition recruiting',
          organizer: 'OSS Hub',
          category: 'CAPSTONE' as const,
          applicationTemplateKey: 'capstone-v1',
          applicationTemplateVersion: 1,
          applicationStartAt: new Date('2026-07-01T00:00:00.000Z'),
          applicationEndAt: new Date('2026-08-15T00:00:00.000Z'),
          endAt: new Date('2026-12-31T00:00:00.000Z'),
          teamMinSize: 1,
          teamMaxSize: 4,
          description: 'recruiting fixture',
        },
        {
          id: `${TEST_PREFIX}upcoming`,
          name: 'Partition upcoming',
          organizer: 'OSS Hub',
          category: 'CAPSTONE' as const,
          applicationTemplateKey: 'capstone-v1',
          applicationTemplateVersion: 1,
          applicationStartAt: new Date('2026-09-01T00:00:00.000Z'),
          applicationEndAt: new Date('2026-10-01T00:00:00.000Z'),
          endAt: null,
          teamMinSize: 1,
          teamMaxSize: 4,
          description: 'upcoming fixture',
        },
        {
          id: `${TEST_PREFIX}in-progress`,
          name: 'Partition in progress',
          organizer: 'OSS Hub',
          category: 'CAPSTONE' as const,
          applicationTemplateKey: 'capstone-v1',
          applicationTemplateVersion: 1,
          applicationStartAt: new Date('2026-01-01T00:00:00.000Z'),
          applicationEndAt: new Date('2026-02-01T00:00:00.000Z'),
          endAt: new Date('2026-12-31T00:00:00.000Z'),
          teamMinSize: 1,
          teamMaxSize: 4,
          description: 'in_progress fixture',
        },
        {
          // U4: apply window open but endAt already past → ended only
          id: `${TEST_PREFIX}ended-overlap`,
          name: 'Partition ended overlap',
          organizer: 'OSS Hub',
          category: 'CAPSTONE' as const,
          applicationTemplateKey: 'capstone-v1',
          applicationTemplateVersion: 1,
          applicationStartAt: new Date('2026-06-25T00:00:00.000Z'),
          applicationEndAt: new Date('2026-09-13T00:00:00.000Z'),
          endAt: new Date('2026-07-15T00:00:00.000Z'),
          teamMinSize: 1,
          teamMaxSize: 4,
          description: 'ended with open apply window',
        },
        {
          id: `${TEST_PREFIX}archived`,
          name: 'Partition archived',
          organizer: 'OSS Hub',
          category: 'CAPSTONE' as const,
          applicationTemplateKey: 'capstone-v1',
          applicationTemplateVersion: 1,
          lifecycle: 'ARCHIVED' as const,
          applicationStartAt: new Date('2026-07-01T00:00:00.000Z'),
          applicationEndAt: new Date('2026-09-01T00:00:00.000Z'),
          endAt: null,
          teamMinSize: 1,
          teamMaxSize: 4,
          description: 'archived fixture',
        },
      ],
    });

    // I1: 전역 파티션 합 = all (다른 행이 있어도 성립해야 한다)
    const counts = await repository.countProgramsByStatus(NOW);
    expect(counts.all).toBe(
      counts.recruiting + counts.in_progress + counts.upcoming + counts.ended,
    );

    // I2: 이 픽스처 5행만 검색해 status 별 totalItems 고정
    const expectedByStatus = {
      all: 5,
      recruiting: 1,
      upcoming: 1,
      in_progress: 1,
      ended: 2, // date-ended + ARCHIVED
    } as const;
    for (const status of [
      'all',
      'recruiting',
      'in_progress',
      'upcoming',
      'ended',
    ] as const) {
      const [, totalItems] = await repository.listPrograms(
        { page: 1, pageSize: 50, search: 'Partition', status },
        NOW,
      );
      expect(totalItems).toBe(expectedByStatus[status]);
    }

    // U4: 접수창 열림 ∩ endAt 과거 → ended only
    const [endedItems] = await repository.listPrograms(
      { page: 1, pageSize: 50, search: 'Partition ended', status: 'ended' },
      NOW,
    );
    const [recruitingItems] = await repository.listPrograms(
      {
        page: 1,
        pageSize: 50,
        search: 'Partition ended',
        status: 'recruiting',
      },
      NOW,
    );
    expect(endedItems.map((row) => row.id)).toContain(
      `${TEST_PREFIX}ended-overlap`,
    );
    expect(recruitingItems.map((row) => row.id)).not.toContain(
      `${TEST_PREFIX}ended-overlap`,
    );
  });
});
