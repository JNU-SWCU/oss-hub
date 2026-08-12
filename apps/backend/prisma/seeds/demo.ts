import {
  ApplicationStatus,
  BoardPostCategory,
  MilestoneSubmissionType,
  ProgramCategory,
  ReviewDecision,
  Role,
  SubmissionFileLifecycle,
  SubmissionStatus,
} from '@prisma/client';
import { computeJoinCodeDigest } from '../../src/common/join-code-digest';
import { upsertCompatibleProfile } from '../../src/profiles/profile-compatibility.repository';
import {
  offsetDays,
  prisma,
  seedId,
  SeedStats,
  upsertConsent,
  upsertSeedUser,
  upsertTracked,
} from './helpers';

/**
 * demo profile — 내일 시연을 위한 "사업단이 실제 운영하는 느낌"의 합성 데이터 전용
 * backbone이다(qa-econovation-batch TODO 11·15). 다른 profile을 참조하지 않고 자체
 * Program·User·Team backbone을 만든다 — 빈 DB에서 단독 실행해도 성공한다.
 *
 * 프로그램 4개는 전남대 SW중심대학사업단이 실제로 공개 운영하는 프로그램 **유형**
 * (하계 SW인턴십 연계 · 오픈소스 SW개발자 대회 · 신입생 SW역량 강화 · 소중마일리지
 * 연계 비교과)을 모델로 한 이름·설명이되, 일정·참가자·팀·게시글은 전부 합성값이다.
 * 실제 사업단 공지의 문구·날짜를 복사하지 않는다(`prisma/AGENTS.md` 시드 규칙 #3·#4).
 * 설명·마일스톤 문구의 "모집 배경/지원 대상/운영 방식/문의 안내" 구성은 사업단 공개
 * 페이지(sojoong.kr)의 톤·용어를 참고했을 뿐 본문을 그대로 옮기지 않았다(TODO 15).
 *
 * GithubRepository·Contribution 등 수집/랭킹 테이블은 이 profile이 절대 만들지 않는다
 * (`prisma/AGENTS.md` 시드 규칙 #5) — Econovation 2026 저장소 등록은 실제 ADMIN
 * discovery/enrollment 경로 + 실제 sweep으로만 이뤄진다(TODO 12).
 *
 * production 실행은 기본적으로 `assertSeedAllowed`가 거부한다. 이 profile만 예외로,
 * 소유자 승인(@GoBeromsu, 본 플랜 — qa-econovation-batch TODO 11·15) 하에
 * `SEED_DEMO_ALLOW_PRODUCTION=1`을 명시했을 때만 production에서 실행할 수 있다
 * (`assertDemoSeedAllowedInProduction`, `seed.ts`). 같은 플래그 하에 `--teardown`
 * CLI 플래그로 이 profile이 만든 `seed:demo:*` 행 전부를 일괄 삭제할 수도 있다.
 */

type DemoStudent = {
  readonly slug: string;
  readonly name: string;
  readonly studentId: string;
  readonly department: string;
  readonly emailLocalPart: string;
};

/** 합성 한국식 학생 14명 — 실존 인물 아님. `.invalid` 이메일(RFC 2606)만 쓴다. */
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
/** 문의 안내에 쓰는 합성 담당자 이메일 — 실제 사업단 연락처가 아니다(.invalid). */
const DEMO_STAFF_CONTACT_EMAIL = 'sw-center.inquiry@demo.invalid';

async function upsertDemoStudent(
  stats: SeedStats,
  student: DemoStudent,
): Promise<{ readonly id: string }> {
  const id = seedId('demo', 'user', student.slug);
  const user = await upsertSeedUser(stats, { id, role: Role.STUDENT });
  await upsertConsent(stats, user.id);
  await prisma.$transaction((transaction) =>
    upsertCompatibleProfile(
      transaction,
      user.id,
      {
        name: student.name,
        studentId: student.studentId,
        department: student.department,
      },
      {
        name: student.name,
        studentId: student.studentId,
        department: student.department,
      },
    ),
  );
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
  const user = await upsertSeedUser(stats, { id, role: Role.STAFF });
  await upsertConsent(stats, user.id);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      name: DEMO_STAFF_NAME,
      department: DEMO_STAFF_DEPARTMENT,
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

type InProgressSubmissionContent =
  | {
      readonly kind: typeof MilestoneSubmissionType.TEXT;
      readonly text: string;
    }
  | {
      readonly kind: typeof MilestoneSubmissionType.FILE;
      /** 제출 상황을 설명하는 보조 코멘트(SubmissionRevision.comment) — FILE은 content가 파일만 가리키므로 진행 상황 서술은 여기에 담는다. */
      readonly comment: string;
      readonly originalFileName: string;
      readonly mimeType: string;
      readonly sizeBytes: number;
    };

type DemoReview = {
  readonly decision:
    typeof ReviewDecision.APPROVED | typeof ReviewDecision.CHANGES_REQUESTED;
  readonly comment: string;
  readonly reviewedAt: Date;
};

/**
 * 마일스톤 제출 1건 — `status`로 제출됨(SUBMITTED, 리뷰 없음)·보완 필요
 * (CHANGES_REQUESTED, 리뷰 있음)·승인(APPROVED, 리뷰 있음) 세 상태를 모두 표현한다
 * (TODO 15 — 여러 팀의 기록이 상태별로 섞여 쌓인 화면을 만들기 위함).
 *
 * `content.kind`는 호출부가 넘긴 마일스톤의 `submissionType`과 항상 일치해야 한다 —
 * `submissions.service.ts`가 `content.type !== milestone.submissionType`을
 * CONTENT_TYPE_MISMATCH로 거부하는 도메인 규칙을 시드가 우회해서는 안 된다.
 * FILE 타입은 실제 서비스 생성물과 동일한 최종 상태(SubmissionFile.lifecycle=ATTACHED,
 * submissionRevisionId 연결)로 만든다.
 */
async function upsertDemoSubmission(
  stats: SeedStats,
  params: {
    readonly slug: string;
    readonly milestoneId: string;
    readonly applicationId: string;
    readonly submittedById: string;
    readonly submittedAt: Date;
    readonly status: SubmissionStatus;
    readonly content: InProgressSubmissionContent;
    readonly review?: DemoReview;
    readonly reviewerId?: string;
  },
): Promise<void> {
  const submissionId = seedId('demo', 'submission', params.slug);
  await upsertTracked(
    stats,
    'Submission',
    () => prisma.submission.findUnique({ where: { id: submissionId } }),
    () =>
      prisma.submission.upsert({
        where: { id: submissionId },
        update: { status: params.status, currentRevision: 1 },
        create: {
          id: submissionId,
          milestoneId: params.milestoneId,
          applicationId: params.applicationId,
          status: params.status,
          currentRevision: 1,
        },
      }),
  );
  const revisionId = seedId('demo', 'submission', params.slug, 'revision-1');
  const fileId = seedId('demo', 'submission-file', params.slug);
  const revisionContent =
    params.content.kind === MilestoneSubmissionType.TEXT
      ? { type: MilestoneSubmissionType.TEXT, text: params.content.text }
      : { type: MilestoneSubmissionType.FILE, fileId };
  await upsertTracked(
    stats,
    'SubmissionRevision',
    () => prisma.submissionRevision.findUnique({ where: { id: revisionId } }),
    () =>
      prisma.submissionRevision.upsert({
        where: { id: revisionId },
        update: {},
        create: {
          id: revisionId,
          submissionId,
          revision: 1,
          submissionType: params.content.kind,
          content: revisionContent,
          comment:
            params.content.kind === MilestoneSubmissionType.FILE
              ? params.content.comment
              : null,
          submittedById: params.submittedById,
          submittedAt: params.submittedAt,
        },
      }),
  );

  const fileContent = params.content;
  if (fileContent.kind === MilestoneSubmissionType.FILE) {
    const storageKey = `demo/${fileId}`;
    await upsertTracked(
      stats,
      'SubmissionFile',
      () => prisma.submissionFile.findUnique({ where: { id: fileId } }),
      () =>
        prisma.submissionFile.upsert({
          where: { id: fileId },
          update: {
            storageKey,
            lifecycle: SubmissionFileLifecycle.ATTACHED,
            submissionRevisionId: revisionId,
          },
          create: {
            id: fileId,
            uploaderId: params.submittedById,
            applicationId: params.applicationId,
            milestoneId: params.milestoneId,
            submissionRevisionId: revisionId,
            storageKey,
            originalFileName: fileContent.originalFileName,
            mimeType: fileContent.mimeType,
            sizeBytes: fileContent.sizeBytes,
            lifecycle: SubmissionFileLifecycle.ATTACHED,
            expiresAt: offsetDays(365),
          },
        }),
    );
  }

  if (params.review && params.reviewerId) {
    const review = params.review;
    const reviewId = seedId('demo', 'submission', params.slug, 'review');
    await upsertTracked(
      stats,
      'Review',
      () => prisma.review.findUnique({ where: { id: reviewId } }),
      () =>
        prisma.review.upsert({
          where: { id: reviewId },
          update: { decision: review.decision, comment: review.comment },
          create: {
            id: reviewId,
            submissionRevisionId: revisionId,
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
          // 이 profile은 GithubRepository/Contribution을 절대 만들지 않으므로 저장소
          // 프로비저닝도 켜지 않는다 — 실제 수집 파이프라인과의 경계를 명확히 한다.
          repositoryProvisioningEnabled: false,
        },
      }),
  );
}

/** 문의 안내 문단 — 4개 프로그램 설명이 공통으로 붙이는 마무리 문구(합성 담당자 연락처). */
function inquiryParagraph(): string {
  return (
    `문의 안내: 프로그램 운영·일정 관련 문의는 담당자 이메일(${DEMO_STAFF_CONTACT_EMAIL}, 시연용 ` +
    '합성 주소)로 접수해 주세요. 답변은 접수 순서대로 영업일 기준 2일 이내 드립니다 (seed fixture).'
  );
}

export async function seedDemo(stats: SeedStats): Promise<void> {
  const staff = await upsertDemoStaff(stats, 'staff-lead');

  const students = new Map<string, { readonly id: string }>();
  for (const student of DEMO_STUDENTS) {
    students.set(student.slug, await upsertDemoStudent(stats, student));
  }
  const studentBySlug = (slug: DemoStudent['slug']): DemoStudent =>
    DEMO_STUDENTS.find((student) => student.slug === slug)!;
  const studentId = (slug: DemoStudent['slug']): string =>
    students.get(slug)!.id;

  // ── 프로그램 1: 하계 SW 현장실습 연계 프로그램 (CORPORATE_INTERNSHIP) ────────
  // 일정은 전부 합성값이다(실제 사업단 인턴십 공고 일정을 복사하지 않음).
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
  await upsertDemoSubmission(stats, {
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

  // ── 프로그램 2: 2026 오픈소스 SW개발자 대회 (에코노베이션 연계, OSS_CONTEST) ──
  // 다팀 그래프(TODO 15) — 참가팀 5개가 승인된 지원서와 마일스톤 제출 기록을 쌓아
  // '여러 팀이 참여해 기록이 쌓이는 모습'을 보여준다. GithubRepository/Contribution은
  // 이 시드가 아니라 실제 ADMIN 수집 경로로만 등록된다(운영 절차, TODO 12).
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
    /**
     * 데모데이 제출(Submission/SubmissionRevision/SubmissionFile) id에 쓰는 slug.
     * 기본값은 `${teamSlug}-demo-day`이지만, TODO 11(병합된 기존 demo profile)이
     * '한빛 팀'의 데모데이 제출을 팀 접두사 없는 `oss-contest-demo-day`로 이미 만들어
     * 둥다 — 그 팀만 이 필드로 원래 id를 명시 유지해야 이미 시드된 DB에서 재실행해도
     * 같은 (applicationId, milestoneId)에 새 id로 생성하려다 고유 제약(Submission
     * `@@unique([applicationId, milestoneId])`)을 깨트리지 않는다(TODO 15 QA 지적).
     */
    readonly demoDaySubmissionSlug?: string;
    /** 원래 id와 함께 보존해야 하는 파일명(기본값 `${teamSlug}-demo-day-draft.pdf`). */
    readonly demoDayOriginalFileName?: string;
    /** 데모데이 마일스톤(FILE) 제출 상태 — 팀마다 섞어 보완 필요/승인/제출됨을 모두 보여준다. */
    readonly demoDaySubmission: {
      readonly status: SubmissionStatus;
      readonly comment: string;
      readonly review?: DemoReview;
    };
    /** 최종 발표 마일스톤(TEXT) 제출 상태 — 아직 제출 전인 팀도 있어 진행 단계 차이를 보여준다. */
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
      // TODO 11(병합된 기존 demo profile)이 이 팀의 데모데이 제출을 팀 접두사 없는
      // `oss-contest-demo-day` slug로 이미 만들어둥다 — 원래 id를 깨드리지 않게 명시 유지한다.
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
    await upsertDemoSubmission(stats, {
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
        sizeBytes: 1_048_576,
      },
      submittedAt: offsetDays(-2),
      review: team.demoDaySubmission.review,
      reviewerId: team.demoDaySubmission.review ? staff.id : undefined,
    });

    if (team.finalSubmission) {
      await upsertDemoSubmission(stats, {
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

  // ── 프로그램 3: 2026 신입생 SW역량 강화 캠프 (SW_VALUE_SPREAD) ──────────────
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
  await upsertDemoSubmission(stats, {
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

  // ── 프로그램 4: 2026 소중마일리지 연계 오픈소스 비교과 (BASIC) ───────────────
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
  await upsertDemoSubmission(stats, {
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

/**
 * demo profile teardown(TODO 15) — 이 profile이 만든 `seed:demo:*` 행 전부를 의존성
 * 순서로 일괄 삭제한다. `seed:demo:` 접두사가 아닌 행은 절대 건드리지 않는다 — 모든
 * delete가 `startsWith: 'seed:demo:'` 필터를 강제한다(비-demo 데이터 삭제 가능성 절대
 * 금지, prisma/AGENTS.md 시드 규칙). production에서는 `assertSeedAllowed`와 동일한
 * `SEED_DEMO_ALLOW_PRODUCTION=1` 게이트를 통과해야 `seed.ts`가 이 함수를 호출한다.
 *
 * 삭제 순서(자식 → 부모, 전부 RESTRICT/기본 FK — cascade 없음):
 *   SubmissionFile → SubmissionRevision → Submission → Review(Revision 삭제 전에는
 *   존재해도 CASCADE 대상이 아니므로 Revision보다 먼저 지운다) → BoardComment →
 *   BoardPost → TeamMember → Milestone → Application → Team → Program →
 *   Consent → UserProfile → User.
 */
export async function teardownDemo(stats: SeedStats): Promise<void> {
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

  // Review는 submissionRevisionId로 연결되며 그 id는 seed:demo: 접두사이므로
  // 접두사 필터를 revision id 기준으로 건다 — Review.id 자체도 seed:demo:이지만
  // 이중 안전을 위해 revision 관계로도 범위를 좁힌다.
  await countAndDelete('Review', () =>
    prisma.review.deleteMany({
      where: { submissionRevisionId: { startsWith: seedDemoPrefix } },
    }),
  );
  await countAndDelete('SubmissionFile', () =>
    prisma.submissionFile.deleteMany({ where: seedIdFilter }),
  );
  await countAndDelete('SubmissionRevision', () =>
    prisma.submissionRevision.deleteMany({ where: seedIdFilter }),
  );
  await countAndDelete('Submission', () =>
    prisma.submission.deleteMany({ where: seedIdFilter }),
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
