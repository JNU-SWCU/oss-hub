import {
  ApplicationStatus,
  MilestoneSubmissionType,
  Role,
  SubmissionFileLifecycle,
  SubmissionStatus,
} from '@prisma/client';
import { runProfile } from '../../prisma/seed';
import {
  prisma as seedPrisma,
  seedGithubId,
  seedId,
  SeedStats,
} from '../../prisma/seeds/helpers';
import { MILESTONE_SCENARIOS } from '../../prisma/seeds/milestones';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { addOneCalendarYear } from '../common/add-one-calendar-year';
import { DomainException } from '../common/error-code';
import { PrismaService } from '../prisma/prisma.service';
import { SubmissionsErrorCode } from './submissions-error-code.enum';
import type { SubmissionFileStoragePort } from './submission-file-storage.port';
import { SubmissionFilesRepository } from './submission-files.repository';
import { SubmissionFilesService } from './submission-files.service';
import { SubmissionsRepository } from './submissions.repository';
import { SubmissionsService } from './submissions.service';

// allow: SIZE_OK — 개인·팀·마감·중복·유형·저장소 시나리오가 하나의 격리 PostgreSQL lifecycle을 공유한다.
assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prisma = new PrismaService();
const service = new SubmissionsService(new SubmissionsRepository(prisma));
const MILESTONES_PROGRAM_ID = seedId('milestones', 'program');
const PERSONAL_APPLICATION_ID = seedId('milestones', 'application', 'personal');
const TEAM_APPLICATION_ID = seedId('milestones', 'application', 'team');
const PERSONAL_USER_ID = seedId('milestones', 'user', 'applicant-personal');
const TEAM_MEMBER_ID = seedId('milestones', 'user', 'team-member');
const NON_STUDENT_USER_ID = 'synthetic-submission-non-student';
const UNAPPROVED_USER_ID = 'synthetic-submission-unapproved-student';
const UNAPPROVED_APPLICATION_ID = 'synthetic-submission-unapproved-application';
const FILE_MILESTONE_ID = 'synthetic-submission-file-milestone';
const FILE_RESUBMISSION_PREFIX = 'synthetic-file-resubmission';
const NOW = new Date('2026-07-23T00:00:00.000Z');
const FILE_RETENTION_START = new Date('2027-01-01T00:00:00.000Z');

describe('SubmissionsService integration', () => {
  beforeAll(async () => {
    await Promise.all([prisma.$connect(), seedPrisma.$connect()]);
    await runProfile('milestones', new SeedStats());
    await prisma.user.createMany({
      data: [
        {
          id: NON_STUDENT_USER_ID,
          githubId: seedGithubId(NON_STUDENT_USER_ID),
          nickname: 'synthetic-submission-non-student',
          role: Role.STAFF,
        },
        {
          id: UNAPPROVED_USER_ID,
          githubId: seedGithubId(UNAPPROVED_USER_ID),
          nickname: 'synthetic-submission-unapproved-student',
          role: Role.STUDENT,
        },
      ],
      skipDuplicates: true,
    });
    const unapprovedTeamId = `${UNAPPROVED_APPLICATION_ID}-team`;
    await prisma.team.upsert({
      where: { id: unapprovedTeamId },
      update: {},
      create: {
        id: unapprovedTeamId,
        programId: MILESTONES_PROGRAM_ID,
        name: `${UNAPPROVED_APPLICATION_ID}-team`,
        joinCodeDigest: `${UNAPPROVED_APPLICATION_ID}-team-digest`,
        leaderId: UNAPPROVED_USER_ID,
      },
    });
    await prisma.teamMember.upsert({
      where: {
        teamId_userId: {
          teamId: unapprovedTeamId,
          userId: UNAPPROVED_USER_ID,
        },
      },
      update: {},
      create: {
        id: `${UNAPPROVED_APPLICATION_ID}-team-member`,
        teamId: unapprovedTeamId,
        programId: MILESTONES_PROGRAM_ID,
        userId: UNAPPROVED_USER_ID,
      },
    });
    await prisma.application.upsert({
      where: { id: UNAPPROVED_APPLICATION_ID },
      update: { status: ApplicationStatus.SUBMITTED },
      create: {
        id: UNAPPROVED_APPLICATION_ID,
        programId: MILESTONES_PROGRAM_ID,
        applicantId: UNAPPROVED_USER_ID,
        teamId: unapprovedTeamId,
        answers: { synthetic: true },
        applicationTemplateVersion: 1,
        status: ApplicationStatus.SUBMITTED,
      },
    });
    await prisma.milestone.createMany({
      data: [
        {
          id: FILE_MILESTONE_ID,
          programId: MILESTONES_PROGRAM_ID,
          name: '합성 파일 제출',
          dueAt: new Date('2026-08-30T00:00:00.000Z'),
          submissionType: MilestoneSubmissionType.FILE,
        },
      ],
      skipDuplicates: true,
    });
  });

  afterEach(async () => {
    const milestoneIds = [
      ...MILESTONE_SCENARIOS['milestones-upcoming'],
      FILE_MILESTONE_ID,
    ];
    await prisma.submissionFile.deleteMany({
      where: { id: { startsWith: FILE_RESUBMISSION_PREFIX } },
    });
    await prisma.submissionRevision.deleteMany({
      where: { submission: { milestoneId: { in: milestoneIds } } },
    });
    await prisma.submission.deleteMany({
      where: { milestoneId: { in: milestoneIds } },
    });
    await prisma.milestone.updateMany({
      where: { id: FILE_MILESTONE_ID },
      data: { submissionType: MilestoneSubmissionType.FILE },
    });
  });

  afterAll(async () => {
    await prisma.milestone.deleteMany({
      where: { id: FILE_MILESTONE_ID },
    });
    await prisma.application.deleteMany({
      where: { id: UNAPPROVED_APPLICATION_ID },
    });
    await prisma.teamMember.deleteMany({
      where: { id: `${UNAPPROVED_APPLICATION_ID}-team-member` },
    });
    await prisma.team.deleteMany({
      where: { id: `${UNAPPROVED_APPLICATION_ID}-team` },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [NON_STUDENT_USER_ID, UNAPPROVED_USER_ID] } },
    });
    await Promise.all([prisma.$disconnect(), seedPrisma.$disconnect()]);
  });

  it('개인 신청자와 현재 팀원이 각각 자신의 제출 폼을 조회한다', async () => {
    // Given
    const [personalMilestoneId, teamMilestoneId] =
      MILESTONE_SCENARIOS['milestones-upcoming'];

    // When
    const [personal, team] = await Promise.all([
      service.form(
        seedGithubId(PERSONAL_USER_ID),
        MILESTONES_PROGRAM_ID,
        personalMilestoneId,
        NOW,
      ),
      service.form(
        seedGithubId(TEAM_MEMBER_ID),
        MILESTONES_PROGRAM_ID,
        teamMilestoneId,
        NOW,
      ),
    ]);

    // Then
    expect(personal).toMatchObject({
      applicationId: PERSONAL_APPLICATION_ID,
      applicationMode: 'PERSONAL',
      canSubmit: true,
    });
    expect(personal.milestone.deadlineLabel).toMatch(/^D-/);
    expect(team).toMatchObject({
      applicationId: TEAM_APPLICATION_ID,
      applicationMode: 'TEAM',
      canSubmit: true,
    });
  });

  it('기존 제출은 #116의 milestone query 체크리스트 URL을 반환한다', async () => {
    // Given
    const [milestoneId] = MILESTONE_SCENARIOS['submission-existing'];

    // When
    const form = await service.form(
      seedGithubId(TEAM_MEMBER_ID),
      MILESTONES_PROGRAM_ID,
      milestoneId,
      NOW,
    );

    // Then
    expect(form.existingSubmission).toMatchObject({
      checklistUrl: `/programs/${MILESTONES_PROGRAM_ID}/submissions?milestoneId=${milestoneId}`,
    });
    expect(form).toMatchObject({
      canSubmit: false,
      blockedReason: 'SUBMISSION_ALREADY_EXISTS',
    });
  });

  it('다른 신청의 학생은 제출할 수 없다', async () => {
    // Given
    const [milestoneId] = MILESTONE_SCENARIOS['milestones-upcoming'];

    // When
    const submission = service.create(
      seedGithubId(TEAM_MEMBER_ID),
      {
        applicationId: PERSONAL_APPLICATION_ID,
        milestoneId,
        content: { type: MilestoneSubmissionType.TEXT, text: '합성 제출' },
        comment: null,
      },
      NOW,
    );

    // Then
    await expect(submission).rejects.toMatchObject({
      errorCode: { code: SubmissionsErrorCode.NOT_APPLICATION_MEMBER },
    });
  });

  it('비학생 계정은 제출 폼과 최초 제출을 모두 사용할 수 없다', async () => {
    // Given
    const [milestoneId] = MILESTONE_SCENARIOS['milestones-upcoming'];
    const githubId = seedGithubId(NON_STUDENT_USER_ID);

    // When
    const form = service.form(
      githubId,
      MILESTONES_PROGRAM_ID,
      milestoneId,
      NOW,
    );
    const submission = service.create(
      githubId,
      {
        applicationId: PERSONAL_APPLICATION_ID,
        milestoneId,
        content: { type: MilestoneSubmissionType.TEXT, text: '합성 제출' },
        comment: null,
      },
      NOW,
    );

    // Then
    await Promise.all([
      expect(form).rejects.toMatchObject({
        errorCode: { code: SubmissionsErrorCode.STUDENT_ONLY },
      }),
      expect(submission).rejects.toMatchObject({
        errorCode: { code: SubmissionsErrorCode.STUDENT_ONLY },
      }),
    ]);
  });

  it('승인되지 않은 신청은 제출 폼과 최초 제출을 모두 사용할 수 없다', async () => {
    // Given
    const [milestoneId] = MILESTONE_SCENARIOS['milestones-upcoming'];
    const githubId = seedGithubId(UNAPPROVED_USER_ID);

    // When
    const form = service.form(
      githubId,
      MILESTONES_PROGRAM_ID,
      milestoneId,
      NOW,
    );
    const submission = service.create(
      githubId,
      {
        applicationId: UNAPPROVED_APPLICATION_ID,
        milestoneId,
        content: { type: MilestoneSubmissionType.TEXT, text: '합성 제출' },
        comment: null,
      },
      NOW,
    );

    // Then
    await Promise.all([
      expect(form).rejects.toMatchObject({
        errorCode: {
          code: SubmissionsErrorCode.APPLICATION_APPROVAL_REQUIRED,
        },
      }),
      expect(submission).rejects.toMatchObject({
        errorCode: {
          code: SubmissionsErrorCode.APPLICATION_APPROVAL_REQUIRED,
        },
      }),
    ]);
  });

  it('TEXT 최초 제출을 revision 1과 함께 저장하고 중복을 막는다', async () => {
    // Given
    const [milestoneId] = MILESTONE_SCENARIOS['milestones-upcoming'];
    const input = {
      applicationId: PERSONAL_APPLICATION_ID,
      milestoneId,
      content: {
        type: MilestoneSubmissionType.TEXT,
        text: '합성 최종 보고',
      },
      comment: '합성 코멘트',
    } as const;

    // When
    const submit = () =>
      service.create(seedGithubId(PERSONAL_USER_ID), input, NOW).then(
        (value) => ({ kind: 'fulfilled' as const, value }),
        (error: unknown) => {
          if (!(error instanceof DomainException)) throw error;
          return {
            kind: 'rejected' as const,
            errorCode: error.errorCode.code,
          };
        },
      );

    const results = await Promise.all([submit(), submit()]);

    // Then
    const stored = await prisma.submission.findUniqueOrThrow({
      where: {
        applicationId_milestoneId: {
          applicationId: PERSONAL_APPLICATION_ID,
          milestoneId,
        },
      },
      include: { revisions: true },
    });
    const fulfilled = results.find((result) => result.kind === 'fulfilled');
    const rejected = results.find((result) => result.kind === 'rejected');
    expect(fulfilled?.kind).toBe('fulfilled');
    expect(rejected?.kind).toBe('rejected');
    if (fulfilled?.kind !== 'fulfilled' || rejected?.kind !== 'rejected') {
      throw new Error('concurrent submissions did not converge');
    }
    expect(fulfilled.value).toMatchObject({
      submissionId: stored.id,
      status: 'SUBMITTED',
    });
    expect(rejected.errorCode).toBe(
      SubmissionsErrorCode.SUBMISSION_ALREADY_EXISTS,
    );
    expect(stored.revisions).toHaveLength(1);
    expect(stored.revisions[0]).toMatchObject({
      revision: 1,
      submittedById: PERSONAL_USER_ID,
      content: {
        type: MilestoneSubmissionType.TEXT,
        text: '합성 최종 보고',
      },
    });
  });
  it('마감 전 교체는 이전 revision을 보존하고 currentRevision만 전진시킨다', async () => {
    const [milestoneId] = MILESTONE_SCENARIOS['milestones-upcoming'];
    const created = await service.create(
      seedGithubId(PERSONAL_USER_ID),
      {
        applicationId: PERSONAL_APPLICATION_ID,
        milestoneId,
        content: { type: MilestoneSubmissionType.TEXT, text: '초기 본문' },
        comment: null,
      },
      NOW,
    );

    await expect(
      service.resubmit(
        seedGithubId(PERSONAL_USER_ID),
        created.submissionId,
        {
          baseRevision: 1,
          content: { type: MilestoneSubmissionType.TEXT, text: '교체 본문' },
          comment: '파일 교체',
        },
        NOW,
      ),
    ).resolves.toMatchObject({
      revision: 2,
      status: SubmissionStatus.SUBMITTED,
    });

    const stored = await prisma.submission.findUniqueOrThrow({
      where: { id: created.submissionId },
      include: { revisions: { orderBy: { revision: 'asc' } } },
    });
    expect(stored.currentRevision).toBe(2);
    expect(stored.revisions).toHaveLength(2);
    expect(stored.revisions.map((revision) => revision.content)).toEqual([
      { type: MilestoneSubmissionType.TEXT, text: '초기 본문' },
      { type: MilestoneSubmissionType.TEXT, text: '교체 본문' },
    ]);
  });

  it('마감과 지정 유형 불일치를 서버 시각 기준으로 차단한다', async () => {
    // Given
    const [overdueMilestoneId] = MILESTONE_SCENARIOS['milestones-overdue'];
    const [textMilestoneId] = MILESTONE_SCENARIOS['milestones-upcoming'];

    // When & Then: 두 handler를 즉시 등록해 빠른 실패가 unhandled로 새지 않게 한다.
    await Promise.all([
      expect(
        service.create(
          seedGithubId(PERSONAL_USER_ID),
          {
            applicationId: PERSONAL_APPLICATION_ID,
            milestoneId: overdueMilestoneId,
            content: {
              type: MilestoneSubmissionType.FILE,
              fileId: 'file-id',
            },
            comment: null,
          },
          new Date('2099-01-01T00:00:00.000Z'),
        ),
      ).rejects.toMatchObject({
        errorCode: { code: SubmissionsErrorCode.MILESTONE_CLOSED },
      }),
      expect(
        service.create(
          seedGithubId(PERSONAL_USER_ID),
          {
            applicationId: PERSONAL_APPLICATION_ID,
            milestoneId: textMilestoneId,
            content: {
              type: MilestoneSubmissionType.FILE,
              fileId: 'synthetic-mismatched-file',
            },
            comment: null,
          },
          NOW,
        ),
      ).rejects.toMatchObject({
        errorCode: { code: SubmissionsErrorCode.CONTENT_TYPE_MISMATCH },
      }),
    ]);
  });

  it('PENDING 파일에 업로드 만료와 보존 만료를 함께 저장한다', async () => {
    const programEndAt = new Date('2027-01-01T00:00:00.000Z');
    await prisma.program.update({
      where: { id: MILESTONES_PROGRAM_ID },
      data: { endAt: programEndAt },
    });
    const storage: SubmissionFileStoragePort = {
      put: jest.fn().mockResolvedValue({
        objectKey: 'private/synthetic-upload.pdf',
        originalName: 'synthetic-upload.pdf',
        contentLength: 14,
        contentType: 'application/pdf',
      }),
      delete: jest.fn().mockResolvedValue(undefined),
      get: jest.fn<ReturnType<SubmissionFileStoragePort['get']>, [string]>(),
    };
    const fileService = new SubmissionFilesService(
      new SubmissionFilesRepository(prisma),
      storage,
    );

    try {
      const uploaded = await fileService.upload(
        seedGithubId(PERSONAL_USER_ID),
        PERSONAL_APPLICATION_ID,
        FILE_MILESTONE_ID,
        {
          buffer: Buffer.from('%PDF-1.4\n%%EOF'),
          originalname: 'synthetic-upload.pdf',
          mimetype: 'application/pdf',
          size: 14,
        },
      );

      const row = await prisma.submissionFile.findUniqueOrThrow({
        where: { id: uploaded.fileId },
        select: {
          lifecycle: true,
          pendingExpiresAt: true,
          expiresAt: true,
        },
      });
      expect(row.lifecycle).toBe(SubmissionFileLifecycle.PENDING);
      expect(row.pendingExpiresAt).not.toBeNull();
      expect(row.expiresAt).toEqual(new Date('2028-01-01T00:00:00.000Z'));
    } finally {
      await prisma.submissionFile.deleteMany({
        where: {
          applicationId: PERSONAL_APPLICATION_ID,
          milestoneId: FILE_MILESTONE_ID,
          lifecycle: SubmissionFileLifecycle.PENDING,
        },
      });
      await prisma.program.update({
        where: { id: MILESTONES_PROGRAM_ID },
        data: { endAt: new Date('2026-12-08T00:00:00.000Z') },
      });
    }
  });

  it('FILE 보완 재제출은 replacement 파일을 새 revision에 붙이고 기존 파일을 보존한다', async () => {
    // Given
    const fixture = await seedFileResubmissionFixture('success');

    // When
    const result = await service.resubmit(
      seedGithubId(PERSONAL_USER_ID),
      fixture.submissionId,
      {
        baseRevision: 1,
        content: {
          type: MilestoneSubmissionType.FILE,
          fileId: fixture.replacementFileId,
        },
        comment: 'replacement upload',
      },
    );

    // Then
    expect(result).toEqual({
      submissionId: fixture.submissionId,
      revision: 2,
      status: SubmissionStatus.SUBMITTED,
    });
    const stored = await prisma.submission.findUniqueOrThrow({
      where: { id: fixture.submissionId },
      include: {
        revisions: { orderBy: { revision: 'asc' }, include: { files: true } },
      },
    });
    expect(stored).toMatchObject({
      status: SubmissionStatus.SUBMITTED,
      currentRevision: 2,
    });
    expect(stored.revisions).toHaveLength(2);
    expect(stored.revisions[0]?.files).toHaveLength(1);
    expect(stored.revisions[0]?.files[0]).toMatchObject({
      id: fixture.initialFileId,
      lifecycle: SubmissionFileLifecycle.ATTACHED,
    });
    expect(stored.revisions[1]?.files).toHaveLength(1);
    expect(stored.revisions[1]?.files[0]).toMatchObject({
      id: fixture.replacementFileId,
      lifecycle: SubmissionFileLifecycle.ATTACHED,
      pendingExpiresAt: null,
      expiresAt: addOneCalendarYear(FILE_RETENTION_START),
    });
  });

  it('FILE replacement attachment 실패는 revision 갱신을 롤백하고 기존 파일을 보존한다', async () => {
    // Given
    const fixture = await seedFileResubmissionFixture('rollback');

    // When
    const resubmission = service.resubmit(
      seedGithubId(PERSONAL_USER_ID),
      fixture.submissionId,
      {
        baseRevision: 1,
        content: {
          type: MilestoneSubmissionType.FILE,
          fileId: `${FILE_RESUBMISSION_PREFIX}-missing-file`,
        },
        comment: null,
      },
    );

    // Then
    await expect(resubmission).rejects.toMatchObject({
      errorCode: { code: SubmissionsErrorCode.FILE_SUBMISSION_UNAVAILABLE },
    });
    const stored = await prisma.submission.findUniqueOrThrow({
      where: { id: fixture.submissionId },
      include: { revisions: { include: { files: true } } },
    });
    expect(stored).toMatchObject({
      status: SubmissionStatus.CHANGES_REQUESTED,
      currentRevision: 1,
    });
    expect(stored.revisions).toHaveLength(1);
    expect(stored.revisions[0]?.files).toHaveLength(1);
    expect(stored.revisions[0]?.files[0]).toMatchObject({
      id: fixture.initialFileId,
      lifecycle: SubmissionFileLifecycle.ATTACHED,
    });
    await expect(
      prisma.submissionFile.findUniqueOrThrow({
        where: { id: fixture.replacementFileId },
      }),
    ).resolves.toMatchObject({
      lifecycle: SubmissionFileLifecycle.PENDING,
      submissionRevisionId: null,
    });
  });

  it('교직원이 FILE 유형을 바꾸는 동안 대기한 재제출은 잠금 뒤 최신 유형으로 거절한다', async () => {
    // Given
    const fixture = await seedFileResubmissionFixture('type-race');
    let releaseProgramLock: (() => void) | undefined;
    const programLockRelease = new Promise<void>((resolve) => {
      releaseProgramLock = resolve;
    });
    let markStaffUpdateReady: (() => void) | undefined;
    const staffUpdateReady = new Promise<void>((resolve) => {
      markStaffUpdateReady = resolve;
    });
    const staffUpdate = prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT id
        FROM "Program"
        WHERE id = ${MILESTONES_PROGRAM_ID}
        FOR UPDATE
      `;
      await transaction.milestone.update({
        where: { id: FILE_MILESTONE_ID },
        data: { submissionType: MilestoneSubmissionType.TEXT },
      });
      markStaffUpdateReady?.();
      await programLockRelease;
    });
    await staffUpdateReady;

    // When
    const resubmission = service.resubmit(
      seedGithubId(PERSONAL_USER_ID),
      fixture.submissionId,
      {
        baseRevision: 1,
        content: {
          type: MilestoneSubmissionType.FILE,
          fileId: fixture.replacementFileId,
        },
        comment: null,
      },
    );

    try {
      await waitForProgramLockWaiter();
    } finally {
      releaseProgramLock?.();
    }
    await staffUpdate;

    // Then
    await expect(resubmission).rejects.toMatchObject({
      errorCode: { code: SubmissionsErrorCode.CONTENT_TYPE_MISMATCH },
    });
    await expect(
      prisma.submission.findUniqueOrThrow({
        where: { id: fixture.submissionId },
        select: { status: true, currentRevision: true },
      }),
    ).resolves.toEqual({
      status: SubmissionStatus.CHANGES_REQUESTED,
      currentRevision: 1,
    });
  });
});

async function waitForProgramLockWaiter(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const rows = await prisma.$queryRaw<readonly { waiting: bigint }[]>`
      SELECT COUNT(*) AS waiting
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type = 'Lock'
        AND query LIKE '%SELECT "endAt"%'
    `;
    if ((rows[0]?.waiting ?? 0n) > 0n) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Expected the student resubmission to wait on Program lock.');
}

async function seedFileResubmissionFixture(suffix: string): Promise<{
  readonly submissionId: string;
  readonly initialFileId: string;
  readonly replacementFileId: string;
}> {
  await prisma.program.update({
    where: { id: MILESTONES_PROGRAM_ID },
    data: { endAt: FILE_RETENTION_START },
  });
  const submissionId = `${FILE_RESUBMISSION_PREFIX}-${suffix}`;
  const initialFileId = `${FILE_RESUBMISSION_PREFIX}-${suffix}-initial`;
  const replacementFileId = `${FILE_RESUBMISSION_PREFIX}-${suffix}-replacement`;
  const revision = await prisma.submission.create({
    data: {
      id: submissionId,
      applicationId: PERSONAL_APPLICATION_ID,
      milestoneId: FILE_MILESTONE_ID,
      status: SubmissionStatus.CHANGES_REQUESTED,
      currentRevision: 1,
      revisions: {
        create: {
          revision: 1,
          submissionType: MilestoneSubmissionType.FILE,
          content: {
            type: MilestoneSubmissionType.FILE,
            fileId: initialFileId,
          },
          submittedById: PERSONAL_USER_ID,
        },
      },
    },
    select: { revisions: { select: { id: true }, take: 1 } },
  });
  const initialRevision = revision.revisions[0];
  if (initialRevision === undefined) {
    throw new Error('Expected initial file revision.');
  }
  await prisma.submissionFile.createMany({
    data: [
      {
        id: initialFileId,
        uploaderId: PERSONAL_USER_ID,
        applicationId: PERSONAL_APPLICATION_ID,
        milestoneId: FILE_MILESTONE_ID,
        storageKey: `${FILE_RESUBMISSION_PREFIX}/${suffix}/initial.pdf`,
        originalFileName: 'initial.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 14,
        lifecycle: SubmissionFileLifecycle.ATTACHED,
        pendingExpiresAt: null,
        expiresAt: addOneCalendarYear(FILE_RETENTION_START),
        submissionRevisionId: initialRevision.id,
      },
      {
        id: replacementFileId,
        uploaderId: PERSONAL_USER_ID,
        applicationId: PERSONAL_APPLICATION_ID,
        milestoneId: FILE_MILESTONE_ID,
        storageKey: `${FILE_RESUBMISSION_PREFIX}/${suffix}/replacement.pdf`,
        originalFileName: 'replacement.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 14,
        lifecycle: SubmissionFileLifecycle.PENDING,
        pendingExpiresAt: new Date('2099-01-01T00:00:00.000Z'),
        expiresAt: addOneCalendarYear(FILE_RETENTION_START),
        submissionRevisionId: null,
      },
    ],
  });
  return { submissionId, initialFileId, replacementFileId };
}
