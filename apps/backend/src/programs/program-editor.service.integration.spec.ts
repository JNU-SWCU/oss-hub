import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { ProgramErrorCode } from './program-error-code.enum';
import {
  cleanup,
  createMilestone,
  createProgram,
  domainCode,
  editor,
  prisma,
  runTogether,
  STAFF_GITHUB_ID,
  TEST_PREFIX,
} from './program-editor.integration-fixtures';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const DATABASE_CONNECTION_TIMEOUT_MS = 60_000;

describe('ProgramEditorService integration concurrency', () => {
  beforeAll(async () => {
    await prisma.$connect();
  }, DATABASE_CONNECTION_TIMEOUT_MS);

  beforeEach(async () => {
    await cleanup();
    await prisma.user.createMany({
      data: [
        {
          id: `${TEST_PREFIX}staff`,
          githubId: STAFF_GITHUB_ID,
          login: 'issue101-staff',
          role: 'STAFF',
          accountStatus: 'ACTIVE',
        },
        {
          id: `${TEST_PREFIX}applicant`,
          githubId: 9_101_000_002n,
          login: 'issue101-applicant',
          role: 'STUDENT',
          accountStatus: 'ACTIVE',
        },
      ],
    });
  });

  afterEach(cleanup);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('keeps one milestone when the last two provisioning milestones are deleted concurrently', async () => {
    // Given: repository provisioning has exactly two same-name milestones.
    const programId = `${TEST_PREFIX}program:last-two`;
    const firstMilestoneId = `${TEST_PREFIX}milestone:last-two:first`;
    const secondMilestoneId = `${TEST_PREFIX}milestone:last-two:second`;
    await createProgram(programId, true);
    await createMilestone(firstMilestoneId, programId);
    await createMilestone(secondMilestoneId, programId);

    // When: both canonical milestone deletes start together.
    const [firstDelete, secondDelete] = await runTogether(
      () => editor.deleteMilestone(STAFF_GITHUB_ID, firstMilestoneId),
      () => editor.deleteMilestone(STAFF_GITHUB_ID, secondMilestoneId),
    );

    // Then: exactly one delete succeeds and the final DB state keeps one row.
    expect([firstDelete.status, secondDelete.status].sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    const remaining = await prisma.milestone.findMany({
      where: { programId },
      select: { id: true, name: true },
      orderBy: { id: 'asc' },
    });
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.name).toBe('Issue 101 Same Name Milestone');
    if (firstDelete.status === 'rejected') {
      expect(domainCode(firstDelete.reason)).toBe(
        ProgramErrorCode.MILESTONE_REQUIRED,
      );
      expect(remaining[0]?.id).toBe(firstMilestoneId);
    }
    if (secondDelete.status === 'rejected') {
      expect(domainCode(secondDelete.reason)).toBe(
        ProgramErrorCode.MILESTONE_REQUIRED,
      );
      expect(remaining[0]?.id).toBe(secondMilestoneId);
    }
  });
});
