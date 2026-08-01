import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ProgramsRepository } from './programs.repository';

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
});
