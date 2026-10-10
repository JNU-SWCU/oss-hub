import { MemberKind } from '@prisma/client';
import { assertIsolatedIntegrationDatabase } from '../../../test/integration-database.guard';
import { updateInput } from '../../../test/program-editor-service-fixtures';
import { DomainException } from '../../common/error-code';
import { ProgramErrorCode } from '../domain/program-error-code.enum';
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
} from '../repository/program-editor.integration-fixtures';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const DATABASE_CONNECTION_TIMEOUT_MS = 60_000;
const UNDECIDED_END_AT = '9999-12-31T23:59:59.999Z';

async function createUndecidedEndProgram(programId: string): Promise<void> {
  await createProgram(programId, false);
  await prisma.$executeRaw`UPDATE "Program" SET "endAt" = DEFAULT WHERE "id" = ${programId}`;
}

describe('ProgramEditorService integration', () => {
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
          nickname: 'issue101-staff',
          selectedMemberKind: MemberKind.STAFF,
          hasStaffAccess: true,
          accountStatus: 'ACTIVE',
        },
        {
          id: `${TEST_PREFIX}applicant`,
          githubId: 9_101_000_002n,
          nickname: 'issue101-applicant',
          selectedMemberKind: MemberKind.STUDENT,
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
    const programId = `${TEST_PREFIX}program:last-two`;
    const firstMilestoneId = `${TEST_PREFIX}milestone:last-two:first`;
    const secondMilestoneId = `${TEST_PREFIX}milestone:last-two:second`;
    await createProgram(programId, true);
    await createMilestone(firstMilestoneId, programId);
    await createMilestone(secondMilestoneId, programId);

    const [firstDelete, secondDelete] = await runTogether(
      () => editor.deleteMilestone(STAFF_GITHUB_ID, firstMilestoneId),
      () => editor.deleteMilestone(STAFF_GITHUB_ID, secondMilestoneId),
    );

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

  it('saves a legacy undecided-end program when the request omits endAt', async () => {
    const programId = `${TEST_PREFIX}program:undecided-end-kept`;
    await createUndecidedEndProgram(programId);

    await editor.updateProgram(STAFF_GITHUB_ID, programId, {
      ...updateInput,
      repositoryProvisioningEnabled: false,
      endAt: undefined,
    });

    await expect(
      prisma.program.findUniqueOrThrow({
        where: { id: programId },
        select: { name: true, endAt: true },
      }),
    ).resolves.toEqual({
      name: 'Updated OSS',
      endAt: new Date(UNDECIDED_END_AT),
    });
  });

  it('rejects the undecided sentinel sent as a new end with the endAt field error', async () => {
    const programId = `${TEST_PREFIX}program:undecided-end-sent`;
    await createUndecidedEndProgram(programId);

    const rejected = await editor
      .updateProgram(STAFF_GITHUB_ID, programId, {
        ...updateInput,
        repositoryProvisioningEnabled: false,
        endAt: UNDECIDED_END_AT,
      })
      .then(
        () => null,
        (error: unknown) => error,
      );

    expect(rejected).toBeInstanceOf(DomainException);
    expect(domainCode(rejected)).toBe(ProgramErrorCode.VALIDATION_ERROR);
    expect((rejected as DomainException).extensions.fieldErrors).toEqual([
      expect.objectContaining({ field: 'endAt', code: 'INVALID_PROGRAM_END' }),
    ]);
    await expect(
      prisma.program.findUniqueOrThrow({
        where: { id: programId },
        select: { name: true },
      }),
    ).resolves.toEqual({ name: 'Issue 101 Same Name Program' });
  });
});
