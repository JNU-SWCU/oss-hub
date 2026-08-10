import {
  ApplicationStatus,
  BoardPostCategory,
  MilestoneSubmissionType,
  ProgramCategory,
  Role,
  SubmissionStatus,
  TeamInvitationStatus,
} from '@prisma/client';
import { computeJoinCodeDigest } from '../../src/common/join-code-digest';
import {
  offsetDays,
  prisma,
  seedId,
  SeedStats,
  upsertSeedUser,
  upsertTracked,
} from './helpers';

/**
 * program-overview profile — 마일스톤별 서류 항목(#619)·게시판·팀 초대의 "프로토타입과 같은
 * 모양" 시나리오 전용 backbone이다. intake/milestones/repositories와 마찬가지로 자체
 * Program·User backbone을 만들며 다른 profile을 참조하지 않는다 — 빈 DB에서 단독 실행해도
 * 성공한다.
 *
 * 마일스톤 7개(#1 수강 신청·팀 등록 … #7 최종 발표·시연)는 프로토타입 스펙(`docs/design.md`)의
 * 제목을 그대로 쓰되 날짜는 SEED_NOW 기준 상대값(offsetDays)이다 — 다른 시드 파일과 달리
 * 이 profile은 실제 팀 일정을 반영하지 않는 합성 fixture다.
 */
const PROGRAM_ID = seedId('program-overview', 'program');
const STAFF_ID = seedId('program-overview', 'user', 'staff');
const LEADER_ID = seedId('program-overview', 'user', 'team-leader');
const MEMBER_ID = seedId('program-overview', 'user', 'team-member');
const INVITEE_ID = seedId('program-overview', 'user', 'invitee');
const TEAM_ID = seedId('program-overview', 'team');
const APPLICATION_ID = seedId('program-overview', 'application');
const PROGRAM_START_AT = offsetDays(-45);

type MilestoneSeed = {
  readonly id: string;
  readonly name: string;
  readonly dueAt: Date;
  readonly submissionType: MilestoneSubmissionType;
  readonly instructions?: string;
};

async function upsertMilestone(
  stats: SeedStats,
  params: MilestoneSeed,
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
          startAt: PROGRAM_START_AT,
          dueAt: params.dueAt,
          submissionType: params.submissionType,
          instructions: params.instructions,
        },
        create: {
          id: params.id,
          programId: PROGRAM_ID,
          name: params.name,
          startAt: PROGRAM_START_AT,
          dueAt: params.dueAt,
          submissionType: params.submissionType,
          instructions: params.instructions,
        },
      }),
  );
}

type MilestoneDocumentSeed = {
  readonly id: string;
  readonly milestoneId: string;
  readonly name: string;
  readonly required: boolean;
  readonly sortOrder: number;
  readonly submissionType: MilestoneSubmissionType;
};

async function upsertMilestoneDocument(
  stats: SeedStats,
  params: MilestoneDocumentSeed,
): Promise<void> {
  await upsertTracked(
    stats,
    'MilestoneDocument',
    () => prisma.milestoneDocument.findUnique({ where: { id: params.id } }),
    () =>
      prisma.milestoneDocument.upsert({
        where: { id: params.id },
        update: {
          name: params.name,
          required: params.required,
          sortOrder: params.sortOrder,
          submissionType: params.submissionType,
        },
        create: {
          id: params.id,
          milestoneId: params.milestoneId,
          name: params.name,
          required: params.required,
          sortOrder: params.sortOrder,
          submissionType: params.submissionType,
        },
      }),
  );
}

async function upsertMilestoneDocumentTemplateFile(
  stats: SeedStats,
  params: {
    readonly id: string;
    readonly milestoneDocumentId: string;
    readonly originalFileName: string;
    readonly mimeType: string;
    readonly uploadedById: string;
  },
): Promise<void> {
  const storageKey = `program-overview/${params.id}`;
  await upsertTracked(
    stats,
    'MilestoneDocumentTemplateFile',
    () =>
      prisma.milestoneDocumentTemplateFile.findUnique({
        where: { id: params.id },
      }),
    () =>
      prisma.milestoneDocumentTemplateFile.upsert({
        where: { id: params.id },
        update: {
          storageKey,
          originalFileName: params.originalFileName,
          mimeType: params.mimeType,
        },
        create: {
          id: params.id,
          milestoneDocumentId: params.milestoneDocumentId,
          storageKey,
          originalFileName: params.originalFileName,
          mimeType: params.mimeType,
          sizeBytes: 245_760,
          uploadedById: params.uploadedById,
          uploadedAt: offsetDays(-40),
        },
      }),
  );
}

/** 서류 항목 제출 예시(#3의 첫 두 항목) — FILE 유형이라 SubmissionFile을 함께 붙인다. */
async function upsertMilestoneDocumentSubmission(
  stats: SeedStats,
  params: {
    readonly id: string;
    readonly milestoneDocumentId: string;
    readonly milestoneId: string;
    readonly submittedById: string;
    readonly originalFileName: string;
  },
): Promise<void> {
  const submittedAt = offsetDays(-2);
  await upsertTracked(
    stats,
    'MilestoneDocumentSubmission',
    () =>
      prisma.milestoneDocumentSubmission.findUnique({
        where: { id: params.id },
      }),
    () =>
      prisma.milestoneDocumentSubmission.upsert({
        where: { id: params.id },
        update: { submittedAt },
        create: {
          id: params.id,
          milestoneDocumentId: params.milestoneDocumentId,
          applicationId: APPLICATION_ID,
          status: SubmissionStatus.SUBMITTED,
          submittedById: params.submittedById,
          submittedAt,
        },
      }),
  );

  const fileId = seedId('program-overview', 'submission-file', params.id);
  const storageKey = `program-overview/${fileId}`;
  await upsertTracked(
    stats,
    'SubmissionFile',
    () => prisma.submissionFile.findUnique({ where: { id: fileId } }),
    () =>
      prisma.submissionFile.upsert({
        where: { id: fileId },
        update: { storageKey },
        create: {
          id: fileId,
          uploaderId: params.submittedById,
          applicationId: APPLICATION_ID,
          milestoneId: params.milestoneId,
          milestoneDocumentSubmissionId: params.id,
          storageKey,
          originalFileName: params.originalFileName,
          mimeType: 'application/pdf',
          sizeBytes: 512_000,
        },
      }),
  );
}

async function upsertBoardPost(
  stats: SeedStats,
  params: {
    readonly id: string;
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
          programId: PROGRAM_ID,
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

async function upsertBoardComment(
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

export async function seedProgramOverview(stats: SeedStats): Promise<void> {
  await upsertTracked(
    stats,
    'Program',
    () => prisma.program.findUnique({ where: { id: PROGRAM_ID } }),
    () =>
      prisma.program.upsert({
        where: { id: PROGRAM_ID },
        update: {},
        create: {
          id: PROGRAM_ID,
          name: 'seed-program-overview-project',
          organizer: 'seed-organizer-sw-center',
          category: ProgramCategory.CAPSTONE,
          applicationTemplateKey: ProgramCategory.CAPSTONE.toLowerCase(),
          applicationTemplateVersion: 1,
          applicationStartAt: offsetDays(-60),
          applicationEndAt: offsetDays(-46),
          startAt: PROGRAM_START_AT,
          endAt: offsetDays(150),
          teamMinSize: 3,
          teamMaxSize: 5,
          description:
            '#619 program-overview profile 시드 fixture — 마일스톤별 서류 항목·게시판·팀 초대 시나리오 전용.',
          repositoryProvisioningEnabled: true,
        },
      }),
  );

  const staff = await upsertSeedUser(stats, {
    id: STAFF_ID,
    role: Role.STAFF,
  });
  const leader = await upsertSeedUser(stats, {
    id: LEADER_ID,
    role: Role.STUDENT,
  });
  const member = await upsertSeedUser(stats, {
    id: MEMBER_ID,
    role: Role.STUDENT,
  });
  await upsertSeedUser(stats, { id: INVITEE_ID, role: Role.STUDENT });

  await upsertTracked(
    stats,
    'Team',
    () => prisma.team.findUnique({ where: { id: TEAM_ID } }),
    () =>
      prisma.team.upsert({
        where: { id: TEAM_ID },
        update: {
          joinCodeDigest: computeJoinCodeDigest('SEED-PROGRAM-OVERVIEW-TEAM'),
        },
        create: {
          id: TEAM_ID,
          programId: PROGRAM_ID,
          name: 'seed-program-overview-team',
          joinCodeDigest: computeJoinCodeDigest('SEED-PROGRAM-OVERVIEW-TEAM'),
          leaderId: leader.id,
        },
      }),
  );

  await upsertTracked(
    stats,
    'TeamMember',
    () =>
      prisma.teamMember.findUnique({
        where: { id: seedId('program-overview', 'team-member', 'leader') },
      }),
    () =>
      prisma.teamMember.upsert({
        where: { id: seedId('program-overview', 'team-member', 'leader') },
        update: {},
        create: {
          id: seedId('program-overview', 'team-member', 'leader'),
          teamId: TEAM_ID,
          programId: PROGRAM_ID,
          userId: leader.id,
        },
      }),
  );
  await upsertTracked(
    stats,
    'TeamMember',
    () =>
      prisma.teamMember.findUnique({
        where: { id: seedId('program-overview', 'team-member', 'member') },
      }),
    () =>
      prisma.teamMember.upsert({
        where: { id: seedId('program-overview', 'team-member', 'member') },
        update: {},
        create: {
          id: seedId('program-overview', 'team-member', 'member'),
          teamId: TEAM_ID,
          programId: PROGRAM_ID,
          userId: member.id,
        },
      }),
  );

  await upsertTracked(
    stats,
    'Application',
    () => prisma.application.findUnique({ where: { id: APPLICATION_ID } }),
    () =>
      prisma.application.upsert({
        where: { id: APPLICATION_ID },
        update: {},
        create: {
          id: APPLICATION_ID,
          programId: PROGRAM_ID,
          applicantId: leader.id,
          teamId: TEAM_ID,
          answers: {
            seedPlaceholder: true,
            scenarioId: 'program-overview-team',
          },
          applicationTemplateVersion: 1,
          status: ApplicationStatus.APPROVED,
          submittedAt: offsetDays(-50),
        },
      }),
  );

  await upsertTracked(
    stats,
    'TeamInvitation',
    () =>
      prisma.teamInvitation.findUnique({
        where: { id: seedId('program-overview', 'team-invitation', 'pending') },
      }),
    () =>
      prisma.teamInvitation.upsert({
        where: {
          id: seedId('program-overview', 'team-invitation', 'pending'),
        },
        update: { status: TeamInvitationStatus.PENDING },
        create: {
          id: seedId('program-overview', 'team-invitation', 'pending'),
          teamId: TEAM_ID,
          programId: PROGRAM_ID,
          inviteeId: INVITEE_ID,
          invitedById: leader.id,
          status: TeamInvitationStatus.PENDING,
          invitedAt: offsetDays(-3),
        },
      }),
  );

  const milestoneIds = {
    m1: seedId('program-overview', 'milestone', 'm1'),
    m2: seedId('program-overview', 'milestone', 'm2'),
    m3: seedId('program-overview', 'milestone', 'm3'),
    m4: seedId('program-overview', 'milestone', 'm4'),
    m5: seedId('program-overview', 'milestone', 'm5'),
    m6: seedId('program-overview', 'milestone', 'm6'),
    m7: seedId('program-overview', 'milestone', 'm7'),
  } as const;

  await upsertMilestone(stats, {
    id: milestoneIds.m1,
    name: '수강 신청 · 팀 등록',
    dueAt: offsetDays(-44),
    submissionType: MilestoneSubmissionType.TEXT,
    instructions: '팀을 만들거나 모집 중인 팀에 들어갑니다.',
  });
  await upsertMilestone(stats, {
    id: milestoneIds.m2,
    name: '주제 선정 · 저장소 연결',
    dueAt: offsetDays(-20),
    submissionType: MilestoneSubmissionType.REPOSITORY_RELEASE,
    instructions: '팀 저장소를 만들고 프로그램에 연결합니다.',
  });
  await upsertMilestone(stats, {
    id: milestoneIds.m3,
    name: '프로젝트 계획서 제출',
    dueAt: offsetDays(7),
    submissionType: MilestoneSubmissionType.FILE,
    instructions: '아래 서류를 모두 내야 제출이 끝납니다.',
  });
  await upsertMilestone(stats, {
    id: milestoneIds.m4,
    name: '1차 중간 산출물 제출',
    dueAt: offsetDays(35),
    submissionType: MilestoneSubmissionType.FILE,
    instructions:
      '동작하는 결과물과 발표자료를 냅니다.\n\n' +
      '· 보고서는 새 양식(v2)으로 작성하고, 실행 방법(README 링크 가능)을 반드시 포함해 주세요.\n' +
      '· 발표자료는 10분 발표 기준 15장 이내를 권장합니다.\n' +
      '· 시연 영상은 3분 이내, 링크(유튜브 비공개 가능)를 TXT로 제출합니다.',
  });
  await upsertMilestone(stats, {
    id: milestoneIds.m5,
    name: '중간 평가',
    dueAt: offsetDays(42),
    submissionType: MilestoneSubmissionType.TEXT,
    instructions: '담당 교수와 멘토가 1차 산출물을 평가합니다.',
  });
  await upsertMilestone(stats, {
    id: milestoneIds.m6,
    name: '최종 산출물 제출',
    dueAt: offsetDays(70),
    submissionType: MilestoneSubmissionType.FILE,
    instructions: '최종 코드·문서·시연 영상을 냅니다.',
  });
  await upsertMilestone(stats, {
    id: milestoneIds.m7,
    name: '최종 발표 · 시연',
    dueAt: offsetDays(80),
    submissionType: MilestoneSubmissionType.TEXT,
    instructions: '팀별로 15분 발표합니다.',
  });

  // #3 프로젝트 계획서 제출 — 서류 3종 (필수 2 · 선택 1).
  const m3Doc1 = seedId('program-overview', 'milestone-document', 'm3-d1');
  const m3Doc2 = seedId('program-overview', 'milestone-document', 'm3-d2');
  const m3Doc3 = seedId('program-overview', 'milestone-document', 'm3-d3');
  await upsertMilestoneDocument(stats, {
    id: m3Doc1,
    milestoneId: milestoneIds.m3,
    name: '개인정보 수집·이용 동의서',
    required: true,
    sortOrder: 1,
    submissionType: MilestoneSubmissionType.FILE,
  });
  await upsertMilestoneDocument(stats, {
    id: m3Doc2,
    milestoneId: milestoneIds.m3,
    name: '프로젝트 계획서',
    required: true,
    sortOrder: 2,
    submissionType: MilestoneSubmissionType.FILE,
  });
  await upsertMilestoneDocument(stats, {
    id: m3Doc3,
    milestoneId: milestoneIds.m3,
    name: '팀 구성 확인서',
    required: false,
    sortOrder: 3,
    submissionType: MilestoneSubmissionType.FILE,
  });
  await upsertMilestoneDocumentTemplateFile(stats, {
    id: seedId('program-overview', 'milestone-document-template', 'm3-d1'),
    milestoneDocumentId: m3Doc1,
    originalFileName: 'consent-form-v1.pdf',
    mimeType: 'application/pdf',
    uploadedById: staff.id,
  });
  await upsertMilestoneDocumentTemplateFile(stats, {
    id: seedId('program-overview', 'milestone-document-template', 'm3-d2'),
    milestoneDocumentId: m3Doc2,
    originalFileName: 'project-plan-template-v1.docx',
    mimeType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    uploadedById: staff.id,
  });
  // m3Doc3(팀 구성 확인서)는 프로토타입 스펙대로 양식 미등록 상태로 남긴다.
  await upsertMilestoneDocumentSubmission(stats, {
    id: seedId('program-overview', 'milestone-document-submission', 'm3-d1'),
    milestoneDocumentId: m3Doc1,
    milestoneId: milestoneIds.m3,
    submittedById: leader.id,
    originalFileName: 'consent-form-signed.pdf',
  });
  await upsertMilestoneDocumentSubmission(stats, {
    id: seedId('program-overview', 'milestone-document-submission', 'm3-d2'),
    milestoneDocumentId: m3Doc2,
    milestoneId: milestoneIds.m3,
    submittedById: member.id,
    originalFileName: 'project-plan-draft.pdf',
  });
  // m3Doc3(팀 구성 확인서)는 프로토타입 스펙대로 미제출 상태로 남긴다.

  // #4 1차 중간 산출물 제출 — 서류 3종(필수 2 · 선택 1), 전부 미제출.
  const m4Doc1 = seedId('program-overview', 'milestone-document', 'm4-d1');
  const m4Doc2 = seedId('program-overview', 'milestone-document', 'm4-d2');
  const m4Doc3 = seedId('program-overview', 'milestone-document', 'm4-d3');
  await upsertMilestoneDocument(stats, {
    id: m4Doc1,
    milestoneId: milestoneIds.m4,
    name: '중간 산출물 보고서',
    required: true,
    sortOrder: 1,
    submissionType: MilestoneSubmissionType.FILE,
  });
  await upsertMilestoneDocument(stats, {
    id: m4Doc2,
    milestoneId: milestoneIds.m4,
    name: '발표자료',
    required: true,
    sortOrder: 2,
    submissionType: MilestoneSubmissionType.FILE,
  });
  await upsertMilestoneDocument(stats, {
    id: m4Doc3,
    milestoneId: milestoneIds.m4,
    name: '시연 영상 링크',
    required: false,
    sortOrder: 3,
    submissionType: MilestoneSubmissionType.TEXT,
  });
  await upsertMilestoneDocumentTemplateFile(stats, {
    id: seedId('program-overview', 'milestone-document-template', 'm4-d1'),
    milestoneDocumentId: m4Doc1,
    originalFileName: 'interim-report-template-v2.pdf',
    mimeType: 'application/pdf',
    uploadedById: staff.id,
  });
  // m4Doc2(발표자료)·m4Doc3(시연 영상 링크)는 프로토타입 스펙대로 양식 미등록 상태로 남긴다.

  // 게시판 3건 — 공지 2(교직원) · 질문 1(학생).
  const post1 = seedId('program-overview', 'board-post', '1');
  const post2 = seedId('program-overview', 'board-post', '2');
  const post3 = seedId('program-overview', 'board-post', '3');
  await upsertBoardPost(stats, {
    id: post1,
    category: BoardPostCategory.NOTICE,
    title: '프로젝트 계획서 양식이 v2로 바뀌었습니다',
    body: '#3 프로젝트 계획서 서류의 양식이 v2로 교체되었습니다. 새 양식으로 다시 받아 제출해 주세요.',
    authorId: staff.id,
    pinned: true,
    createdAt: offsetDays(-20),
  });
  await upsertBoardPost(stats, {
    id: post2,
    category: BoardPostCategory.NOTICE,
    title: '중간 평가 일정 안내',
    body: '중간 평가는 마일스톤 #5 기간에 진행됩니다. 팀별 일정은 추후 공지합니다.',
    authorId: staff.id,
    pinned: false,
    createdAt: offsetDays(-24),
  });
  await upsertBoardPost(stats, {
    id: post3,
    category: BoardPostCategory.QNA,
    title: '팀 구성 확인서는 팀장만 내면 되나요?',
    body: '팀 구성 확인서를 팀장이 대표로 제출하면 되는지, 팀원 각자 내야 하는지 궁금합니다.',
    authorId: member.id,
    pinned: false,
    createdAt: offsetDays(-18),
  });
  await upsertBoardComment(stats, {
    id: seedId('program-overview', 'board-comment', '1a'),
    postId: post1,
    authorId: leader.id,
    body: '이미 v1으로 제출했는데 그대로 두면 되나요?',
    createdAt: offsetDays(-20),
  });
  await upsertBoardComment(stats, {
    id: seedId('program-overview', 'board-comment', '1b'),
    postId: post1,
    authorId: staff.id,
    body: '네, 재제출 불필요합니다.',
    createdAt: offsetDays(-19),
  });
  await upsertBoardComment(stats, {
    id: seedId('program-overview', 'board-comment', '3a'),
    postId: post3,
    authorId: staff.id,
    body: '팀장이 대표로 제출하면 됩니다. 팀원 개별 제출은 필요 없습니다.',
    createdAt: offsetDays(-17),
  });
}
