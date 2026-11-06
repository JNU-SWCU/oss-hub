import { FileMetadataRepository } from './files.repository';
import { UserProfileService } from '../users/user-profile.service';
import { ProgramScheduleService } from './program-schedule.service';
import { SubmissionWindowService } from './files.service';
import { RequirementCollectionService } from './requirement-archive.service';
import {
  RequirementCollectionReadRepository,
  RequirementsRepository,
} from './requirements.repository';
import { SubmissionsRepository } from './submissions.repository';
import { PlatformRepository } from '../platform/platform.repository';
import { LockProgramTreeRepository } from '../platform/lock-program-tree.repository';
import { ProgramCategory } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../platform/prisma.service';
import { RequirementsService } from './requirements.service';

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
const staffGithubId = 9600000001276001n;
const staffId = 'test:1276:document-order:staff';
const service = new RequirementsService(
  new RequirementsRepository(
    prisma,
    new LockProgramTreeRepository(),
    new PlatformRepository(),
    new SubmissionsRepository(
      new PlatformRepository(),
      new FileMetadataRepository(),
    ),
    new RequirementCollectionReadRepository(
      prisma,
      new FileMetadataRepository(),
    ),
    new FileMetadataRepository(),
  ),
  new SubmissionWindowService(new ProgramScheduleService()),
  new RequirementCollectionService({} as never),
  new ProgramScheduleService(),
  new SubmissionsRepository(
    new PlatformRepository(),
    new FileMetadataRepository(),
  ),
  new UserProfileService(),
);

async function cleanup(): Promise<void> {
  await prisma.requirement.deleteMany({
    where: { milestone: { programId: PROGRAM_ID } },
  });
  await prisma.milestone.deleteMany({ where: { programId: PROGRAM_ID } });
  await prisma.program.deleteMany({ where: { id: PROGRAM_ID } });
  await prisma.user.deleteMany({ where: { id: staffId } });
}

function storedOrder(milestoneId = MILESTONE_ID) {
  return prisma.requirement.findMany({
    where: { milestoneId },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, sortOrder: true },
  });
}

describe('RequirementsService durable document order', () => {
  beforeAll(async () => {
    await prisma.$connect();
  }, 60_000);

  beforeEach(async () => {
    await cleanup();
    await prisma.user.create({
      data: {
        id: staffId,
        githubId: staffGithubId,
        nickname: staffId,
        type: 'STAFF',
        approvalStatus: 'APPROVED',
        name: 'Synthetic staff',
        department: 'Synthetic department',
        profileCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
        profileUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
        departmentType: 'DEPARTMENT',
      },
    });
    await prisma.program.create({
      data: {
        startAt: new Date('2026-08-01T00:00:00.000Z'),
        endAt: new Date(
          new Date('2026-08-02T00:00:00.000Z').getTime() + 365 * 86_400_000,
        ),

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
              startAt: new Date('2026-08-01T00:00:00.000Z'),

              id: MILESTONE_ID,
              name: 'Ordered documents',
              dueAt: new Date('2026-08-20T00:00:00.000Z'),
              requirements: {
                create: DOCUMENT_IDS.map((id, index) => ({
                  id,
                  name: `Document ${index + 1}`,
                  required: true,
                  sortOrder: index + 1,
                })),
              },
            },
            {
              startAt: new Date('2026-08-01T00:00:00.000Z'),

              id: OTHER_MILESTONE_ID,
              name: 'Other milestone',
              dueAt: new Date('2026-08-20T00:00:00.000Z'),
              requirements: {
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
