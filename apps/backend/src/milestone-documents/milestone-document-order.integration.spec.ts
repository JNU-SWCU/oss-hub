import { ProgramCategory } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import { MilestoneDocumentsRepository } from './milestone-documents.repository';
import { MilestoneDocumentsService } from './milestone-documents.service';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const PROGRAM_ID = 'test:1276:document-order:program';
const MILESTONE_ID = 'test:1276:document-order:milestone';
const OTHER_MILESTONE_ID = 'test:1276:document-order:other-milestone';
const DOCUMENT_IDS = [
  'test:1276:document-order:first',
  'test:1276:document-order:second',
  'test:1276:document-order:third',
] as const;
const FOREIGN_DOCUMENT_ID = 'test:1276:document-order:foreign';
const prisma = new PrismaService();
const service = new MilestoneDocumentsService(
  new MilestoneDocumentsRepository(prisma),
);

async function cleanup(): Promise<void> {
  await prisma.milestoneDocument.deleteMany({
    where: { milestone: { programId: PROGRAM_ID } },
  });
  await prisma.milestone.deleteMany({ where: { programId: PROGRAM_ID } });
  await prisma.program.deleteMany({ where: { id: PROGRAM_ID } });
}

function storedOrder(milestoneId = MILESTONE_ID) {
  return prisma.milestoneDocument.findMany({
    where: { milestoneId },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, sortOrder: true },
  });
}

describe('MilestoneDocumentsService durable document order', () => {
  beforeAll(async () => {
    await prisma.$connect();
  }, 60_000);

  beforeEach(async () => {
    await cleanup();
    await prisma.program.create({
      data: {
        id: PROGRAM_ID,
        name: 'Synthetic document ordering',
        organizer: 'OSS',
        category: ProgramCategory.BASIC,
        applicationTemplateKey: 'basic',
        applicationTemplateVersion: 1,
        applicationStartAt: new Date('2026-08-01T00:00:00.000Z'),
        applicationEndAt: new Date('2026-08-02T00:00:00.000Z'),
        description: 'Isolated document ordering contract',
        milestones: {
          create: [
            {
              id: MILESTONE_ID,
              name: 'Ordered documents',
              dueAt: new Date('2026-08-20T00:00:00.000Z'),
              documents: {
                create: DOCUMENT_IDS.map((id, index) => ({
                  id,
                  name: `Document ${index + 1}`,
                  required: true,
                  sortOrder: index + 1,
                })),
              },
            },
            {
              id: OTHER_MILESTONE_ID,
              name: 'Other milestone',
              dueAt: new Date('2026-08-20T00:00:00.000Z'),
              documents: {
                create: {
                  id: FOREIGN_DOCUMENT_ID,
                  name: 'Foreign document',
                  required: true,
                  sortOrder: 1,
                },
              },
            },
          ],
        },
      },
    });
  });

  afterEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('persists the requested whole-set order after the transaction returns', async () => {
    const [first, second, third] = DOCUMENT_IDS;

    await service.reorderDocuments(MILESTONE_ID, [third, first, second]);

    expect(await storedOrder()).toEqual([
      { id: third, sortOrder: 1 },
      { id: first, sortOrder: 2 },
      { id: second, sortOrder: 3 },
    ]);
    expect(await storedOrder(OTHER_MILESTONE_ID)).toEqual([
      { id: FOREIGN_DOCUMENT_ID, sortOrder: 1 },
    ]);
  });

  it.each([
    ['missing document', [DOCUMENT_IDS[2], DOCUMENT_IDS[0]]],
    ['duplicate document', [DOCUMENT_IDS[2], DOCUMENT_IDS[0], DOCUMENT_IDS[0]]],
    [
      'another milestone document',
      [DOCUMENT_IDS[2], DOCUMENT_IDS[0], FOREIGN_DOCUMENT_ID],
    ],
    [
      'unknown document',
      [DOCUMENT_IDS[2], DOCUMENT_IDS[0], 'test:1276:document-order:missing'],
    ],
    ['empty set', []],
  ])('rejects %s without changing either milestone', async (_label, ids) => {
    const before = await storedOrder();
    const otherBefore = await storedOrder(OTHER_MILESTONE_ID);

    await expect(
      service.reorderDocuments(MILESTONE_ID, ids),
    ).rejects.toMatchObject({
      errorCode: { code: 'MSD_019', status: 400 },
    });

    expect(await storedOrder()).toEqual(before);
    expect(await storedOrder(OTHER_MILESTONE_ID)).toEqual(otherBefore);
  });
});
