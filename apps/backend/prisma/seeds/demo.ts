import {
  ApplicationStatus,
  BoardPostCategory,
  MilestoneSubmissionType,
  ProgramCategory,
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
 * backbone이다(qa-econovation-batch TODO 11). 다른 profile을 참조하지 않고 자체
 * Program·User·Team backbone을 만든다 — 빈 DB에서 단독 실행해도 성공한다.
 *
 * 프로그램 4개는 전남대 SW중심대학사업단이 실제로 공개 운영하는 프로그램 **유형**
 * (하계 SW인턴십 연계 · 오픈소스 SW개발자 대회 · 신입생 SW역량 강화 · 소중마일리지
 * 연계 비교과)을 모델로 한 이름·설명이되, 일정·참가자·팀·게시글은 전부 합성값이다.
 * 실제 사업단 공지의 문구·날짜를 복사하지 않는다(`prisma/AGENTS.md` 시드 규칙 #3·#4).
 *
 * GithubRepository·Contribution 등 수집/랭킹 테이블은 이 profile이 절대 만들지 않는다
 * (`prisma/AGENTS.md` 시드 규칙 #5) — Econovation 2026 저장소 등록은 실제 ADMIN
 * discovery/enrollment 경로 + 실제 sweep으로만 이뤄진다(TODO 12).
 *
 * production 실행은 기본적으로 `assertSeedAllowed`가 거부한다. 이 profile만 예외로,
 * 소유자 승인(@GoBeromsu, 본 플랜 — qa-econovation-batch TODO 11) 하에
 * `SEED_DEMO_ALLOW_PRODUCTION=1`을 명시했을 때만 production에서 실행할 수 있다
 * (`assertDemoSeedAllowedInProduction`, `seed.ts`).
 */

type DemoStudent = {
  readonly slug: string;
  readonly name: string;
  readonly studentId: string;
  readonly department: string;
  readonly emailLocalPart: string;
};

/** 합성 한국식 학생 6명 — 실존 인물 아님. `.invalid` 이메일(RFC 2606)만 쓴다. */
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
] as const;

const DEMO_STAFF_NAME = '합성 사업단 담당자';
const DEMO_STAFF_DEPARTMENT = '오픈소스 SW 개발 사업단';

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

/**
 * 진행 중(마감 전, 제출은 이미 됨 — SUBMITTED, 아직 리뷰 없음) 마일스톤 제출 1건.
 *
 * `content.kind`는 호출부가 넘긴 마일스톤의 `submissionType`과 항상 일치해야 한다 —
 * `submissions.service.ts`가 `content.type !== milestone.submissionType`을
 * CONTENT_TYPE_MISMATCH로 거부하는 도메인 규칙을 시드가 우회해서는 안 된다.
 * FILE 타입은 실제 서비스 생성물과 동일한 최종 상태(SubmissionFile.lifecycle=ATTACHED,
 * submissionRevisionId 연결)로 만든다.
 */
async function upsertInProgressSubmission(
  stats: SeedStats,
  params: {
    readonly slug: string;
    readonly milestoneId: string;
    readonly applicationId: string;
    readonly submittedById: string;
    readonly submittedAt: Date;
    readonly content: InProgressSubmissionContent;
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
        update: { status: SubmissionStatus.SUBMITTED, currentRevision: 1 },
        create: {
          id: submissionId,
          milestoneId: params.milestoneId,
          applicationId: params.applicationId,
          status: SubmissionStatus.SUBMITTED,
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

export async function seedDemo(stats: SeedStats): Promise<void> {
  const staff = await upsertDemoStaff(stats, 'staff-lead');

  const students = new Map<string, { readonly id: string }>();
  for (const student of DEMO_STUDENTS) {
    students.set(student.slug, await upsertDemoStudent(stats, student));
  }
  const studentId = (slug: DemoStudent['slug']): string =>
    students.get(slug)!.id;

  // ── 프로그램 1: 하계 SW인턴십 연계 (CORPORATE_INTERNSHIP) ────────────────────
  // 일정은 전부 합성값이다(실제 사업단 인턴십 공고 일정을 복사하지 않음).
  const internshipProgramId = seedId('demo', 'program', 'summer-internship');
  await upsertDemoProgram(stats, {
    id: internshipProgramId,
    name: '2026 하계 SW 현장실습 연계 프로그램',
    organizer: '오픈소스 SW 개발 사업단',
    category: ProgramCategory.CORPORATE_INTERNSHIP,
    description:
      '참여 기업과 연계한 하계 현장실습 학생을 대상으로 실습 과제 진행 상황을 관리하는 프로그램입니다. ' +
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
    name: '중간 실습 일지 제출',
    startAt: offsetDays(-49),
    dueAt: offsetDays(7),
    submissionType: MilestoneSubmissionType.TEXT,
    instructions: '실습 4주 차까지의 진행 상황과 배운 점을 정리해 제출합니다.',
  });
  await upsertInProgressSubmission(stats, {
    slug: 'summer-internship-midpoint',
    milestoneId: internshipMilestoneId,
    applicationId: internshipApplicationId,
    submittedById: studentId('kim-doyoon'),
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
    title: '중간 실습 일지 제출 안내',
    body: '중간 실습 일지는 아래 마일스톤 탭에서 제출해 주세요. 문의는 댓글로 남겨주시면 됩니다 (seed fixture).',
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

  // ── 프로그램 2: 오픈소스 SW개발자 대회 (에코노베이션 연계, OSS_CONTEST) ──────
  const contestProgramId = seedId('demo', 'program', 'oss-developer-contest');
  await upsertDemoProgram(stats, {
    id: contestProgramId,
    name: '2026 오픈소스 SW개발자 대회 (에코노베이션 연계)',
    organizer: '오픈소스 SW 개발 사업단',
    category: ProgramCategory.OSS_CONTEST,
    description:
      '교내 오픈소스 개발자 대회 참가팀의 팀 구성·마일스톤·게시판을 관리하는 프로그램입니다. ' +
      '에코노베이션 공개 저장소의 실제 수집·랭킹 데이터는 이 시드가 아니라 별도의 ADMIN 수집 경로로만 등록됩니다. ' +
      '모든 일정·팀명·참가자는 시연용 합성 데이터입니다.',
    applicationStartAt: offsetDays(-40),
    applicationEndAt: offsetDays(-30),
    startAt: offsetDays(-28),
    endAt: offsetDays(35),
    teamMinSize: 2,
    teamMaxSize: 4,
  });
  const contestTeamId = await upsertDemoTeam(
    stats,
    contestProgramId,
    {
      teamSlug: 'oss-contest-hanbit',
      teamName: '한빛 팀',
      leader: DEMO_STUDENTS[2]!,
      members: [DEMO_STUDENTS[3]!, DEMO_STUDENTS[4]!],
    },
    studentId('park-haeun'),
    [studentId('park-haeun'), studentId('choi-jiho'), studentId('jung-subin')],
  );
  const contestApplicationId = seedId(
    'demo',
    'application',
    'oss-contest-hanbit',
  );
  await upsertDemoApplication(stats, {
    id: contestApplicationId,
    programId: contestProgramId,
    applicantId: studentId('park-haeun'),
    teamId: contestTeamId,
    title: '교내 학사 알림 오픈소스 서비스',
    summary:
      '학사 일정 알림을 구독형으로 제공하는 오픈소스 프로젝트(합성 fixture).',
    submittedAt: offsetDays(-32),
    processedAt: offsetDays(-29),
  });
  const contestMilestoneId = seedId(
    'demo',
    'milestone',
    'oss-contest-demo-day',
  );
  await upsertDemoMilestone(stats, {
    id: contestMilestoneId,
    programId: contestProgramId,
    name: '중간 데모데이 발표자료 제출',
    startAt: offsetDays(-28),
    dueAt: offsetDays(10),
    submissionType: MilestoneSubmissionType.FILE,
    instructions: '중간 점검용 발표자료(PDF)와 데모 링크를 함께 제출합니다.',
  });
  await upsertInProgressSubmission(stats, {
    slug: 'oss-contest-demo-day',
    milestoneId: contestMilestoneId,
    applicationId: contestApplicationId,
    submittedById: studentId('park-haeun'),
    // 이 마일스톤은 submissionType=FILE이므로 content도 FILE로 맞추고 SubmissionFile을
    // 함께 만든다 — 진행 상황 서술은 comment에 담는다(TEXT content.text로 넣을 수 없음).
    content: {
      kind: MilestoneSubmissionType.FILE,
      comment:
        '구독 알림 발송 기능까지 구현했고, 최종본 발표자료는 이번 주말까지 마무리하겠습니다 (seed fixture).',
      originalFileName: 'oss-contest-demo-day-draft.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1_048_576,
    },
    submittedAt: offsetDays(-2),
  });
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

  // ── 프로그램 3: 신입생 SW역량 강화 (SW_VALUE_SPREAD) ────────────────────────
  const freshmenProgramId = seedId('demo', 'program', 'freshmen-sw-bootcamp');
  await upsertDemoProgram(stats, {
    id: freshmenProgramId,
    name: '2026 신입생 SW역량 강화 캠프',
    organizer: '오픈소스 SW 개발 사업단',
    category: ProgramCategory.SW_VALUE_SPREAD,
    description:
      '신입생 대상 기초 프로그래밍·협업 역량 강화 캠프의 참가 팀과 진행 상황을 관리하는 프로그램입니다. ' +
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
    name: '1차 체크포인트 - 기획안 제출',
    startAt: offsetDays(-14),
    dueAt: offsetDays(3),
    submissionType: MilestoneSubmissionType.TEXT,
    instructions: '팀 프로젝트 기획안과 역할 분담을 간단히 정리해 제출합니다.',
  });
  await upsertInProgressSubmission(stats, {
    slug: 'freshmen-bootcamp-checkpoint',
    milestoneId: freshmenMilestoneId,
    applicationId: freshmenApplicationId,
    submittedById: studentId('kang-yerin'),
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
    title: '멘토 배정 안내',
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

  // ── 프로그램 4: 소중마일리지 연계 비교과 (BASIC) ────────────────────────────
  const mileageProgramId = seedId('demo', 'program', 'sojoong-mileage');
  await upsertDemoProgram(stats, {
    id: mileageProgramId,
    name: '2026 소중마일리지 연계 오픈소스 비교과',
    organizer: '오픈소스 SW 개발 사업단',
    category: ProgramCategory.BASIC,
    description:
      '소중마일리지와 연계해 오픈소스 기여 활동에 마일리지를 부여하는 비교과 프로그램입니다. ' +
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
    name: '월간 활동 기록 제출',
    startAt: offsetDays(-35),
    dueAt: offsetDays(2),
    submissionType: MilestoneSubmissionType.TEXT,
    instructions: '이번 달 기여 활동 내역과 소요 시간을 정리해 제출합니다.',
  });
  await upsertInProgressSubmission(stats, {
    slug: 'sojoong-mileage-activity-log',
    milestoneId: mileageMilestoneId,
    applicationId: mileageApplicationId,
    submittedById: studentId('jung-subin'),
    content: {
      kind: MilestoneSubmissionType.TEXT,
      text: '이슈 12건을 트리아지했고, 문서 오탈자 수정 PR 3건을 올렸습니다 (seed fixture).',
    },
    submittedAt: offsetDays(-1),
  });
  const mileagePostId = seedId('demo', 'board-post', 'sojoong-mileage-1');
  await upsertDemoBoardPost(stats, {
    id: mileagePostId,
    programId: mileageProgramId,
    category: BoardPostCategory.NOTICE,
    title: '마일리지 반영 일정 안내',
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
