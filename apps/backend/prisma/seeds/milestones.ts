import {
  ApplicationStatus,
  MilestoneSubmissionType,
  ProgramCategory,
  ReviewDecision,
  Role,
  SubmissionStatus,
} from '@prisma/client';
import {
  offsetDays,
  prisma,
  seedId,
  SeedStats,
  upsertSeedUser,
  upsertTracked,
} from './helpers';
import { computeJoinCodeDigest } from '../../src/common/join-code-digest';

/**
 * milestones profile은 intake profile 없이 빈 DB에서 단독으로 성공해야 한다
 * (#110 완료 조건). 그래서 intake.ts를 참조하지 않고 자체 Program·Application
 * backbone을 이 파일 안에서 만든다.
 */
const PROGRAM_ID = seedId('milestones', 'program');
const REVIEWER_ID = seedId('milestones', 'user', 'reviewer');
const APPLICANT_PERSONAL_ID = seedId(
  'milestones',
  'user',
  'applicant-personal',
);
const TEAM_LEADER_ID = seedId('milestones', 'user', 'team-leader');
const TEAM_MEMBER_ID = seedId('milestones', 'user', 'team-member');
const TEAM_ID = seedId('milestones', 'team');
const APPLICATION_PERSONAL_ID = seedId('milestones', 'application', 'personal');
const APPLICATION_TEAM_ID = seedId('milestones', 'application', 'team');

export const MILESTONE_SCENARIOS = {
  'milestones-upcoming': [
    seedId('milestones', 'milestones-upcoming', 'd5'),
    seedId('milestones', 'milestones-upcoming', 'd15'),
  ],
  'milestones-overdue': [seedId('milestones', 'milestones-overdue')],
  'milestone-with-submission': [
    seedId('milestones', 'milestone-with-submission'),
  ],
  'submission-existing': [seedId('milestones', 'submission-existing')],
  'submission-approved': [seedId('milestones', 'submission-approved')],
  'submission-changes-requested': [
    seedId('milestones', 'submission-changes-requested'),
  ],
  'submission-rejected': [seedId('milestones', 'submission-rejected')],
} as const;

async function upsertMilestone(
  stats: SeedStats,
  params: {
    id: string;
    name: string;
    dueAt: Date;
    submissionType: MilestoneSubmissionType;
  },
): Promise<void> {
  await upsertTracked(
    stats,
    'Milestone',
    () => prisma.milestone.findUnique({ where: { id: params.id } }),
    () =>
      prisma.milestone.upsert({
        where: { id: params.id },
        update: { name: params.name, dueAt: params.dueAt },
        create: {
          id: params.id,
          programId: PROGRAM_ID,
          name: params.name,
          dueAt: params.dueAt,
          submissionType: params.submissionType,
        },
      }),
  );
}

/**
 * submission-* 시나리오가 공유하는 helper — 개인형·팀형 어느 applicationId를 넘겨도
 * 동일하게 Submission + revision 1 + (선택) Review를 만든다.
 */
async function createSubmissionScenario(
  stats: SeedStats,
  params: {
    scenarioId: string;
    milestoneId: string;
    applicationId: string;
    submittedById: string;
    status: SubmissionStatus;
    review?: { decision: ReviewDecision; comment?: string };
  },
): Promise<void> {
  const submissionId = seedId('milestones', params.scenarioId, 'submission');
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

  const revisionId = seedId('milestones', params.scenarioId, 'revision-1');
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
          submissionType: MilestoneSubmissionType.TEXT,
          content: { seedPlaceholder: true, scenarioId: params.scenarioId },
          submittedById: params.submittedById,
        },
      }),
  );

  if (params.review) {
    const review = params.review;
    const reviewId = seedId('milestones', params.scenarioId, 'review');
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
            reviewerId: REVIEWER_ID,
            decision: review.decision,
            comment: review.comment,
          },
        }),
    );
  }
}

export async function seedMilestones(stats: SeedStats): Promise<void> {
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
          name: 'seed-milestones-program',
          organizer: 'seed-organizer',
          category: ProgramCategory.BASIC,
          applicationTemplateKey: ProgramCategory.BASIC.toLowerCase(),
          applicationTemplateVersion: 1,
          applicationStartAt: offsetDays(-40),
          applicationEndAt: offsetDays(40),
          teamMinSize: 2,
          teamMaxSize: 4,
          description: '#110 시드 fixture — milestones profile 전용',
        },
      }),
  );

  const reviewer = await upsertSeedUser(stats, {
    id: REVIEWER_ID,
    role: Role.STAFF,
  });
  void reviewer;
  const applicantPersonal = await upsertSeedUser(stats, {
    id: APPLICANT_PERSONAL_ID,
    role: Role.STUDENT,
  });
  const teamLeader = await upsertSeedUser(stats, {
    id: TEAM_LEADER_ID,
    role: Role.STUDENT,
  });
  const teamMember = await upsertSeedUser(stats, {
    id: TEAM_MEMBER_ID,
    role: Role.STUDENT,
  });

  await upsertTracked(
    stats,
    'Application',
    () =>
      prisma.application.findUnique({ where: { id: APPLICATION_PERSONAL_ID } }),
    () =>
      prisma.application.upsert({
        where: { id: APPLICATION_PERSONAL_ID },
        update: {},
        create: {
          id: APPLICATION_PERSONAL_ID,
          programId: PROGRAM_ID,
          applicantId: applicantPersonal.id,
          answers: { seedPlaceholder: true, scenarioId: 'milestones-personal' },
          applicationTemplateVersion: 1,
          status: ApplicationStatus.APPROVED,
        },
      }),
  );

  await upsertTracked(
    stats,
    'Team',
    () => prisma.team.findUnique({ where: { id: TEAM_ID } }),
    () =>
      prisma.team.upsert({
        where: { id: TEAM_ID },
        update: {
          joinCodeDigest: computeJoinCodeDigest('SEED-MILESTONES-TEAM'),
        },
        create: {
          id: TEAM_ID,
          programId: PROGRAM_ID,
          name: 'seed-milestones-team',
          joinCodeDigest: computeJoinCodeDigest('SEED-MILESTONES-TEAM'),
          leaderId: teamLeader.id,
        },
      }),
  );
  await upsertTracked(
    stats,
    'TeamMember',
    () =>
      prisma.teamMember.findUnique({
        where: { id: seedId('milestones', 'team-member', 'leader') },
      }),
    () =>
      prisma.teamMember.upsert({
        where: { id: seedId('milestones', 'team-member', 'leader') },
        update: {},
        create: {
          id: seedId('milestones', 'team-member', 'leader'),
          teamId: TEAM_ID,
          programId: PROGRAM_ID,
          userId: teamLeader.id,
        },
      }),
  );
  await upsertTracked(
    stats,
    'TeamMember',
    () =>
      prisma.teamMember.findUnique({
        where: { id: seedId('milestones', 'team-member', 'member') },
      }),
    () =>
      prisma.teamMember.upsert({
        where: { id: seedId('milestones', 'team-member', 'member') },
        update: {},
        create: {
          id: seedId('milestones', 'team-member', 'member'),
          teamId: TEAM_ID,
          programId: PROGRAM_ID,
          userId: teamMember.id,
        },
      }),
  );
  await upsertTracked(
    stats,
    'Application',
    () => prisma.application.findUnique({ where: { id: APPLICATION_TEAM_ID } }),
    () =>
      prisma.application.upsert({
        where: { id: APPLICATION_TEAM_ID },
        update: {},
        create: {
          id: APPLICATION_TEAM_ID,
          programId: PROGRAM_ID,
          applicantId: teamLeader.id,
          teamId: TEAM_ID,
          answers: { seedPlaceholder: true, scenarioId: 'milestones-team' },
          applicationTemplateVersion: 1,
          status: ApplicationStatus.APPROVED,
        },
      }),
  );

  // milestones-upcoming: D-5, D-15.
  const [d5Id, d15Id] = MILESTONE_SCENARIOS['milestones-upcoming'];
  await upsertMilestone(stats, {
    id: d5Id,
    name: 'seed-milestone-d5',
    dueAt: offsetDays(5),
    submissionType: MilestoneSubmissionType.TEXT,
  });
  await upsertMilestone(stats, {
    id: d15Id,
    name: 'seed-milestone-d15',
    dueAt: offsetDays(15),
    submissionType: MilestoneSubmissionType.TEXT,
  });

  // milestones-overdue: 마감 지남, 최초 제출 차단(제출 row 없음 — 파생 OVERDUE는 dueAt만으로 표현).
  const [overdueId] = MILESTONE_SCENARIOS['milestones-overdue'];
  await upsertMilestone(stats, {
    id: overdueId,
    name: 'seed-milestone-overdue',
    dueAt: offsetDays(-3),
    submissionType: MilestoneSubmissionType.FILE,
  });

  // milestone-with-submission: 제출이 달려 있어 삭제 시 409가 되는 milestone.
  const [withSubmissionId] = MILESTONE_SCENARIOS['milestone-with-submission'];
  await upsertMilestone(stats, {
    id: withSubmissionId,
    name: 'seed-milestone-with-submission',
    dueAt: offsetDays(10),
    submissionType: MilestoneSubmissionType.TEXT,
  });
  await createSubmissionScenario(stats, {
    scenarioId: 'milestone-with-submission',
    milestoneId: withSubmissionId,
    applicationId: APPLICATION_PERSONAL_ID,
    submittedById: applicantPersonal.id,
    status: SubmissionStatus.SUBMITTED,
  });

  // submission-existing: revision 1, SUBMITTED, 미검토 (팀형 application으로 재사용 helper 검증).
  const [existingId] = MILESTONE_SCENARIOS['submission-existing'];
  await upsertMilestone(stats, {
    id: existingId,
    name: 'seed-milestone-submission-existing',
    dueAt: offsetDays(12),
    submissionType: MilestoneSubmissionType.TEXT,
  });
  await createSubmissionScenario(stats, {
    scenarioId: 'submission-existing',
    milestoneId: existingId,
    applicationId: APPLICATION_TEAM_ID,
    submittedById: teamLeader.id,
    status: SubmissionStatus.SUBMITTED,
  });

  // submission-approved: 최신 revision APPROVED.
  const [approvedId] = MILESTONE_SCENARIOS['submission-approved'];
  await upsertMilestone(stats, {
    id: approvedId,
    name: 'seed-milestone-submission-approved',
    dueAt: offsetDays(8),
    submissionType: MilestoneSubmissionType.REPOSITORY_RELEASE,
  });
  await createSubmissionScenario(stats, {
    scenarioId: 'submission-approved',
    milestoneId: approvedId,
    applicationId: APPLICATION_PERSONAL_ID,
    submittedById: applicantPersonal.id,
    status: SubmissionStatus.APPROVED,
    review: { decision: ReviewDecision.APPROVED },
  });

  // submission-changes-requested: 코멘트 있음, 재제출 가능.
  const [changesRequestedId] =
    MILESTONE_SCENARIOS['submission-changes-requested'];
  await upsertMilestone(stats, {
    id: changesRequestedId,
    name: 'seed-milestone-submission-changes-requested',
    dueAt: offsetDays(6),
    submissionType: MilestoneSubmissionType.TEXT,
  });
  await createSubmissionScenario(stats, {
    scenarioId: 'submission-changes-requested',
    milestoneId: changesRequestedId,
    applicationId: APPLICATION_TEAM_ID,
    submittedById: teamMember.id,
    status: SubmissionStatus.CHANGES_REQUESTED,
    review: {
      decision: ReviewDecision.CHANGES_REQUESTED,
      comment: '누락된 항목을 보완해 재제출해 주세요 (seed fixture)',
    },
  });

  // submission-rejected: 최종 반려, 재제출 불가.
  const [rejectedId] = MILESTONE_SCENARIOS['submission-rejected'];
  await upsertMilestone(stats, {
    id: rejectedId,
    name: 'seed-milestone-submission-rejected',
    dueAt: offsetDays(4),
    submissionType: MilestoneSubmissionType.FILE,
  });
  await createSubmissionScenario(stats, {
    scenarioId: 'submission-rejected',
    milestoneId: rejectedId,
    applicationId: APPLICATION_PERSONAL_ID,
    submittedById: applicantPersonal.id,
    status: SubmissionStatus.REJECTED,
    review: {
      decision: ReviewDecision.REJECTED,
      comment: '제출 요건을 충족하지 못했습니다 (seed fixture)',
    },
  });
}
