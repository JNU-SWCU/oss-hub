import {
  AffiliationKind,
  MemberKind,
  MilestoneDocumentKind,
  MilestoneDocumentSubmissionHistoryEvent,
  MilestoneSubmissionType,
  ReviewDecision,
  SubmissionFileLifecycle,
  SubmissionStatus,
} from '@prisma/client';
import { runProfile } from '../../prisma/seed';
import {
  offsetDays,
  prisma as seedPrisma,
  seedGithubId,
  seedId,
  SeedStats,
} from '../../prisma/seeds/helpers';
import { MILESTONE_SCENARIOS } from '../../prisma/seeds/milestones';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { PrismaService } from '../prisma/prisma.service';
import { SubmissionsErrorCode } from './submissions-error-code.enum';
import { SubmissionsRepository } from './submissions.repository';
import { SubmissionsService } from './submissions.service';

// allow: SIZE_OK — 체크리스트 개인/팀/비멤버 + 재제출 성공·보존·마감후·stale 시나리오가 하나의 격리 PostgreSQL lifecycle을 공유한다.
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
const REVIEWER_ID = seedId('milestones', 'user', 'reviewer');
const OUTSIDER_USER_ID = 'synthetic-checklist-outsider-student';
const OVERDUE_TEXT_MILESTONE_ID = 'synthetic-checklist-overdue-text-milestone';
const FILE_METADATA_MILESTONE_ID = 'synthetic-checklist-file-metadata';
const CLEANUP_MILESTONE_IDS = [
  ...MILESTONE_SCENARIOS['milestones-upcoming'],
  OVERDUE_TEXT_MILESTONE_ID,
  FILE_METADATA_MILESTONE_ID,
];

/** CHANGES_REQUESTED 상태를 테스트에서 직접 seed한다 — 최신 revision에 Review를 단다. */
async function seedChangesRequestedSubmission(params: {
  readonly id: string;
  readonly milestoneId: string;
  readonly applicationId: string;
  readonly submittedById: string;
  readonly revisionCount?: number;
}): Promise<void> {
  const revisionCount = params.revisionCount ?? 1;
  await prisma.submission.create({
    data: {
      id: params.id,
      milestoneId: params.milestoneId,
      applicationId: params.applicationId,
      status: SubmissionStatus.CHANGES_REQUESTED,
      currentRevision: revisionCount,
      revisions: {
        create: Array.from({ length: revisionCount }, (_, index) => ({
          id: `${params.id}-revision-${index + 1}`,
          revision: index + 1,
          submissionType: MilestoneSubmissionType.TEXT,
          content: { type: 'TEXT', text: `합성 revision ${index + 1}` },
          submittedById: params.submittedById,
        })),
      },
    },
  });
  await prisma.review.create({
    data: {
      id: `${params.id}-review`,
      submissionRevisionId: `${params.id}-revision-${revisionCount}`,
      reviewerId: REVIEWER_ID,
      decision: ReviewDecision.CHANGES_REQUESTED,
      comment: '보완 후 재제출해 주세요 (합성)',
    },
  });

  const existingDocument = await prisma.milestoneDocument.findFirst({
    where: {
      milestoneId: params.milestoneId,
      kind: MilestoneDocumentKind.LEGACY_MILESTONE_SUBMISSION,
    },
    select: { id: true },
  });
  const documentId =
    existingDocument?.id ?? `${params.milestoneId}-legacy-document`;
  if (existingDocument === null) {
    await prisma.milestoneDocument.create({
      data: {
        id: documentId,
        milestoneId: params.milestoneId,
        name: '합성 기존 제출',
        required: true,
        sortOrder: -1,
        kind: MilestoneDocumentKind.LEGACY_MILESTONE_SUBMISSION,
      },
    });
  }
  const targetId = `${params.id}-target`;
  await prisma.milestoneDocumentSubmission.create({
    data: {
      id: targetId,
      legacySubmissionId: params.id,
      milestoneDocumentId: documentId,
      applicationId: params.applicationId,
      status: SubmissionStatus.CHANGES_REQUESTED,
      content: { type: 'TEXT', text: `합성 revision ${revisionCount}` },
      revision: revisionCount,
      submittedById: params.submittedById,
    },
  });
  const histories = Array.from({ length: revisionCount }, (_, index) => ({
    id: `${params.id}-target-history-${index + 1}`,
    milestoneDocumentSubmissionId: targetId,
    event:
      index === 0
        ? MilestoneDocumentSubmissionHistoryEvent.SUBMITTED
        : MilestoneDocumentSubmissionHistoryEvent.RESUBMITTED,
    revision: index + 1,
    content: { type: 'TEXT', text: `합성 revision ${index + 1}` },
    actorId: params.submittedById,
  }));
  await prisma.milestoneDocumentSubmissionHistory.createMany({
    data: histories,
  });
  await prisma.milestoneDocumentReviewHistory.create({
    data: {
      id: `${params.id}-target-review`,
      milestoneDocumentSubmissionId: targetId,
      submissionHistoryId: `${params.id}-target-history-${revisionCount}`,
      reviewerId: REVIEWER_ID,
      decision: ReviewDecision.CHANGES_REQUESTED,
      comment: '보완 후 재제출해 주세요 (합성)',
    },
  });
}

describe('SubmissionsService checklist/resubmission integration', () => {
  beforeAll(async () => {
    await Promise.all([prisma.$connect(), seedPrisma.$connect()]);
    await runProfile('milestones', new SeedStats());
    await prisma.user.createMany({
      data: [
        {
          id: OUTSIDER_USER_ID,
          githubId: seedGithubId(OUTSIDER_USER_ID),
          nickname: OUTSIDER_USER_ID,
          selectedMemberKind: MemberKind.STUDENT,
        },
      ],
      skipDuplicates: true,
    });
    await prisma.userProfile.upsert({
      where: { userId: OUTSIDER_USER_ID },
      update: {},
      create: {
        userId: OUTSIDER_USER_ID,
        name: '합성 외부 학생',
        studentId: '261098',
        department: '합성 학과',
        memberKind: MemberKind.STUDENT,
        affiliationKind: AffiliationKind.DEPARTMENT,
        affiliationName: '합성 학과',
      },
    });
    // 마감이 지난 TEXT 마일스톤 — 보완 재제출이 dueAt 이후에도 허용됨을 검증한다.
    await prisma.milestone.createMany({
      data: [
        {
          id: OVERDUE_TEXT_MILESTONE_ID,
          programId: MILESTONES_PROGRAM_ID,
          name: '합성 마감 지난 텍스트 제출',
          dueAt: new Date('2020-01-01T00:00:00.000Z'),
          submissionType: MilestoneSubmissionType.TEXT,
        },
        {
          id: FILE_METADATA_MILESTONE_ID,
          programId: MILESTONES_PROGRAM_ID,
          name: '합성 파일 메타데이터 제출',
          dueAt: offsetDays(90),
          submissionType: MilestoneSubmissionType.FILE,
        },
      ],
      skipDuplicates: true,
    });
  });

  afterEach(async () => {
    await prisma.submissionFile.deleteMany({
      where: { milestoneId: { in: CLEANUP_MILESTONE_IDS } },
    });
    await prisma.milestoneDocumentReviewHistory.deleteMany({
      where: {
        milestoneDocumentSubmission: {
          milestoneDocument: { milestoneId: { in: CLEANUP_MILESTONE_IDS } },
        },
      },
    });
    await prisma.milestoneDocumentSubmissionHistory.deleteMany({
      where: {
        submission: {
          milestoneDocument: { milestoneId: { in: CLEANUP_MILESTONE_IDS } },
        },
      },
    });
    await prisma.milestoneDocumentSubmission.deleteMany({
      where: {
        milestoneDocument: { milestoneId: { in: CLEANUP_MILESTONE_IDS } },
      },
    });
    await prisma.review.deleteMany({
      where: {
        submissionRevision: {
          submission: { milestoneId: { in: CLEANUP_MILESTONE_IDS } },
        },
      },
    });
    await prisma.submissionRevision.deleteMany({
      where: { submission: { milestoneId: { in: CLEANUP_MILESTONE_IDS } } },
    });
    await prisma.submission.deleteMany({
      where: { milestoneId: { in: CLEANUP_MILESTONE_IDS } },
    });
  });

  afterAll(async () => {
    await prisma.milestoneDocument.deleteMany({
      where: {
        milestoneId: {
          in: [OVERDUE_TEXT_MILESTONE_ID, FILE_METADATA_MILESTONE_ID],
        },
      },
    });
    await prisma.milestone.deleteMany({
      where: {
        id: { in: [OVERDUE_TEXT_MILESTONE_ID, FILE_METADATA_MILESTONE_ID] },
      },
    });
    await prisma.user.deleteMany({ where: { id: OUTSIDER_USER_ID } });
    await Promise.all([prisma.$disconnect(), seedPrisma.$disconnect()]);
  });

  it('개인형 신청자는 프로그램 전체 마일스톤을 dueAt 오름차순으로 조회한다', async () => {
    // Given
    const [upcomingId] = MILESTONE_SCENARIOS['milestones-upcoming'];
    const [approvedId] = MILESTONE_SCENARIOS['submission-approved'];
    const [rejectedId] = MILESTONE_SCENARIOS['submission-rejected'];

    // When
    const checklist = await service.checklist(
      seedGithubId(PERSONAL_USER_ID),
      MILESTONES_PROGRAM_ID,
    );

    // Then
    expect(checklist.applicationId).toBe(PERSONAL_APPLICATION_ID);
    expect(checklist.applicationMode).toBe('PERSONAL');
    const dueAts = checklist.items.map((item) => Date.parse(item.dueAt));
    expect(dueAts).toEqual([...dueAts].sort((a, b) => a - b));

    const upcoming = checklist.items.find(
      (item) => item.milestoneId === upcomingId,
    );
    expect(upcoming?.submission).toBeNull();

    const approved = checklist.items.find(
      (item) => item.milestoneId === approvedId,
    );
    expect(approved?.submission).toMatchObject({
      status: SubmissionStatus.APPROVED,
      currentRevision: 1,
      // 승인된 제출물은 마감 전이어도 교체 진입을 열지 않는다 — 판정 무결성 보호.
      canResubmit: false,
    });
    expect(approved?.submission?.lastReviewedAt).not.toBeNull();

    const rejected = checklist.items.find(
      (item) => item.milestoneId === rejectedId,
    );
    expect(rejected?.submission).toMatchObject({
      status: SubmissionStatus.REJECTED,
      canResubmit: false,
      reviewComment: '제출 요건을 충족하지 못했습니다 (seed fixture)',
    });
  });

  it('팀원은 마감 전 제출물과 CHANGES_REQUESTED 제출을 교체할 수 있다', async () => {
    // Given
    const [changesRequestedId] =
      MILESTONE_SCENARIOS['submission-changes-requested'];
    const [existingId] = MILESTONE_SCENARIOS['submission-existing'];
    const [approvedId] = MILESTONE_SCENARIOS['submission-approved'];

    // When
    const checklist = await service.checklist(
      seedGithubId(TEAM_MEMBER_ID),
      MILESTONES_PROGRAM_ID,
    );

    // Then
    expect(checklist.applicationId).toBe(TEAM_APPLICATION_ID);
    expect(checklist.applicationMode).toBe('TEAM');

    const changesRequested = checklist.items.find(
      (item) => item.milestoneId === changesRequestedId,
    );
    expect(changesRequested?.submission).toMatchObject({
      status: SubmissionStatus.CHANGES_REQUESTED,
      currentRevision: 1,
      canResubmit: true,
      reviewComment: '누락된 항목을 보완해 재제출해 주세요 (seed fixture)',
    });
    expect(changesRequested?.submission?.lastReviewedAt).not.toBeNull();

    const existing = checklist.items.find(
      (item) => item.milestoneId === existingId,
    );
    expect(existing?.submission).toMatchObject({
      status: SubmissionStatus.SUBMITTED,
      canResubmit: true,
      lastReviewedAt: null,
      reviewComment: null,
    });

    // 개인 신청의 제출은 팀 체크리스트에 나타나지 않는다.
    const approved = checklist.items.find(
      (item) => item.milestoneId === approvedId,
    );
    expect(approved?.submission).toBeNull();
  });

  it('승인된 신청이 없는 학생의 체크리스트 조회는 403이다', async () => {
    // When
    const checklist = service.checklist(
      seedGithubId(OUTSIDER_USER_ID),
      MILESTONES_PROGRAM_ID,
    );

    // Then
    await expect(checklist).rejects.toMatchObject({
      errorCode: { code: SubmissionsErrorCode.NOT_APPLICATION_MEMBER },
    });
  });

  it('체크리스트는 현재 revision의 ATTACHED·미만료 파일만 안전한 메타데이터로 노출한다', async () => {
    // Given
    await prisma.submission.create({
      data: {
        id: 'synthetic-checklist-file-submission',
        milestoneId: FILE_METADATA_MILESTONE_ID,
        applicationId: PERSONAL_APPLICATION_ID,
        currentRevision: 1,
        revisions: {
          create: {
            id: 'synthetic-checklist-file-revision',
            revision: 1,
            submissionType: MilestoneSubmissionType.FILE,
            content: { type: 'FILE', fileId: 'synthetic-checklist-file-ok' },
            submittedById: PERSONAL_USER_ID,
          },
        },
      },
    });
    const targetDocumentId = `${FILE_METADATA_MILESTONE_ID}-legacy-document`;
    await prisma.milestoneDocument.upsert({
      where: { id: targetDocumentId },
      update: {},
      create: {
        id: targetDocumentId,
        milestoneId: FILE_METADATA_MILESTONE_ID,
        name: '합성 파일 메타데이터 제출',
        required: true,
        sortOrder: -1,
        kind: MilestoneDocumentKind.LEGACY_MILESTONE_SUBMISSION,
      },
    });
    const targetSubmissionId = 'synthetic-checklist-file-target';
    const targetHistoryId = 'synthetic-checklist-file-target-history';
    await prisma.milestoneDocumentSubmission.create({
      data: {
        id: targetSubmissionId,
        legacySubmissionId: 'synthetic-checklist-file-submission',
        milestoneDocumentId: targetDocumentId,
        applicationId: PERSONAL_APPLICATION_ID,
        revision: 1,
        submittedById: PERSONAL_USER_ID,
      },
    });
    await prisma.milestoneDocumentSubmissionHistory.create({
      data: {
        id: targetHistoryId,
        milestoneDocumentSubmissionId: targetSubmissionId,
        event: MilestoneDocumentSubmissionHistoryEvent.SUBMITTED,
        revision: 1,
        content: { type: 'FILE', fileId: 'synthetic-checklist-file-ok' },
        actorId: PERSONAL_USER_ID,
      },
    });
    await prisma.submissionFile.createMany({
      data: [
        {
          id: 'synthetic-checklist-file-ok',
          uploaderId: PERSONAL_USER_ID,
          applicationId: PERSONAL_APPLICATION_ID,
          milestoneId: FILE_METADATA_MILESTONE_ID,
          storageKey: 'submission-files/private-ok',
          originalFileName: 'report.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
          submissionRevisionId: 'synthetic-checklist-file-revision',
          milestoneDocumentSubmissionId: targetSubmissionId,
          milestoneDocumentSubmissionHistoryId: targetHistoryId,
          lifecycle: SubmissionFileLifecycle.ATTACHED,
          expiresAt: new Date('2028-01-01T00:00:00.000Z'),
        },
        {
          id: 'synthetic-checklist-file-pending',
          uploaderId: PERSONAL_USER_ID,
          applicationId: PERSONAL_APPLICATION_ID,
          milestoneId: FILE_METADATA_MILESTONE_ID,
          storageKey: 'submission-files/private-pending',
          originalFileName: 'pending.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 2048,
          lifecycle: SubmissionFileLifecycle.PENDING,
          pendingExpiresAt: new Date('2028-01-01T00:00:00.000Z'),
          expiresAt: new Date('2028-01-01T00:00:00.000Z'),
        },
        {
          id: 'synthetic-checklist-file-expired',
          uploaderId: PERSONAL_USER_ID,
          applicationId: PERSONAL_APPLICATION_ID,
          milestoneId: FILE_METADATA_MILESTONE_ID,
          storageKey: 'submission-files/private-expired',
          originalFileName: 'expired.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 4096,
          submissionRevisionId: 'synthetic-checklist-file-revision',
          milestoneDocumentSubmissionId: targetSubmissionId,
          milestoneDocumentSubmissionHistoryId: targetHistoryId,
          lifecycle: SubmissionFileLifecycle.ATTACHED,
          expiresAt: new Date('2020-01-01T00:00:00.000Z'),
        },
      ],
    });

    // When
    const checklist = await service.checklist(
      seedGithubId(PERSONAL_USER_ID),
      MILESTONES_PROGRAM_ID,
      new Date('2026-07-31T00:00:00.000Z'),
    );

    // Then
    const fileMilestone = checklist.items.find(
      (item) => item.milestoneId === FILE_METADATA_MILESTONE_ID,
    );
    expect(fileMilestone?.submission?.file).toEqual({
      fileId: 'synthetic-checklist-file-ok',
      fileName: 'report.pdf',
      contentType: 'application/pdf',
      size: 1024,
      expiresAt: '2028-01-01T00:00:00.000Z',
      downloadUrl: '/api/v1/submission-files/synthetic-checklist-file-ok',
    });
    expect(JSON.stringify(fileMilestone)).not.toContain('storageKey');
    expect(JSON.stringify(fileMilestone)).not.toContain('private-pending');
    expect(JSON.stringify(fileMilestone)).not.toContain('private-expired');
  });

  it('마감 후에도 보완 재제출은 revision을 추가하고 이전 기록을 보존한다', async () => {
    // Given: dueAt이 지난 마일스톤의 CHANGES_REQUESTED 제출.
    const submissionId = 'synthetic-checklist-resubmit-target';
    await seedChangesRequestedSubmission({
      id: submissionId,
      milestoneId: OVERDUE_TEXT_MILESTONE_ID,
      applicationId: PERSONAL_APPLICATION_ID,
      submittedById: PERSONAL_USER_ID,
    });

    // When
    const result = await service.resubmit(
      seedGithubId(PERSONAL_USER_ID),
      submissionId,
      {
        baseRevision: 1,
        content: { type: MilestoneSubmissionType.TEXT, text: '보완한 본문' },
        comment: '실행 화면을 추가했습니다',
      },
    );

    // Then
    expect(result).toEqual({
      submissionId,
      revision: 2,
      status: SubmissionStatus.SUBMITTED,
    });
    const stored = await prisma.milestoneDocumentSubmission.findUniqueOrThrow({
      where: { legacySubmissionId: submissionId },
      include: {
        histories: {
          where: { revision: { not: null } },
          orderBy: { revision: 'asc' },
          include: { reviewHistories: true },
        },
      },
    });
    expect(stored).toMatchObject({
      status: SubmissionStatus.SUBMITTED,
      revision: 2,
    });
    expect(stored.histories).toHaveLength(2);
    expect(stored.histories[0]).toMatchObject({
      revision: 1,
      content: { type: 'TEXT', text: '합성 revision 1' },
    });
    expect(stored.histories[0]?.reviewHistories[0]).toMatchObject({
      decision: ReviewDecision.CHANGES_REQUESTED,
      comment: '보완 후 재제출해 주세요 (합성)',
    });
    expect(stored.histories[1]).toMatchObject({
      revision: 2,
      actorId: PERSONAL_USER_ID,
      content: { type: 'TEXT', text: '보완한 본문' },
      comment: '실행 화면을 추가했습니다',
      reviewHistories: [],
    });
  });

  it('오래된 baseRevision 재제출은 409 STALE_SUBMISSION_REVISION이다', async () => {
    // Given: currentRevision 2인 CHANGES_REQUESTED 제출과 오래된 탭의 baseRevision 1.
    const [upcomingId] = MILESTONE_SCENARIOS['milestones-upcoming'];
    const submissionId = 'synthetic-checklist-stale-target';
    await seedChangesRequestedSubmission({
      id: submissionId,
      milestoneId: upcomingId,
      applicationId: PERSONAL_APPLICATION_ID,
      submittedById: PERSONAL_USER_ID,
      revisionCount: 2,
    });

    // When
    const resubmission = service.resubmit(
      seedGithubId(PERSONAL_USER_ID),
      submissionId,
      {
        baseRevision: 1,
        content: { type: MilestoneSubmissionType.TEXT, text: '보완한 본문' },
        comment: null,
      },
    );

    // Then
    await expect(resubmission).rejects.toMatchObject({
      errorCode: { code: SubmissionsErrorCode.STALE_SUBMISSION_REVISION },
    });
    const stored = await prisma.milestoneDocumentSubmission.findUniqueOrThrow({
      where: { legacySubmissionId: submissionId },
      include: { histories: { where: { revision: { not: null } } } },
    });
    expect(stored.revision).toBe(2);
    expect(stored.histories).toHaveLength(2);
  });

  it('마감 후 SUBMITTED·APPROVED 교체와 REJECTED 교체를 차단한다', async () => {
    const submittedId = seedId(
      'milestones',
      'submission-existing',
      'submission',
    );
    const approvedId = seedId(
      'milestones',
      'submission-approved',
      'submission',
    );
    const rejectedId = seedId(
      'milestones',
      'submission-rejected',
      'submission',
    );
    const input = {
      baseRevision: 1,
      content: {
        type: MilestoneSubmissionType.TEXT,
        text: '보완한 본문',
      },
      comment: null,
    } as const;
    const afterDeadline = new Date('2099-01-01T00:00:00.000Z');

    await expect(
      service.resubmit(
        seedGithubId(TEAM_MEMBER_ID),
        submittedId,
        input,
        afterDeadline,
      ),
    ).rejects.toMatchObject({
      errorCode: { code: SubmissionsErrorCode.SUBMISSION_REPLACEMENT_CLOSED },
    });
    // APPROVED 는 마감과 무관하게 교체하지 않는다 — 교직원 판정이 옛 revision 을
    // 가리킨 채 남기 때문에 SUBMISSION_REPLACEMENT_CLOSED 보다 앞서 거부한다.
    await expect(
      service.resubmit(
        seedGithubId(PERSONAL_USER_ID),
        approvedId,
        input,
        afterDeadline,
      ),
    ).rejects.toMatchObject({
      errorCode: { code: SubmissionsErrorCode.RESUBMISSION_NOT_ALLOWED },
    });
    await expect(
      service.resubmit(
        seedGithubId(PERSONAL_USER_ID),
        rejectedId,
        input,
        afterDeadline,
      ),
    ).rejects.toMatchObject({
      errorCode: { code: SubmissionsErrorCode.RESUBMISSION_NOT_ALLOWED },
    });
  });

  it('남의 제출 재제출은 403, 없는 제출은 404다', async () => {
    // Given: 팀 신청의 CHANGES_REQUESTED 제출과 개인 신청자.
    const teamSubmissionId = seedId(
      'milestones',
      'submission-changes-requested',
      'submission',
    );
    const input = {
      baseRevision: 1,
      content: {
        type: MilestoneSubmissionType.TEXT,
        text: '보완한 본문',
      },
      comment: null,
    } as const;

    // When & Then
    await expect(
      service.resubmit(seedGithubId(PERSONAL_USER_ID), teamSubmissionId, input),
    ).rejects.toMatchObject({
      errorCode: { code: SubmissionsErrorCode.NOT_APPLICATION_MEMBER },
    });
    await expect(
      service.resubmit(
        seedGithubId(PERSONAL_USER_ID),
        'synthetic-checklist-missing-submission',
        input,
      ),
    ).rejects.toMatchObject({
      errorCode: { code: SubmissionsErrorCode.SUBMISSION_NOT_FOUND },
    });
  });
});
