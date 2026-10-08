import {
  ApplicationStatus,
  BoardPostCategory,
  MilestoneDocumentKind,
  MilestoneDocumentSubmissionHistoryEvent,
  MilestoneSubmissionType,
  ProgramCategory,
  ReviewDecision,
  SubmissionFileLifecycle,
  SubmissionStatus,
} from '@prisma/client';
import { computeJoinCodeDigest } from '../../src/common/join-code-digest';
import type { ObjectStoragePort } from '../../src/storage/domain/object-storage';
import {
  offsetDays,
  prisma,
  seedId,
  SeedStats,
  upsertConsent,
  upsertSeedProfile,
  upsertSeedUser,
  upsertTracked,
} from './helpers';

const DEMO_SUBMISSION_FILE_STORAGE_PREFIX = 'submission-files/seed-demo/';

function demoSubmissionFileStorageKey(fileId: string): string {
  return `${DEMO_SUBMISSION_FILE_STORAGE_PREFIX}${fileId}`;
}

function demoSubmissionFilePlaceholderBody(originalFileName: string): Buffer {
  return Buffer.from(
    `이 파일은 oss-hub demo profile이 만든 시연용 placeholder입니다.\n` +
      `실제 제출물이 아닙니다 (seed fixture, original name: ${originalFileName}).\n`,
    'utf-8',
  );
}

type DemoStudent = {
  readonly slug: string;
  readonly name: string;
  readonly studentId: string;
  readonly department: string;
  readonly emailLocalPart: string;
};

const DEMO_STUDENTS: readonly DemoStudent[] = [
  {
    slug: 'kim-doyoon',
    name: '김도윤',
    studentId: '269101',
    department: '컴퓨터정보통신공학과',
    emailLocalPart: 'kim.doyoon',
  },
  {
    slug: 'lee-seojun',
    name: '이서준',
    studentId: '269102',
    department: '인공지능학부',
    emailLocalPart: 'lee.seojun',
  },
  {
    slug: 'park-haeun',
    name: '박하은',
    studentId: '269103',
    department: '소프트웨어공학과',
    emailLocalPart: 'park.haeun',
  },
  {
    slug: 'choi-jiho',
    name: '최지호',
    studentId: '269104',
    department: '전자컴퓨터공학부',
    emailLocalPart: 'choi.jiho',
  },
  {
    slug: 'jung-subin',
    name: '정수빈',
    studentId: '269105',
    department: '컴퓨터정보통신공학과',
    emailLocalPart: 'jung.subin',
  },
  {
    slug: 'kang-yerin',
    name: '강예린',
    studentId: '269106',
    department: '인공지능학부',
    emailLocalPart: 'kang.yerin',
  },
  {
    slug: 'yoon-jian',
    name: '윤지안',
    studentId: '269107',
    department: '소프트웨어공학과',
    emailLocalPart: 'yoon.jian',
  },
  {
    slug: 'jang-siwoo',
    name: '장시우',
    studentId: '269108',
    department: '전자컴퓨터공학부',
    emailLocalPart: 'jang.siwoo',
  },
  {
    slug: 'han-yuna',
    name: '한유나',
    studentId: '269109',
    department: '컴퓨터정보통신공학과',
    emailLocalPart: 'han.yuna',
  },
  {
    slug: 'shin-minjun',
    name: '신민준',
    studentId: '269110',
    department: '인공지능학부',
    emailLocalPart: 'shin.minjun',
  },
  {
    slug: 'oh-suah',
    name: '오수아',
    studentId: '269111',
    department: '소프트웨어공학과',
    emailLocalPart: 'oh.suah',
  },
  {
    slug: 'kwon-jaeyul',
    name: '권재율',
    studentId: '269112',
    department: '전자컴퓨터공학부',
    emailLocalPart: 'kwon.jaeyul',
  },
  {
    slug: 'song-yerim',
    name: '송예림',
    studentId: '269113',
    department: '컴퓨터정보통신공학과',
    emailLocalPart: 'song.yerim',
  },
  {
    slug: 'baek-hyunwoo',
    name: '백현우',
    studentId: '269114',
    department: '인공지능학부',
    emailLocalPart: 'baek.hyunwoo',
  },
] as const;

const DEMO_STAFF_NAME = '합성 사업단 담당자';
const DEMO_STAFF_DEPARTMENT = '오픈소스 SW 개발 사업단';

const DEMO_STAFF_CONTACT_EMAIL = 'sw-center.inquiry@demo.invalid';

async function upsertDemoStudent(
  stats: SeedStats,
  student: DemoStudent,
): Promise<{ readonly id: string }> {
  const id = seedId('demo', 'user', student.slug);
  const user = await upsertSeedUser(stats, { id, role: 'STUDENT' });
  await upsertConsent(stats, user.id);
  await upsertSeedProfile({
    userId: user.id,
    name: student.name,
    studentId: student.studentId,
    department: student.department,
    memberKind: 'STUDENT',
  });
  await prisma.user.update({
    where: { id: user.id },
    data: {
      notificationEmail: `${student.emailLocalPart}@demo.invalid`,
      notifyEnabled: true,
    },
  });
  return user;
}

async function upsertDemoStaff(
  stats: SeedStats,
  slug: string,
): Promise<{ readonly id: string }> {
  const id = seedId('demo', 'user', slug);
  const user = await upsertSeedUser(stats, { id, role: 'STAFF' });
  await upsertConsent(stats, user.id);
  await upsertSeedProfile({
    userId: user.id,
    name: DEMO_STAFF_NAME,
    studentId: null,
    department: DEMO_STAFF_DEPARTMENT,
    memberKind: 'STAFF',
  });
  await prisma.user.update({
    where: { id: user.id },
    data: {
      notificationEmail: `sw-center.${slug}@demo.invalid`,
      notifyEnabled: true,
    },
  });
  return user;
}

type DemoTeamSeed = {
  readonly teamSlug: string;
  readonly teamName: string;
  readonly leader: DemoStudent;
  readonly members: readonly DemoStudent[];
};

async function upsertDemoTeam(
  stats: SeedStats,
  programId: string,
  params: DemoTeamSeed,
  leaderUserId: string,
  memberUserIds: readonly string[],
): Promise<string> {
  const teamId = seedId('demo', 'team', params.teamSlug);
  await upsertTracked(
    stats,
    'Team',
    () => prisma.team.findUnique({ where: { id: teamId } }),
    () =>
      prisma.team.upsert({
        where: { id: teamId },
        update: {
          name: params.teamName,
          joinCodeDigest: computeJoinCodeDigest(
            `SEED-DEMO-${params.teamSlug.toUpperCase()}`,
          ),
          leaderId: leaderUserId,
        },
        create: {
          id: teamId,
          programId,
          name: params.teamName,
          joinCodeDigest: computeJoinCodeDigest(
            `SEED-DEMO-${params.teamSlug.toUpperCase()}`,
          ),
          leaderId: leaderUserId,
        },
      }),
  );

  for (const memberUserId of memberUserIds) {
    const memberId = seedId(
      'demo',
      'team-member',
      params.teamSlug,
      memberUserId,
    );
    await upsertTracked(
      stats,
      'TeamMember',
      () => prisma.teamMember.findUnique({ where: { id: memberId } }),
      () =>
        prisma.teamMember.upsert({
          where: { id: memberId },
          update: { teamId, programId, userId: memberUserId },
          create: { id: memberId, teamId, programId, userId: memberUserId },
        }),
    );
  }

  return teamId;
}

async function upsertDemoApplication(
  stats: SeedStats,
  params: {
    readonly id: string;
    readonly programId: string;
    readonly applicantId: string;
    readonly teamId: string;
    readonly title: string;
    readonly summary: string;
    readonly submittedAt: Date;
    readonly processedAt: Date;
  },
): Promise<void> {
  await upsertTracked(
    stats,
    'Application',
    () => prisma.application.findUnique({ where: { id: params.id } }),
    () =>
      prisma.application.upsert({
        where: { id: params.id },
        update: { status: ApplicationStatus.APPROVED },
        create: {
          id: params.id,
          programId: params.programId,
          applicantId: params.applicantId,
          teamId: params.teamId,
          answers: {
            seedPlaceholder: true,
            scenarioId: 'demo-application',
            title: params.title,
            summary: params.summary,
          },
          applicationTemplateVersion: 1,
          status: ApplicationStatus.APPROVED,
          submittedAt: params.submittedAt,
          processedAt: params.processedAt,
        },
      }),
  );
}

type DemoMilestoneSeed = {
  readonly id: string;
  readonly programId: string;
  readonly name: string;
  readonly startAt: Date;
  readonly dueAt: Date;
  readonly submissionType: MilestoneSubmissionType;
  readonly instructions: string;
};

async function upsertDemoMilestone(
  stats: SeedStats,
  params: DemoMilestoneSeed,
): Promise<void> {
  await upsertTracked(
    stats,
    'Milestone',
    () => prisma.milestone.findUnique({ where: { id: params.id } }),
    () =>
      prisma.milestone.upsert({
        where: { id: params.id },
        update: {
          name: params.name,
          startAt: params.startAt,
          dueAt: params.dueAt,
          submissionType: params.submissionType,
          instructions: params.instructions,
        },
        create: {
          id: params.id,
          programId: params.programId,
          name: params.name,
          startAt: params.startAt,
          dueAt: params.dueAt,
          submissionType: params.submissionType,
          instructions: params.instructions,
        },
      }),
  );
}

type DemoSubmissionContent =
  | {
      readonly kind: typeof MilestoneSubmissionType.TEXT;
      readonly text: string;
    }
  | {
      readonly kind: typeof MilestoneSubmissionType.FILE;

      readonly comment: string;
      readonly originalFileName: string;
      readonly mimeType: string;
    };

type DemoReview = {
  readonly decision:
    typeof ReviewDecision.APPROVED | typeof ReviewDecision.CHANGES_REQUESTED;
  readonly comment: string;
  readonly reviewedAt: Date;
};

async function upsertDemoSubmission(
  stats: SeedStats,
  storage: ObjectStoragePort,
  params: {
    readonly slug: string;
    readonly milestoneId: string;
    readonly applicationId: string;
    readonly submittedById: string;
    readonly submittedAt: Date;
    readonly status: SubmissionStatus;
    readonly content: DemoSubmissionContent;
    readonly review?: DemoReview;
    readonly reviewerId?: string;
  },
): Promise<void> {
  const documentId = seedId('demo', 'milestone-document', params.milestoneId);
  await upsertTracked(
    stats,
    'MilestoneDocument',
    () => prisma.milestoneDocument.findUnique({ where: { id: documentId } }),
    () =>
      prisma.milestoneDocument.upsert({
        where: { id: documentId },
        update: {},
        create: {
          id: documentId,
          milestoneId: params.milestoneId,
          name: '내부 제출 자료',
          required: true,
          sortOrder: -1,
          kind: MilestoneDocumentKind.LEGACY_MILESTONE_SUBMISSION,
        },
      }),
  );
  const submissionId = seedId(
    'demo',
    'milestone-document-submission',
    params.slug,
  );
  const fileId = seedId('demo', 'submission-file', params.slug);
  const content =
    params.content.kind === MilestoneSubmissionType.TEXT
      ? { type: MilestoneSubmissionType.TEXT, text: params.content.text }
      : { type: MilestoneSubmissionType.FILE, fileId };
  await upsertTracked(
    stats,
    'MilestoneDocumentSubmission',
    () =>
      prisma.milestoneDocumentSubmission.findUnique({
        where: { id: submissionId },
      }),
    () =>
      prisma.milestoneDocumentSubmission.upsert({
        where: { id: submissionId },
        update: {
          status: params.status,
          content,
          revision: 1,
          submittedById: params.submittedById,
          submittedAt: params.submittedAt,
        },
        create: {
          id: submissionId,
          milestoneDocumentId: documentId,
          applicationId: params.applicationId,
          status: params.status,
          revision: 1,
          content,
          submittedById: params.submittedById,
          submittedAt: params.submittedAt,
        },
      }),
  );
  const submissionHistoryId = seedId(
    'demo',
    'milestone-document-submission',
    params.slug,
    'history-1',
  );
  await upsertTracked(
    stats,
    'MilestoneDocumentSubmissionHistory',
    () =>
      prisma.milestoneDocumentSubmissionHistory.findUnique({
        where: { id: submissionHistoryId },
      }),
    () =>
      prisma.milestoneDocumentSubmissionHistory.upsert({
        where: { id: submissionHistoryId },
        update: {
          content,
          comment:
            params.content.kind === MilestoneSubmissionType.FILE
              ? params.content.comment
              : null,
          actorId: params.submittedById,
          createdAt: params.submittedAt,
        },
        create: {
          id: submissionHistoryId,
          milestoneDocumentSubmissionId: submissionId,
          event: MilestoneDocumentSubmissionHistoryEvent.SUBMITTED,
          revision: 1,
          content,
          comment:
            params.content.kind === MilestoneSubmissionType.FILE
              ? params.content.comment
              : null,
          actorId: params.submittedById,
          createdAt: params.submittedAt,
        },
      }),
  );

  const fileContent = params.content;
  if (fileContent.kind === MilestoneSubmissionType.FILE) {
    const storageKey = demoSubmissionFileStorageKey(fileId);

    const storedFile = await storage.put({
      objectKey: storageKey,
      originalName: fileContent.originalFileName,
      contentType: fileContent.mimeType,
      body: demoSubmissionFilePlaceholderBody(fileContent.originalFileName),
    });
    await upsertTracked(
      stats,
      'SubmissionFile',
      () => prisma.submissionFile.findUnique({ where: { id: fileId } }),
      () =>
        prisma.submissionFile.upsert({
          where: { id: fileId },
          update: {
            storageKey,
            sizeBytes: storedFile.contentLength,
            lifecycle: SubmissionFileLifecycle.ATTACHED,
            milestoneDocumentSubmissionId: submissionId,
            milestoneDocumentSubmissionHistoryId: submissionHistoryId,
          },
          create: {
            id: fileId,
            uploaderId: params.submittedById,
            applicationId: params.applicationId,
            milestoneId: params.milestoneId,
            milestoneDocumentSubmissionId: submissionId,
            milestoneDocumentSubmissionHistoryId: submissionHistoryId,
            storageKey,
            originalFileName: fileContent.originalFileName,
            mimeType: fileContent.mimeType,
            sizeBytes: storedFile.contentLength,
            lifecycle: SubmissionFileLifecycle.ATTACHED,
            expiresAt: offsetDays(365),
          },
        }),
    );
  }

  if (params.review && params.reviewerId) {
    const review = params.review;
    const reviewHistoryEventId = seedId(
      'demo',
      'milestone-document-submission',
      params.slug,
      'review-event',
    );
    const reviewEvent =
      review.decision === ReviewDecision.APPROVED
        ? MilestoneDocumentSubmissionHistoryEvent.APPROVED
        : MilestoneDocumentSubmissionHistoryEvent.CHANGES_REQUESTED;
    await upsertTracked(
      stats,
      'MilestoneDocumentSubmissionHistory',
      () =>
        prisma.milestoneDocumentSubmissionHistory.findUnique({
          where: { id: reviewHistoryEventId },
        }),
      () =>
        prisma.milestoneDocumentSubmissionHistory.upsert({
          where: { id: reviewHistoryEventId },
          update: {
            event: reviewEvent,
            comment: review.comment,
            actorId: params.reviewerId!,
            createdAt: review.reviewedAt,
          },
          create: {
            id: reviewHistoryEventId,
            milestoneDocumentSubmissionId: submissionId,
            event: reviewEvent,
            revision: 1,
            comment: review.comment,
            actorId: params.reviewerId!,
            createdAt: review.reviewedAt,
          },
        }),
    );
    const reviewId = seedId(
      'demo',
      'milestone-document-submission',
      params.slug,
      'review',
    );
    await upsertTracked(
      stats,
      'MilestoneDocumentReviewHistory',
      () =>
        prisma.milestoneDocumentReviewHistory.findUnique({
          where: { id: reviewId },
        }),
      () =>
        prisma.milestoneDocumentReviewHistory.upsert({
          where: { id: reviewId },
          update: {
            decision: review.decision,
            comment: review.comment,
            reviewedAt: review.reviewedAt,
          },
          create: {
            id: reviewId,
            milestoneDocumentSubmissionId: submissionId,
            submissionHistoryId,
            reviewerId: params.reviewerId!,
            decision: review.decision,
            comment: review.comment,
            reviewedAt: review.reviewedAt,
          },
        }),
    );
  }
}

async function upsertDemoBoardPost(
  stats: SeedStats,
  params: {
    readonly id: string;
    readonly programId: string;
    readonly category: BoardPostCategory;
    readonly title: string;
    readonly body: string;
    readonly authorId: string;
    readonly pinned: boolean;
    readonly createdAt: Date;
  },
): Promise<void> {
  await upsertTracked(
    stats,
    'BoardPost',
    () => prisma.boardPost.findUnique({ where: { id: params.id } }),
    () =>
      prisma.boardPost.upsert({
        where: { id: params.id },
        update: {
          title: params.title,
          body: params.body,
          pinned: params.pinned,
        },
        create: {
          id: params.id,
          programId: params.programId,
          category: params.category,
          title: params.title,
          body: params.body,
          authorId: params.authorId,
          pinned: params.pinned,
          createdAt: params.createdAt,
        },
      }),
  );
}

async function upsertDemoBoardComment(
  stats: SeedStats,
  params: {
    readonly id: string;
    readonly postId: string;
    readonly authorId: string;
    readonly body: string;
    readonly createdAt: Date;
  },
): Promise<void> {
  await upsertTracked(
    stats,
    'BoardComment',
    () => prisma.boardComment.findUnique({ where: { id: params.id } }),
    () =>
      prisma.boardComment.upsert({
        where: { id: params.id },
        update: { body: params.body },
        create: {
          id: params.id,
          postId: params.postId,
          authorId: params.authorId,
          body: params.body,
          createdAt: params.createdAt,
        },
      }),
  );
}

async function upsertDemoProgram(
  stats: SeedStats,
  params: {
    readonly id: string;
    readonly name: string;
    readonly organizer: string;
    readonly category: ProgramCategory;
    readonly description: string;
    readonly applicationStartAt: Date;
    readonly applicationEndAt: Date;
    readonly startAt: Date;
    readonly endAt: Date;
    readonly teamMinSize: number;
    readonly teamMaxSize: number;
  },
): Promise<void> {
  await upsertTracked(
    stats,
    'Program',
    () => prisma.program.findUnique({ where: { id: params.id } }),
    () =>
      prisma.program.upsert({
        where: { id: params.id },
        update: {
          name: params.name,
          organizer: params.organizer,
          category: params.category,
          description: params.description,
          applicationStartAt: params.applicationStartAt,
          applicationEndAt: params.applicationEndAt,
          startAt: params.startAt,
          endAt: params.endAt,
          teamMinSize: params.teamMinSize,
          teamMaxSize: params.teamMaxSize,
        },
        create: {
          id: params.id,
          name: params.name,
          organizer: params.organizer,
          category: params.category,
          applicationTemplateKey: params.category.toLowerCase(),
          applicationTemplateVersion: 1,
          applicationStartAt: params.applicationStartAt,
          applicationEndAt: params.applicationEndAt,
          startAt: params.startAt,
          endAt: params.endAt,
          teamMinSize: params.teamMinSize,
          teamMaxSize: params.teamMaxSize,
          description: params.description,

          repositoryProvisioningEnabled: false,
        },
      }),
  );
}

function inquiryParagraph(): string {
  return (
    `문의 안내: 프로그램 운영·일정 관련 문의는 담당자 이메일(${DEMO_STAFF_CONTACT_EMAIL}, 시연용 ` +
    '합성 주소)로 접수해 주세요. 답변은 접수 순서대로 영업일 기준 2일 이내 드립니다 (seed fixture).'
  );
}

export async function seedDemo(
  stats: SeedStats,
  storage: ObjectStoragePort,
): Promise<void> {
  const staff = await upsertDemoStaff(stats, 'staff-lead');

  const students = new Map<string, { readonly id: string }>();
  for (const student of DEMO_STUDENTS) {
    students.set(student.slug, await upsertDemoStudent(stats, student));
  }
  const studentBySlug = (slug: DemoStudent['slug']): DemoStudent =>
    DEMO_STUDENTS.find((student) => student.slug === slug)!;
  const studentId = (slug: DemoStudent['slug']): string =>
    students.get(slug)!.id;

  const internshipProgramId = seedId('demo', 'program', 'summer-internship');
  await upsertDemoProgram(stats, {
    id: internshipProgramId,
    name: '2026 하계 SW 현장실습 연계 프로그램',
    organizer: '오픈소스 SW 개발 사업단',
    category: ProgramCategory.CORPORATE_INTERNSHIP,
    description:
      '모집 배경: 오픈소스 SW 개발 사업단은 참여 기업과 연계한 하계 현장실습 프로그램을 ' +
      '운영하여 재학생이 실무 환경에서 실제 과제를 수행하고 그 결과를 정리·발표하는 경험을 ' +
      '지원합니다. ' +
      '지원 대상: 본교 SW 관련 학과 재학생 중 참여 기업의 실습 배정을 받은 학생(개인 또는 ' +
      '최대 2인 팀). ' +
      '운영 방식: 실습 기간 중 사업단 플랫폼을 통해 중간 실습 일지를 제출하고, 사업단 담당자가 ' +
      '제출 현황을 확인·안내합니다. ' +
      `${inquiryParagraph()} ` +
      '모든 일정·기업명·참가자는 시연용 합성 데이터이며 실제 실습 공고와 무관합니다.',
    applicationStartAt: offsetDays(-70),
    applicationEndAt: offsetDays(-56),
    startAt: offsetDays(-49),
    endAt: offsetDays(21),
    teamMinSize: 1,
    teamMaxSize: 2,
  });
  const internshipTeamId = await upsertDemoTeam(
    stats,
    internshipProgramId,
    {
      teamSlug: 'summer-internship-alpha',
      teamName: '현장실습 A팀',
      leader: DEMO_STUDENTS[0]!,
      members: [DEMO_STUDENTS[1]!],
    },
    studentId('kim-doyoon'),
    [studentId('kim-doyoon'), studentId('lee-seojun')],
  );
  const internshipApplicationId = seedId(
    'demo',
    'application',
    'summer-internship-alpha',
  );
  await upsertDemoApplication(stats, {
    id: internshipApplicationId,
    programId: internshipProgramId,
    applicantId: studentId('kim-doyoon'),
    teamId: internshipTeamId,
    title: '사내 대시보드 리팩터링 실습',
    summary:
      '참여 기업 사내 데이터 대시보드의 조회 성능 개선 실습 과제(합성 fixture).',
    submittedAt: offsetDays(-58),
    processedAt: offsetDays(-55),
  });
  const internshipMilestoneId = seedId(
    'demo',
    'milestone',
    'summer-internship-midpoint',
  );
  await upsertDemoMilestone(stats, {
    id: internshipMilestoneId,
    programId: internshipProgramId,
    name: '[필수] 중간 실습 일지 제출',
    startAt: offsetDays(-49),
    dueAt: offsetDays(7),
    submissionType: MilestoneSubmissionType.TEXT,
    instructions:
      '운영 방식: 실습 4주 차까지의 진행 상황과 배운 점을 A4 1장 내외의 자유 양식으로 ' +
      '정리해 제출합니다. 제출 후 사업단 담당자가 확인 코멘트를 남길 수 있습니다 (seed fixture).',
  });
  await upsertDemoSubmission(stats, storage, {
    slug: 'summer-internship-midpoint',
    milestoneId: internshipMilestoneId,
    applicationId: internshipApplicationId,
    submittedById: studentId('kim-doyoon'),
    status: SubmissionStatus.SUBMITTED,
    content: {
      kind: MilestoneSubmissionType.TEXT,
      text: '대시보드 쿼리 튜닝 작업을 진행 중이며, 다음 주까지 인덱스 개선안을 정리하겠습니다 (seed fixture).',
    },
    submittedAt: offsetDays(-1),
  });
  const internshipPostId = seedId('demo', 'board-post', 'summer-internship-1');
  await upsertDemoBoardPost(stats, {
    id: internshipPostId,
    programId: internshipProgramId,
    category: BoardPostCategory.NOTICE,
    title: '[공지] 중간 실습 일지 제출 안내',
    body:
      '중간 실습 일지는 아래 마일스톤 탭에서 제출해 주세요. 제출 기한은 마일스톤 화면에서 ' +
      `확인할 수 있습니다. 그 외 문의는 댓글 또는 ${DEMO_STAFF_CONTACT_EMAIL}로 남겨주시면 됩니다 (seed fixture).`,
    authorId: staff.id,
    pinned: true,
    createdAt: offsetDays(-10),
  });
  await upsertDemoBoardComment(stats, {
    id: seedId('demo', 'board-comment', 'summer-internship-1a'),
    postId: internshipPostId,
    authorId: studentId('lee-seojun'),
    body: '제출 형식이 정해져 있나요? 자유 양식으로 작성해도 될까요 (seed fixture)?',
    createdAt: offsetDays(-9),
  });
  await upsertDemoBoardComment(stats, {
    id: seedId('demo', 'board-comment', 'summer-internship-1b'),
    postId: internshipPostId,
    authorId: staff.id,
    body: '네, 자유 양식이며 A4 1장 내외를 권장합니다 (seed fixture).',
    createdAt: offsetDays(-8),
  });

  const contestProgramId = seedId('demo', 'program', 'oss-developer-contest');
  await upsertDemoProgram(stats, {
    id: contestProgramId,
    name: '2026 오픈소스 SW개발자 대회 (에코노베이션 연계)',
    organizer: '오픈소스 SW 개발 사업단',
    category: ProgramCategory.OSS_CONTEST,
    description:
      '모집 배경: 오픈소스 SW 개발 사업단은 교내 오픈소스 개발자 대회를 통해 학생들이 ' +
      '실제 저장소를 공개 운영하며 기획부터 배포까지 전 과정을 경험하도록 지원합니다. ' +
      '에코노베이션과 연계해 우수 팀에게는 후속 활동 참가 기회가 주어집니다. ' +
      '지원 대상: 본교 재학생 2~4인으로 구성된 팀(개인 지원 불가). 참가 신청 시 팀 대표가 ' +
      '팀원 명단과 함께 신청합니다. ' +
      '운영 방식: 팀 구성 확정 후 팀별 저장소를 공개하고, 중간 데모데이·최종 발표 두 차례 ' +
      '마일스톤 제출로 진행 상황을 점검합니다. 제출물은 사업단 담당자가 검토해 승인 또는 ' +
      '보완 요청으로 안내합니다. ' +
      `${inquiryParagraph()} ` +
      '에코노베이션 공개 저장소의 실제 수집·랭킹 데이터는 이 시드가 아니라 별도의 ADMIN ' +
      '수집 경로로만 등록됩니다. 모든 일정·팀명·참가자는 시연용 합성 데이터입니다.',
    applicationStartAt: offsetDays(-40),
    applicationEndAt: offsetDays(-30),
    startAt: offsetDays(-28),
    endAt: offsetDays(35),
    teamMinSize: 2,
    teamMaxSize: 4,
  });

  type ContestTeamSeed = {
    readonly teamSlug: string;
    readonly teamName: string;
    readonly leaderSlug: DemoStudent['slug'];
    readonly memberSlugs: readonly DemoStudent['slug'][];
    readonly title: string;
    readonly summary: string;
    readonly submittedAt: Date;
    readonly processedAt: Date;

    readonly demoDaySubmissionSlug?: string;

    readonly demoDayOriginalFileName?: string;

    readonly demoDaySubmission: {
      readonly status: SubmissionStatus;
      readonly comment: string;
      readonly review?: DemoReview;
    };

    readonly finalSubmission?: {
      readonly status: SubmissionStatus;
      readonly text: string;
      readonly review?: DemoReview;
    };
  };

  const CONTEST_TEAMS: readonly ContestTeamSeed[] = [
    {
      teamSlug: 'oss-contest-hanbit',
      teamName: '한빛 팀',
      leaderSlug: 'park-haeun',
      memberSlugs: ['choi-jiho', 'jung-subin'],
      title: '교내 학사 알림 오픈소스 서비스',
      summary:
        '학사 일정 알림을 구독형으로 제공하는 오픈소스 프로젝트(합성 fixture).',
      submittedAt: offsetDays(-32),
      processedAt: offsetDays(-29),

      demoDaySubmissionSlug: 'oss-contest-demo-day',
      demoDayOriginalFileName: 'oss-contest-demo-day-draft.pdf',
      demoDaySubmission: {
        status: SubmissionStatus.APPROVED,
        comment:
          '구독 알림 발송 기능까지 구현했고, 최종본 발표자료는 이번 주말까지 마무리하겠습니다 (seed fixture).',
        review: {
          decision: ReviewDecision.APPROVED,
          comment:
            '구현 범위가 명확하고 진행 속도도 양호합니다. 승인합니다 (seed fixture).',
          reviewedAt: offsetDays(-1),
        },
      },
      finalSubmission: {
        status: SubmissionStatus.SUBMITTED,
        text: '알림 구독·발송 기능 구현을 마쳤고, 최종 발표자료 초안을 정리 중입니다 (seed fixture).',
      },
    },
    {
      teamSlug: 'oss-contest-byeoldam',
      teamName: '별담 팀',
      leaderSlug: 'yoon-jian',
      memberSlugs: ['jang-siwoo', 'han-yuna'],
      title: '동아리 회비 정산 오픈소스 도구',
      summary: '동아리 회비 내역을 투명하게 공유하는 정산 도구(합성 fixture).',
      submittedAt: offsetDays(-33),
      processedAt: offsetDays(-28),
      demoDaySubmission: {
        status: SubmissionStatus.CHANGES_REQUESTED,
        comment:
          '정산 내역 CSV 내보내기 기능까지 구현했으나 발표자료는 아직 초안 단계입니다 (seed fixture).',
        review: {
          decision: ReviewDecision.CHANGES_REQUESTED,
          comment:
            '발표자료에 핵심 기능 데모 화면이 빠져 있습니다. 캡처를 추가해 다시 제출해 주세요 (seed fixture).',
          reviewedAt: offsetDays(-2),
        },
      },
    },
    {
      teamSlug: 'oss-contest-neobit',
      teamName: '너비트 팀',
      leaderSlug: 'shin-minjun',
      memberSlugs: ['oh-suah'],
      title: '강의실 좌석 예약 오픈소스 서비스',
      summary: '실시간 강의실 좌석 현황을 공유하는 예약 서비스(합성 fixture).',
      submittedAt: offsetDays(-31),
      processedAt: offsetDays(-27),
      demoDaySubmission: {
        status: SubmissionStatus.SUBMITTED,
        comment:
          '좌석 현황 실시간 갱신 기능을 구현했고, 발표자료는 이번 주 안에 제출 예정입니다 (seed fixture).',
      },
    },
    {
      teamSlug: 'oss-contest-jomyeong',
      teamName: '조명 팀',
      leaderSlug: 'kwon-jaeyul',
      memberSlugs: ['song-yerim', 'baek-hyunwoo', 'kang-yerin'],
      title: '캠퍼스 분실물 공유 게시판',
      summary: '분실물 등록·검색을 지원하는 오픈소스 게시판(합성 fixture).',
      submittedAt: offsetDays(-34),
      processedAt: offsetDays(-26),
      demoDaySubmission: {
        status: SubmissionStatus.APPROVED,
        comment:
          '분실물 등록·검색·알림 기능을 모두 구현하고 발표자료도 완성했습니다 (seed fixture).',
        review: {
          decision: ReviewDecision.APPROVED,
          comment:
            '기능 완성도가 높고 발표자료도 충실합니다. 승인합니다 (seed fixture).',
          reviewedAt: offsetDays(-3),
        },
      },
      finalSubmission: {
        status: SubmissionStatus.CHANGES_REQUESTED,
        text: '최종 발표자료 초안을 제출했습니다. 시연 영상 링크는 추후 추가하겠습니다 (seed fixture).',
        review: {
          decision: ReviewDecision.CHANGES_REQUESTED,
          comment:
            '시연 영상 링크가 비어 있습니다. 추가 후 다시 제출해 주세요 (seed fixture).',
          reviewedAt: offsetDays(-1),
        },
      },
    },
    {
      teamSlug: 'oss-contest-suol',
      teamName: '수올 팀',
      leaderSlug: 'kim-doyoon',
      memberSlugs: ['lee-seojun'],
      title: '오픈소스 스터디 매칭 플랫폼',
      summary: '관심 기술 스택 기반 스터디 매칭 플랫폼(합성 fixture).',
      submittedAt: offsetDays(-30),
      processedAt: offsetDays(-25),
      demoDaySubmission: {
        status: SubmissionStatus.CHANGES_REQUESTED,
        comment:
          '매칭 알고리즘 초안은 구현했으나 발표자료 작성이 지연되고 있습니다 (seed fixture).',
        review: {
          decision: ReviewDecision.CHANGES_REQUESTED,
          comment:
            '발표자료가 아직 제출되지 않았습니다. 데모데이 전까지 보완 제출 부탁드립니다 (seed fixture).',
          reviewedAt: offsetDays(-2),
        },
      },
    },
  ];

  const contestMilestoneId = seedId(
    'demo',
    'milestone',
    'oss-contest-demo-day',
  );
  await upsertDemoMilestone(stats, {
    id: contestMilestoneId,
    programId: contestProgramId,
    name: '[필수] 중간 데모데이 발표자료 제출',
    startAt: offsetDays(-28),
    dueAt: offsetDays(10),
    submissionType: MilestoneSubmissionType.FILE,
    instructions:
      '운영 방식: 중간 점검용 발표자료(PDF)와 데모 링크를 함께 제출합니다. 사업단 담당자가 ' +
      '검토 후 승인 또는 보완 요청으로 결과를 안내합니다 (seed fixture).',
  });
  const contestFinalMilestoneId = seedId(
    'demo',
    'milestone',
    'oss-contest-final',
  );
  await upsertDemoMilestone(stats, {
    id: contestFinalMilestoneId,
    programId: contestProgramId,
    name: '[필수] 최종 발표 및 시연',
    startAt: offsetDays(5),
    dueAt: offsetDays(34),
    submissionType: MilestoneSubmissionType.TEXT,
    instructions:
      '운영 방식: 최종 산출물 요약과 시연 영상(또는 링크)을 정리해 제출합니다. 발표는 대회 ' +
      '종료 주간에 별도 공지된 일정으로 진행합니다 (seed fixture).',
  });

  for (const team of CONTEST_TEAMS) {
    const leaderUserId = studentId(team.leaderSlug);
    const memberUserIds = team.memberSlugs.map((slug) => studentId(slug));
    const teamId = await upsertDemoTeam(
      stats,
      contestProgramId,
      {
        teamSlug: team.teamSlug,
        teamName: team.teamName,
        leader: studentBySlug(team.leaderSlug),
        members: team.memberSlugs.map((slug) => studentBySlug(slug)),
      },
      leaderUserId,
      [leaderUserId, ...memberUserIds],
    );
    const applicationId = seedId('demo', 'application', team.teamSlug);
    await upsertDemoApplication(stats, {
      id: applicationId,
      programId: contestProgramId,
      applicantId: leaderUserId,
      teamId,
      title: team.title,
      summary: team.summary,
      submittedAt: team.submittedAt,
      processedAt: team.processedAt,
    });

    const demoDaySubmissionSlug =
      team.demoDaySubmissionSlug ?? `${team.teamSlug}-demo-day`;
    const demoDayOriginalFileName =
      team.demoDayOriginalFileName ?? `${team.teamSlug}-demo-day-draft.pdf`;
    await upsertDemoSubmission(stats, storage, {
      slug: demoDaySubmissionSlug,
      milestoneId: contestMilestoneId,
      applicationId,
      submittedById: leaderUserId,
      status: team.demoDaySubmission.status,
      content: {
        kind: MilestoneSubmissionType.FILE,
        comment: team.demoDaySubmission.comment,
        originalFileName: demoDayOriginalFileName,
        mimeType: 'application/pdf',
      },
      submittedAt: offsetDays(-2),
      review: team.demoDaySubmission.review,
      reviewerId: team.demoDaySubmission.review ? staff.id : undefined,
    });

    if (team.finalSubmission) {
      await upsertDemoSubmission(stats, storage, {
        slug: `${team.teamSlug}-final`,
        milestoneId: contestFinalMilestoneId,
        applicationId,
        submittedById: leaderUserId,
        status: team.finalSubmission.status,
        content: {
          kind: MilestoneSubmissionType.TEXT,
          text: team.finalSubmission.text,
        },
        submittedAt: offsetDays(-1),
        review: team.finalSubmission.review,
        reviewerId: team.finalSubmission.review ? staff.id : undefined,
      });
    }
  }

  const contestPostId = seedId('demo', 'board-post', 'oss-contest-1');
  await upsertDemoBoardPost(stats, {
    id: contestPostId,
    programId: contestProgramId,
    category: BoardPostCategory.QNA,
    title: '팀 저장소는 언제부터 공개해야 하나요?',
    body: '오픈소스 대회 취지상 저장소를 대회 시작과 동시에 공개해야 하는지 궁금합니다 (seed fixture).',
    authorId: studentId('choi-jiho'),
    pinned: false,
    createdAt: offsetDays(-20),
  });
  await upsertDemoBoardComment(stats, {
    id: seedId('demo', 'board-comment', 'oss-contest-1a'),
    postId: contestPostId,
    authorId: staff.id,
    body: '데모데이 전까지는 비공개로 진행하셔도 되고, 최종 제출 시점에는 공개 저장소여야 합니다 (seed fixture).',
    createdAt: offsetDays(-19),
  });
  const contestPost2Id = seedId('demo', 'board-post', 'oss-contest-2');
  await upsertDemoBoardPost(stats, {
    id: contestPost2Id,
    programId: contestProgramId,
    category: BoardPostCategory.NOTICE,
    title: '[공지] 중간 데모데이 리뷰 결과 안내',
    body:
      '팀별 중간 데모데이 제출물 검토를 완료했습니다. 보완 요청을 받은 팀은 마일스톤 탭에서 ' +
      `재제출해 주세요. 문의는 ${DEMO_STAFF_CONTACT_EMAIL}로 부탁드립니다 (seed fixture).`,
    authorId: staff.id,
    pinned: true,
    createdAt: offsetDays(-1),
  });

  const freshmenProgramId = seedId('demo', 'program', 'freshmen-sw-bootcamp');
  await upsertDemoProgram(stats, {
    id: freshmenProgramId,
    name: '2026 신입생 SW역량 강화 캠프',
    organizer: '오픈소스 SW 개발 사업단',
    category: ProgramCategory.SW_VALUE_SPREAD,
    description:
      '모집 배경: 오픈소스 SW 개발 사업단은 신입생이 입학 초기부터 협업 기반 프로젝트 ' +
      '경험을 쌓을 수 있도록 기초 프로그래밍·협업 역량 강화 캠프를 운영합니다. ' +
      '지원 대상: 본교 신입생(1학년) 중 3~5인으로 구성된 팀. ' +
      '운영 방식: 팀별 멘토 배정 후 체크포인트 마일스톤으로 기획안·진행 상황을 점검하며, ' +
      '캠프 종료 시 팀별 발표회를 진행합니다. ' +
      `${inquiryParagraph()} ` +
      '모든 일정·팀명·참가자는 시연용 합성 데이터이며 실제 캠프 공고와 무관합니다.',
    applicationStartAt: offsetDays(-25),
    applicationEndAt: offsetDays(-18),
    startAt: offsetDays(-14),
    endAt: offsetDays(28),
    teamMinSize: 3,
    teamMaxSize: 5,
  });
  const freshmenTeamId = await upsertDemoTeam(
    stats,
    freshmenProgramId,
    {
      teamSlug: 'freshmen-bootcamp-nabi',
      teamName: '나비 팀',
      leader: DEMO_STUDENTS[5]!,
      members: [DEMO_STUDENTS[0]!, DEMO_STUDENTS[3]!],
    },
    studentId('kang-yerin'),
    [studentId('kang-yerin'), studentId('kim-doyoon'), studentId('choi-jiho')],
  );
  const freshmenApplicationId = seedId(
    'demo',
    'application',
    'freshmen-bootcamp-nabi',
  );
  await upsertDemoApplication(stats, {
    id: freshmenApplicationId,
    programId: freshmenProgramId,
    applicantId: studentId('kang-yerin'),
    teamId: freshmenTeamId,
    title: '신입생 팀 프로젝트 - 캠퍼스 맛집 지도',
    summary:
      '학교 주변 식당 정보를 공유하는 웹 서비스 미니 프로젝트(합성 fixture).',
    submittedAt: offsetDays(-19),
    processedAt: offsetDays(-16),
  });
  const freshmenMilestoneId = seedId(
    'demo',
    'milestone',
    'freshmen-bootcamp-checkpoint',
  );
  await upsertDemoMilestone(stats, {
    id: freshmenMilestoneId,
    programId: freshmenProgramId,
    name: '[필수] 1차 체크포인트 - 기획안 제출',
    startAt: offsetDays(-14),
    dueAt: offsetDays(3),
    submissionType: MilestoneSubmissionType.TEXT,
    instructions:
      '운영 방식: 팀 프로젝트 기획안과 역할 분담을 간단히 정리해 제출합니다. 담당 멘토가 ' +
      '확인 후 다음 단계 진행 여부를 안내합니다 (seed fixture).',
  });
  await upsertDemoSubmission(stats, storage, {
    slug: 'freshmen-bootcamp-checkpoint',
    milestoneId: freshmenMilestoneId,
    applicationId: freshmenApplicationId,
    submittedById: studentId('kang-yerin'),
    status: SubmissionStatus.SUBMITTED,
    content: {
      kind: MilestoneSubmissionType.TEXT,
      text: '와이어프레임까지 완성했고, 이번 주 안에 백엔드 API 설계를 마무리할 예정입니다 (seed fixture).',
    },
    submittedAt: offsetDays(-1),
  });
  const freshmenPostId = seedId('demo', 'board-post', 'freshmen-bootcamp-1');
  await upsertDemoBoardPost(stats, {
    id: freshmenPostId,
    programId: freshmenProgramId,
    category: BoardPostCategory.NOTICE,
    title: '[공지] 팀별 멘토 배정 안내',
    body: '팀별 멘토가 배정되었습니다. 개별 안내 메일을 확인해 주세요 (seed fixture).',
    authorId: staff.id,
    pinned: true,
    createdAt: offsetDays(-12),
  });
  await upsertDemoBoardComment(stats, {
    id: seedId('demo', 'board-comment', 'freshmen-bootcamp-1a'),
    postId: freshmenPostId,
    authorId: studentId('kim-doyoon'),
    body: '멘토링 시간은 별도로 조율하나요 (seed fixture)?',
    createdAt: offsetDays(-11),
  });

  const mileageProgramId = seedId('demo', 'program', 'sojoong-mileage');
  await upsertDemoProgram(stats, {
    id: mileageProgramId,
    name: '2026 소중마일리지 연계 오픈소스 비교과',
    organizer: '오픈소스 SW 개발 사업단',
    category: ProgramCategory.BASIC,
    description:
      '모집 배경: 오픈소스 SW 개발 사업단은 소중마일리지와 연계해 교내 오픈소스 저장소 ' +
      '기여 활동(이슈 트리아지·문서화·코드 기여 등)에 마일리지를 부여하는 비교과 프로그램을 ' +
      '운영합니다. ' +
      '지원 대상: 본교 재학생 개인 신청(팀 구성 없음). ' +
      '운영 방식: 매월 말 기준으로 활동 기록을 제출하면 사업단 담당자가 확인 후 익월 초 ' +
      '소중마일리지 시스템에 반영합니다. ' +
      `${inquiryParagraph()} ` +
      '모든 일정·참가자는 시연용 합성 데이터이며 실제 소중마일리지 공고와 무관합니다.',
    applicationStartAt: offsetDays(-56),
    applicationEndAt: offsetDays(-42),
    startAt: offsetDays(-35),
    endAt: offsetDays(14),
    teamMinSize: 1,
    teamMaxSize: 1,
  });
  const mileageTeamId = await upsertDemoTeam(
    stats,
    mileageProgramId,
    {
      teamSlug: 'sojoong-mileage-solo-jungsubin',
      teamName: '정수빈 개인',
      leader: DEMO_STUDENTS[4]!,
      members: [],
    },
    studentId('jung-subin'),
    [studentId('jung-subin')],
  );
  const mileageApplicationId = seedId(
    'demo',
    'application',
    'sojoong-mileage-jungsubin',
  );
  await upsertDemoApplication(stats, {
    id: mileageApplicationId,
    programId: mileageProgramId,
    applicantId: studentId('jung-subin'),
    teamId: mileageTeamId,
    title: '오픈소스 이슈 트리아지 활동',
    summary:
      '교내 오픈소스 저장소 이슈 트리아지·문서화 기여 활동(합성 fixture).',
    submittedAt: offsetDays(-44),
    processedAt: offsetDays(-41),
  });
  const mileageMilestoneId = seedId(
    'demo',
    'milestone',
    'sojoong-mileage-activity-log',
  );
  await upsertDemoMilestone(stats, {
    id: mileageMilestoneId,
    programId: mileageProgramId,
    name: '[필수] 월간 활동 기록 제출',
    startAt: offsetDays(-35),
    dueAt: offsetDays(2),
    submissionType: MilestoneSubmissionType.TEXT,
    instructions:
      '운영 방식: 이번 달 기여 활동 내역과 소요 시간을 정리해 제출합니다. 승인된 활동 기록만 ' +
      '마일리지 반영 대상입니다 (seed fixture).',
  });
  await upsertDemoSubmission(stats, storage, {
    slug: 'sojoong-mileage-activity-log',
    milestoneId: mileageMilestoneId,
    applicationId: mileageApplicationId,
    submittedById: studentId('jung-subin'),
    status: SubmissionStatus.APPROVED,
    content: {
      kind: MilestoneSubmissionType.TEXT,
      text: '이슈 12건을 트리아지했고, 문서 오탈자 수정 PR 3건을 올렸습니다 (seed fixture).',
    },
    submittedAt: offsetDays(-1),
    review: {
      decision: ReviewDecision.APPROVED,
      comment:
        '활동 내역이 충실합니다. 이번 달 마일리지 반영 대상으로 승인합니다 (seed fixture).',
      reviewedAt: offsetDays(0),
    },
    reviewerId: staff.id,
  });
  const mileagePostId = seedId('demo', 'board-post', 'sojoong-mileage-1');
  await upsertDemoBoardPost(stats, {
    id: mileagePostId,
    programId: mileageProgramId,
    category: BoardPostCategory.NOTICE,
    title: '[공지] 마일리지 반영 일정 안내',
    body: '매월 말 활동 기록을 기준으로 익월 초 소중마일리지에 반영됩니다 (seed fixture).',
    authorId: staff.id,
    pinned: true,
    createdAt: offsetDays(-30),
  });
  await upsertDemoBoardComment(stats, {
    id: seedId('demo', 'board-comment', 'sojoong-mileage-1a'),
    postId: mileagePostId,
    authorId: studentId('jung-subin'),
    body: '반영 여부는 어디서 확인할 수 있나요 (seed fixture)?',
    createdAt: offsetDays(-29),
  });
  await upsertDemoBoardComment(stats, {
    id: seedId('demo', 'board-comment', 'sojoong-mileage-1b'),
    postId: mileagePostId,
    authorId: staff.id,
    body: '소중마일리지 시스템 마이페이지에서 확인 가능합니다 (seed fixture).',
    createdAt: offsetDays(-28),
  });
}

export async function teardownDemo(
  stats: SeedStats,
  storage: ObjectStoragePort,
): Promise<void> {
  const seedDemoPrefix = 'seed:demo:';
  const seedIdFilter = { id: { startsWith: seedDemoPrefix } } as const;

  const countAndDelete = async (
    model: string,
    deleteMany: () => Promise<{ readonly count: number }>,
  ): Promise<void> => {
    const result = await deleteMany();
    for (let i = 0; i < result.count; i += 1) {
      stats.updated(model);
    }
  };

  await countAndDelete('MilestoneDocumentReviewHistory', () =>
    prisma.milestoneDocumentReviewHistory.deleteMany({
      where: {
        milestoneDocumentSubmissionId: { startsWith: seedDemoPrefix },
      },
    }),
  );

  const demoSubmissionFiles = await prisma.submissionFile.findMany({
    where: seedIdFilter,
    select: { storageKey: true },
  });
  await countAndDelete('SubmissionFile', () =>
    prisma.submissionFile.deleteMany({ where: seedIdFilter }),
  );
  for (const file of demoSubmissionFiles) {
    await storage.delete(file.storageKey);
  }
  await countAndDelete('MilestoneDocumentSubmissionHistory', () =>
    prisma.milestoneDocumentSubmissionHistory.deleteMany({
      where: {
        milestoneDocumentSubmissionId: { startsWith: seedDemoPrefix },
      },
    }),
  );
  await countAndDelete('MilestoneDocumentSubmission', () =>
    prisma.milestoneDocumentSubmission.deleteMany({ where: seedIdFilter }),
  );
  await countAndDelete('MilestoneDocument', () =>
    prisma.milestoneDocument.deleteMany({ where: seedIdFilter }),
  );
  await countAndDelete('BoardComment', () =>
    prisma.boardComment.deleteMany({ where: seedIdFilter }),
  );
  await countAndDelete('BoardPost', () =>
    prisma.boardPost.deleteMany({ where: seedIdFilter }),
  );
  await countAndDelete('TeamMember', () =>
    prisma.teamMember.deleteMany({ where: seedIdFilter }),
  );
  await countAndDelete('Milestone', () =>
    prisma.milestone.deleteMany({ where: seedIdFilter }),
  );
  await countAndDelete('Application', () =>
    prisma.application.deleteMany({ where: seedIdFilter }),
  );
  await countAndDelete('Team', () =>
    prisma.team.deleteMany({ where: seedIdFilter }),
  );
  await countAndDelete('Program', () =>
    prisma.program.deleteMany({ where: seedIdFilter }),
  );
  await countAndDelete('Consent', () =>
    prisma.consent.deleteMany({
      where: { userId: { startsWith: seedDemoPrefix } },
    }),
  );
  await countAndDelete('UserProfile', () =>
    prisma.userProfile.deleteMany({
      where: { userId: { startsWith: seedDemoPrefix } },
    }),
  );
  await countAndDelete('User', () =>
    prisma.user.deleteMany({ where: seedIdFilter }),
  );
}
