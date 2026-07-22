import { ProgramCategory } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { ProgramErrorCode } from './program-error-code.enum';
import {
  categoryChangeInput,
  cleanup,
  createApplication,
  createMilestone,
  createProgram,
  createSubmission,
  domainCode,
  editor,
  NOW,
  prisma,
  PROGRAM_NAME,
  programs,
  runTogether,
  STAFF_GITHUB_ID,
  STAFF_VIEWER,
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

  it('rejects one side when application insertion races category change', async () => {
    // Given: two same-name programs exist and the edit targets one canonical id.
    const targetProgramId = `${TEST_PREFIX}program:category-target`;
    const controlProgramId = `${TEST_PREFIX}program:category-control`;
    const applicationId = `${TEST_PREFIX}application:category-race`;
    await createProgram(targetProgramId, false);
    await createProgram(controlProgramId, false);

    // When: the category update and first application insertion start together.
    const [categoryChange, applicationInsert] = await runTogether(
      () =>
        editor.updateProgram(
          STAFF_GITHUB_ID,
          targetProgramId,
          categoryChangeInput,
        ),
      () => createApplication(applicationId, targetProgramId),
    );

    // Then: the invariant allows only one operation to commit.
    const target = await prisma.program.findUniqueOrThrow({
      where: { id: targetProgramId },
      include: { _count: { select: { applications: true } } },
    });
    const control = await programs.detail(controlProgramId, STAFF_VIEWER, NOW);
    switch (categoryChange.status) {
      case 'fulfilled':
        expect(applicationInsert.status).toBe('rejected');
        expect(target.category).toBe(ProgramCategory.OSS_CONTEST);
        expect(target._count.applications).toBe(0);
        break;
      case 'rejected':
        expect(applicationInsert.status).toBe('fulfilled');
        expect(domainCode(categoryChange.reason)).toBe(
          ProgramErrorCode.CATEGORY_LOCKED_BY_APPLICATIONS,
        );
        expect(target.category).toBe(ProgramCategory.BASIC);
        expect(target._count.applications).toBe(1);
        break;
      default:
        return categoryChange satisfies never;
    }
    expect(control.id).toBe(controlProgramId);
    expect(control.name).toBe(PROGRAM_NAME);
  });

  it('rejects one side when submission insertion races milestone delete', async () => {
    // Given: same-name milestones exist and deletion targets one canonical id.
    const programId = `${TEST_PREFIX}program:submission-race`;
    const applicationId = `${TEST_PREFIX}application:submission-race`;
    const targetMilestoneId = `${TEST_PREFIX}milestone:submission-target`;
    const siblingMilestoneId = `${TEST_PREFIX}milestone:submission-sibling`;
    const submissionId = `${TEST_PREFIX}submission:race`;
    await createProgram(programId, false);
    await createApplication(applicationId, programId);
    await createMilestone(targetMilestoneId, programId);
    await createMilestone(siblingMilestoneId, programId);

    // When: the first submission and target milestone deletion start together.
    const [milestoneDelete, submissionInsert] = await runTogether(
      () => editor.deleteMilestone(STAFF_GITHUB_ID, targetMilestoneId),
      () => createSubmission(submissionId, applicationId, targetMilestoneId),
    );

    // Then: either the delete wins or the submitted milestone remains.
    const targetCount = await prisma.milestone.count({
      where: { id: targetMilestoneId },
    });
    const submissionCount = await prisma.submission.count({
      where: { id: submissionId },
    });
    const detail = await programs.detail(programId, STAFF_VIEWER, NOW);
    switch (milestoneDelete.status) {
      case 'fulfilled':
        expect(submissionInsert.status).toBe('rejected');
        expect(targetCount).toBe(0);
        expect(submissionCount).toBe(0);
        expect(detail.milestones.map((milestone) => milestone.id)).toEqual([
          siblingMilestoneId,
        ]);
        break;
      case 'rejected':
        expect(submissionInsert.status).toBe('fulfilled');
        expect(domainCode(milestoneDelete.reason)).toBe(
          ProgramErrorCode.MILESTONE_HAS_SUBMISSIONS,
        );
        expect(targetCount).toBe(1);
        expect(submissionCount).toBe(1);
        expect(detail.milestones.map((milestone) => milestone.id)).toContain(
          targetMilestoneId,
        );
        break;
      default:
        return milestoneDelete satisfies never;
    }
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
