import {
  ApplicationStatus,
  MilestoneSubmissionType,
  Role,
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
import { DomainException } from '../common/error-code';
import { PrismaService } from '../prisma/prisma.service';
import { SubmissionsErrorCode } from './submissions-error-code.enum';
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
const REPOSITORY_SCENARIO = 'repository-ready';
const REPOSITORY_PROGRAM_ID = seedId('repositories', 'program');
const REPOSITORY_APPLICATION_ID = seedId(
  'repositories',
  REPOSITORY_SCENARIO,
  'application',
);
const REPOSITORY_USER_ID = seedId(
  'repositories',
  REPOSITORY_SCENARIO,
  'applicant',
);
const NON_STUDENT_USER_ID = 'synthetic-submission-non-student';
const UNAPPROVED_USER_ID = 'synthetic-submission-unapproved-student';
const UNAPPROVED_APPLICATION_ID = 'synthetic-submission-unapproved-application';
const FILE_MILESTONE_ID = 'synthetic-submission-file-milestone';
const RELEASE_MILESTONE_ID = 'synthetic-submission-release-milestone';
const NOW = new Date('2026-07-23T00:00:00.000Z');

describe('SubmissionsService integration', () => {
  beforeAll(async () => {
    await Promise.all([prisma.$connect(), seedPrisma.$connect()]);
    await runProfile('milestones', new SeedStats());
    await runProfile('repositories', new SeedStats());
    await prisma.user.createMany({
      data: [
        {
          id: NON_STUDENT_USER_ID,
          githubId: seedGithubId(NON_STUDENT_USER_ID),
          login: 'synthetic-submission-non-student',
          role: Role.STAFF,
        },
        {
          id: UNAPPROVED_USER_ID,
          githubId: seedGithubId(UNAPPROVED_USER_ID),
          login: 'synthetic-submission-unapproved-student',
          role: Role.STUDENT,
        },
      ],
      skipDuplicates: true,
    });
    await prisma.application.upsert({
      where: { id: UNAPPROVED_APPLICATION_ID },
      update: { status: ApplicationStatus.SUBMITTED },
      create: {
        id: UNAPPROVED_APPLICATION_ID,
        programId: MILESTONES_PROGRAM_ID,
        applicantId: UNAPPROVED_USER_ID,
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
        {
          id: RELEASE_MILESTONE_ID,
          programId: REPOSITORY_PROGRAM_ID,
          name: '합성 릴리스 제출',
          dueAt: new Date('2026-08-30T00:00:00.000Z'),
          submissionType: MilestoneSubmissionType.REPOSITORY_RELEASE,
        },
      ],
      skipDuplicates: true,
    });
  });

  afterEach(async () => {
    const milestoneIds = [
      ...MILESTONE_SCENARIOS['milestones-upcoming'],
      FILE_MILESTONE_ID,
      RELEASE_MILESTONE_ID,
    ];
    await prisma.submissionRevision.deleteMany({
      where: { submission: { milestoneId: { in: milestoneIds } } },
    });
    await prisma.submission.deleteMany({
      where: { milestoneId: { in: milestoneIds } },
    });
  });

  afterAll(async () => {
    await prisma.milestone.deleteMany({
      where: { id: { in: [FILE_MILESTONE_ID, RELEASE_MILESTONE_ID] } },
    });
    await prisma.application.deleteMany({
      where: { id: UNAPPROVED_APPLICATION_ID },
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
              type: MilestoneSubmissionType.REPOSITORY_RELEASE,
              releaseUrl:
                'https://github.invalid/oss-hub-seed/repository-ready/releases/tag/v1',
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

  it('FILE 유형은 준비되지 않은 상태로 fail-closed 한다', async () => {
    // Given: 실제 storage 없이 미래 FILE 마일스톤만 존재한다.

    // When
    const form = await service.form(
      seedGithubId(PERSONAL_USER_ID),
      MILESTONES_PROGRAM_ID,
      FILE_MILESTONE_ID,
      NOW,
    );
    const submission = service.create(
      seedGithubId(PERSONAL_USER_ID),
      {
        applicationId: PERSONAL_APPLICATION_ID,
        milestoneId: FILE_MILESTONE_ID,
        content: { type: MilestoneSubmissionType.FILE, fileId: 'file-id' },
        comment: null,
      },
      NOW,
    );

    // Then
    expect(form).toMatchObject({
      canSubmit: false,
      blockedReason: 'FILE_UPLOAD_UNAVAILABLE',
    });
    await expect(submission).rejects.toMatchObject({
      errorCode: { code: SubmissionsErrorCode.FILE_SUBMISSION_UNAVAILABLE },
    });
  });

  it('연결된 저장소의 태그 URL만 REPOSITORY_RELEASE로 저장한다', async () => {
    // Given
    const linkedRepository = await prisma.repository.findUniqueOrThrow({
      where: { applicationId: REPOSITORY_APPLICATION_ID },
    });
    const validReleaseUrl = `${linkedRepository.url}/releases/tag/v1.0.0`;

    // When
    const created = await service.create(
      seedGithubId(REPOSITORY_USER_ID),
      {
        applicationId: REPOSITORY_APPLICATION_ID,
        milestoneId: RELEASE_MILESTONE_ID,
        content: {
          type: MilestoneSubmissionType.REPOSITORY_RELEASE,
          releaseUrl: validReleaseUrl,
        },
        comment: null,
      },
      NOW,
    );

    // Then
    const revision = await prisma.submissionRevision.findFirstOrThrow({
      where: { submissionId: created.submissionId },
    });
    expect(revision.content).toEqual({
      type: MilestoneSubmissionType.REPOSITORY_RELEASE,
      releaseUrl: validReleaseUrl,
    });
  });
});
