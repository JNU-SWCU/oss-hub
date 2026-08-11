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
          startAt: new Date('2026-08-31T00:00:00.000Z'),
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
          startAt: new Date('2026-08-03T00:00:00.000Z'),
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
          startAt: new Date('2026-08-16T00:00:00.000Z'),
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
          startAt: new Date('2026-10-02T00:00:00.000Z'),
          endAt: new Date('2026-12-31T00:00:00.000Z'),
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
          startAt: new Date('2026-02-02T00:00:00.000Z'),
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
          applicationEndAt: new Date('2026-06-30T00:00:00.000Z'),
          startAt: new Date('2026-07-01T00:00:00.000Z'),
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
          startAt: new Date('2026-09-02T00:00:00.000Z'),
          endAt: new Date('2026-12-31T00:00:00.000Z'),
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

  it('sort=name — 전체 데이터셋을 이름 오름차순으로, 페이지 경계에서도 중복·누락 없이 정렬한다', async () => {
    // Given: 25건, 이름을 무작위 순서로 심어 정렬이 애플리케이션이 아니라 SQL에서 일어남을 검증한다.
    const count = 25;
    const shuffledIndexes = Array.from(
      { length: count },
      (_, index) => index,
    ).sort(() => Math.random() - 0.5);
    await prisma.program.createMany({
      data: shuffledIndexes.map((nameIndex, insertOrder) => ({
        id: `${TEST_PREFIX}name-${insertOrder.toString().padStart(2, '0')}`,
        name: `Sort by name ${nameIndex.toString().padStart(2, '0')}`,
        organizer: 'OSS Hub',
        category: 'CAPSTONE' as const,
        applicationTemplateKey: 'capstone-v1',
        applicationTemplateVersion: 1,
        applicationStartAt: new Date('2026-07-01T00:00:00.000Z'),
        applicationEndAt: new Date('2026-08-30T00:00:00.000Z'),
        startAt: new Date('2026-08-31T00:00:00.000Z'),
        endAt: new Date('2026-12-31T00:00:00.000Z'),
        teamMinSize: 1,
        teamMaxSize: 4,
        description: 'name sort fixture',
      })),
    });

    // When: 페이지 크기 20으로 두 페이지를 모두 읽는다.
    const [page1] = await repository.listPrograms(
      {
        page: 1,
        pageSize: 20,
        search: 'Sort by name',
        status: 'all',
        sort: 'name',
        direction: 'asc',
      },
      NOW,
    );
    const [page2] = await repository.listPrograms(
      {
        page: 2,
        pageSize: 20,
        search: 'Sort by name',
        status: 'all',
        sort: 'name',
        direction: 'asc',
      },
      NOW,
    );

    // Then: 이름순으로 정렬되고, 두 페이지에 걸쳐 중복·누락 없이 전부 나온다.
    const names = [...page1, ...page2].map((row) => row.name);
    expect(names).toEqual([...names].sort());
    expect(page1).toHaveLength(20);
    expect(page2).toHaveLength(5);
    const ids = [...page1, ...page2].map((row) => row.id);
    expect(new Set(ids).size).toBe(count);
  });

  it('sort=applicationPeriod — applicationStartAt 기준으로 정렬한다', async () => {
    await prisma.program.createMany({
      data: [
        {
          id: `${TEST_PREFIX}period-late`,
          name: 'Period late start',
          organizer: 'OSS Hub',
          category: 'CAPSTONE' as const,
          applicationTemplateKey: 'capstone-v1',
          applicationTemplateVersion: 1,
          applicationStartAt: new Date('2026-09-01T00:00:00.000Z'),
          applicationEndAt: new Date('2026-10-01T00:00:00.000Z'),
          startAt: new Date('2026-10-02T00:00:00.000Z'),
          endAt: new Date('2026-12-31T00:00:00.000Z'),
          teamMinSize: 1,
          teamMaxSize: 4,
          description: 'late start fixture',
        },
        {
          id: `${TEST_PREFIX}period-early`,
          name: 'Period early start',
          organizer: 'OSS Hub',
          category: 'CAPSTONE' as const,
          applicationTemplateKey: 'capstone-v1',
          applicationTemplateVersion: 1,
          applicationStartAt: new Date('2026-01-01T00:00:00.000Z'),
          applicationEndAt: new Date('2026-02-01T00:00:00.000Z'),
          startAt: new Date('2026-02-02T00:00:00.000Z'),
          endAt: new Date('2026-12-31T00:00:00.000Z'),
          teamMinSize: 1,
          teamMaxSize: 4,
          description: 'early start fixture',
        },
        {
          id: `${TEST_PREFIX}period-mid`,
          name: 'Period mid start',
          organizer: 'OSS Hub',
          category: 'CAPSTONE' as const,
          applicationTemplateKey: 'capstone-v1',
          applicationTemplateVersion: 1,
          applicationStartAt: new Date('2026-05-01T00:00:00.000Z'),
          applicationEndAt: new Date('2026-06-01T00:00:00.000Z'),
          startAt: new Date('2026-06-02T00:00:00.000Z'),
          endAt: new Date('2026-12-31T00:00:00.000Z'),
          teamMinSize: 1,
          teamMaxSize: 4,
          description: 'mid start fixture',
        },
      ],
    });

    const [items] = await repository.listPrograms(
      {
        page: 1,
        pageSize: 50,
        search: 'Period',
        status: 'all',
        sort: 'applicationPeriod',
        direction: 'asc',
      },
      NOW,
    );

    expect(items.map((row) => row.id)).toEqual([
      `${TEST_PREFIX}period-early`,
      `${TEST_PREFIX}period-mid`,
      `${TEST_PREFIX}period-late`,
    ]);
  });

  it('sort=status — 모집중 → 진행중 → 예정 → 종료 순으로 정렬한다', async () => {
    await prisma.program.createMany({
      data: [
        {
          id: `${TEST_PREFIX}status-ended`,
          name: 'Status ended',
          organizer: 'OSS Hub',
          category: 'CAPSTONE' as const,
          applicationTemplateKey: 'capstone-v1',
          applicationTemplateVersion: 1,
          applicationStartAt: new Date('2025-01-01T00:00:00.000Z'),
          applicationEndAt: new Date('2025-02-01T00:00:00.000Z'),
          startAt: new Date('2025-02-02T00:00:00.000Z'),
          endAt: new Date('2025-08-01T00:00:00.000Z'),
          teamMinSize: 1,
          teamMaxSize: 4,
          description: 'ended fixture',
        },
        {
          id: `${TEST_PREFIX}status-upcoming`,
          name: 'Status upcoming',
          organizer: 'OSS Hub',
          category: 'CAPSTONE' as const,
          applicationTemplateKey: 'capstone-v1',
          applicationTemplateVersion: 1,
          applicationStartAt: new Date('2027-01-01T00:00:00.000Z'),
          applicationEndAt: new Date('2027-02-01T00:00:00.000Z'),
          startAt: new Date('2027-02-02T00:00:00.000Z'),
          endAt: new Date('2027-12-31T00:00:00.000Z'),
          teamMinSize: 1,
          teamMaxSize: 4,
          description: 'upcoming fixture',
        },
        {
          id: `${TEST_PREFIX}status-recruiting`,
          name: 'Status recruiting',
          organizer: 'OSS Hub',
          category: 'CAPSTONE' as const,
          applicationTemplateKey: 'capstone-v1',
          applicationTemplateVersion: 1,
          applicationStartAt: new Date('2026-07-01T00:00:00.000Z'),
          applicationEndAt: new Date('2026-08-15T00:00:00.000Z'),
          startAt: new Date('2026-08-16T00:00:00.000Z'),
          endAt: new Date('2026-12-31T00:00:00.000Z'),
          teamMinSize: 1,
          teamMaxSize: 4,
          description: 'recruiting fixture',
        },
        {
          id: `${TEST_PREFIX}status-in-progress`,
          name: 'Status in progress',
          organizer: 'OSS Hub',
          category: 'CAPSTONE' as const,
          applicationTemplateKey: 'capstone-v1',
          applicationTemplateVersion: 1,
          applicationStartAt: new Date('2026-01-01T00:00:00.000Z'),
          applicationEndAt: new Date('2026-02-01T00:00:00.000Z'),
          startAt: new Date('2026-02-02T00:00:00.000Z'),
          endAt: new Date('2026-12-31T00:00:00.000Z'),
          teamMinSize: 1,
          teamMaxSize: 4,
          description: 'in_progress fixture',
        },
      ],
    });

    const [items] = await repository.listPrograms(
      {
        page: 1,
        pageSize: 50,
        search: 'Status',
        status: 'all',
        sort: 'status',
        direction: 'asc',
      },
      NOW,
    );

    expect(items.map((row) => row.id)).toEqual([
      `${TEST_PREFIX}status-recruiting`,
      `${TEST_PREFIX}status-in-progress`,
      `${TEST_PREFIX}status-upcoming`,
      `${TEST_PREFIX}status-ended`,
    ]);
  });

  it('sort 파라미터가 없으면 이전과 동일한 레거시 정렬(모집중 → 예정 → 진행중 → 종료)을 유지한다', async () => {
    await prisma.program.createMany({
      data: [
        {
          id: `${TEST_PREFIX}legacy-in-progress`,
          name: 'Legacy in progress',
          organizer: 'OSS Hub',
          category: 'CAPSTONE' as const,
          applicationTemplateKey: 'capstone-v1',
          applicationTemplateVersion: 1,
          applicationStartAt: new Date('2026-01-01T00:00:00.000Z'),
          applicationEndAt: new Date('2026-02-01T00:00:00.000Z'),
          startAt: new Date('2026-02-02T00:00:00.000Z'),
          endAt: new Date('2026-12-31T00:00:00.000Z'),
          teamMinSize: 1,
          teamMaxSize: 4,
          description: 'in_progress fixture',
        },
        {
          id: `${TEST_PREFIX}legacy-upcoming`,
          name: 'Legacy upcoming',
          organizer: 'OSS Hub',
          category: 'CAPSTONE' as const,
          applicationTemplateKey: 'capstone-v1',
          applicationTemplateVersion: 1,
          applicationStartAt: new Date('2027-01-01T00:00:00.000Z'),
          applicationEndAt: new Date('2027-02-01T00:00:00.000Z'),
          startAt: new Date('2027-02-02T00:00:00.000Z'),
          endAt: new Date('2027-12-31T00:00:00.000Z'),
          teamMinSize: 1,
          teamMaxSize: 4,
          description: 'upcoming fixture',
        },
        {
          id: `${TEST_PREFIX}legacy-recruiting`,
          name: 'Legacy recruiting',
          organizer: 'OSS Hub',
          category: 'CAPSTONE' as const,
          applicationTemplateKey: 'capstone-v1',
          applicationTemplateVersion: 1,
          applicationStartAt: new Date('2026-07-01T00:00:00.000Z'),
          applicationEndAt: new Date('2026-08-15T00:00:00.000Z'),
          startAt: new Date('2026-08-16T00:00:00.000Z'),
          endAt: new Date('2026-12-31T00:00:00.000Z'),
          teamMinSize: 1,
          teamMaxSize: 4,
          description: 'recruiting fixture',
        },
      ],
    });

    const [items] = await repository.listPrograms(
      { page: 1, pageSize: 50, search: 'Legacy', status: 'all' },
      NOW,
    );

    expect(items.map((row) => row.id)).toEqual([
      `${TEST_PREFIX}legacy-recruiting`,
      `${TEST_PREFIX}legacy-upcoming`,
      `${TEST_PREFIX}legacy-in-progress`,
    ]);
  });

  it('status 칩 필터와 sort가 함께 동작한다 (?status=recruiting&sort=name)', async () => {
    await prisma.program.createMany({
      data: [
        {
          id: `${TEST_PREFIX}combo-recruiting-b`,
          name: 'Combo recruiting B',
          organizer: 'OSS Hub',
          category: 'CAPSTONE' as const,
          applicationTemplateKey: 'capstone-v1',
          applicationTemplateVersion: 1,
          applicationStartAt: new Date('2026-07-01T00:00:00.000Z'),
          applicationEndAt: new Date('2026-08-15T00:00:00.000Z'),
          startAt: new Date('2026-08-16T00:00:00.000Z'),
          endAt: new Date('2026-12-31T00:00:00.000Z'),
          teamMinSize: 1,
          teamMaxSize: 4,
          description: 'recruiting fixture B',
        },
        {
          id: `${TEST_PREFIX}combo-recruiting-a`,
          name: 'Combo recruiting A',
          organizer: 'OSS Hub',
          category: 'CAPSTONE' as const,
          applicationTemplateKey: 'capstone-v1',
          applicationTemplateVersion: 1,
          applicationStartAt: new Date('2026-07-01T00:00:00.000Z'),
          applicationEndAt: new Date('2026-08-20T00:00:00.000Z'),
          startAt: new Date('2026-08-21T00:00:00.000Z'),
          endAt: new Date('2026-12-31T00:00:00.000Z'),
          teamMinSize: 1,
          teamMaxSize: 4,
          description: 'recruiting fixture A',
        },
        {
          id: `${TEST_PREFIX}combo-ended`,
          name: 'Combo ended',
          organizer: 'OSS Hub',
          category: 'CAPSTONE' as const,
          applicationTemplateKey: 'capstone-v1',
          applicationTemplateVersion: 1,
          applicationStartAt: new Date('2025-01-01T00:00:00.000Z'),
          applicationEndAt: new Date('2025-02-01T00:00:00.000Z'),
          startAt: new Date('2025-02-02T00:00:00.000Z'),
          endAt: new Date('2025-08-01T00:00:00.000Z'),
          teamMinSize: 1,
          teamMaxSize: 4,
          description: 'ended fixture, must be excluded by status filter',
        },
      ],
    });

    const [items, totalItems] = await repository.listPrograms(
      {
        page: 1,
        pageSize: 50,
        search: 'Combo',
        status: 'recruiting',
        sort: 'name',
        direction: 'asc',
      },
      NOW,
    );

    // status=recruiting이 ended를 걸러내고, sort=name이 남은 둘을 이름순으로 낸다.
    expect(totalItems).toBe(2);
    expect(items.map((row) => row.id)).toEqual([
      `${TEST_PREFIX}combo-recruiting-a`,
      `${TEST_PREFIX}combo-recruiting-b`,
    ]);
  });
});
