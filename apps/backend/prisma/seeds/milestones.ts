import {
  ApplicationStatus,
  SubmissionHistoryEvent,
  MilestoneSubmissionType,
  ProgramCategory,
  ReviewDecision,
  SubmissionStatus,
  UserType,
} from '@prisma/client';
import {
  applicationTemplateKey,
  offsetDays,
  prisma,
  seedId,
  SeedStats,
  upsertTracked,
} from './helpers';
import { upsertSeedProfile, upsertSeedUser } from './user';
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
const PROGRAM_START_AT = offsetDays(-49);
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
        update: {
          name: params.name,
          startAt: PROGRAM_START_AT,
          dueAt: params.dueAt,
        },
        create: {
          id: params.id,
          programId: PROGRAM_ID,
          name: params.name,
          startAt: PROGRAM_START_AT,
          dueAt: params.dueAt,
        },
      }),
  );
  const documentId = seedId(
    'milestones',
    params.id,
    'legacy-submission-document',
  );
  await upsertTracked(
    stats,
    'MilestoneDocument',
    () => prisma.requirement.findUnique({ where: { id: documentId } }),
    () =>
      prisma.requirement.upsert({
        where: { id: documentId },
        update: { name: params.name, submissionType: params.submissionType },
        create: {
          id: documentId,
          milestoneId: params.id,
          name: params.name,
          submissionType: params.submissionType,
          required: true,
          sortOrder: -1,
        },
      }),
  );
}
async function createSubmissionScenario(
  stats: SeedStats,
  params: {
    scenarioId: string;
    milestoneId: string;
    teamId: string;
    submittedById: string;
    status: SubmissionStatus;
    review?: {
      decision: ReviewDecision;
      comment?: string;
    };
  },
): Promise<void> {
  const documentId = seedId(
    'milestones',
    params.milestoneId,
    'legacy-submission-document',
  );
  const targetSubmissionId = seedId(
    'milestones',
    params.scenarioId,
    'submission',
  );
  await upsertTracked(
    stats,
    'MilestoneDocumentSubmission',
    () =>
      prisma.submission.findUnique({
        where: { id: targetSubmissionId },
      }),
    () =>
      prisma.submission.upsert({
        where: { id: targetSubmissionId },
        update: { status: params.status, revision: 1 },
        create: {
          id: targetSubmissionId,
          requirementId: documentId,
          teamId: params.teamId,
          status: params.status,
          content: { seedPlaceholder: true, scenarioId: params.scenarioId },
          revision: 1,
          submittedById: params.submittedById,
        },
      }),
  );
  const targetHistoryId = seedId(
    'milestones',
    params.scenarioId,
    'target-history-1',
  );
  await upsertTracked(
    stats,
    'MilestoneDocumentSubmissionHistory',
    () =>
      prisma.submissionHistory.findUnique({
        where: { id: targetHistoryId },
      }),
    () =>
      prisma.submissionHistory.upsert({
        where: { id: targetHistoryId },
        update: {},
        create: {
          id: targetHistoryId,
          submissionId: targetSubmissionId,
          event: SubmissionHistoryEvent.SUBMITTED,
          revision: 1,
          content: { seedPlaceholder: true, scenarioId: params.scenarioId },
          actorId: params.submittedById,
        },
      }),
  );
  if (params.review) {
    const review = params.review;
    const reviewId = seedId('milestones', params.scenarioId, 'target-review');
    await upsertTracked(
      stats,
      'MilestoneDocumentSubmissionHistory',
      () =>
        prisma.submissionHistory.findUnique({
          where: { id: reviewId },
        }),
      () =>
        prisma.submissionHistory.upsert({
          where: { id: reviewId },
          update: {
            event: review.decision,
            comment: review.comment,
            actorId: REVIEWER_ID,
          },
          create: {
            id: reviewId,
            submissionId: targetSubmissionId,
            event: review.decision,
            revision: 1,
            comment: review.comment,
            actorId: REVIEWER_ID,
          },
        }),
    );
  }
}
export async function seedMilestones(stats: SeedStats): Promise<void> {
  const programEndAt = offsetDays(120);
  await upsertTracked(
    stats,
    'Program',
    () => prisma.program.findUnique({ where: { id: PROGRAM_ID } }),
    () =>
      prisma.program.upsert({
        where: { id: PROGRAM_ID },
        update: { endAt: programEndAt },
        create: {
          id: PROGRAM_ID,
          name: 'seed-milestones-program',
          organizer: 'seed-organizer',
          category: ProgramCategory.BASIC,
          applicationTemplateKey: applicationTemplateKey(ProgramCategory.BASIC),
          applicationTemplateVersion: 1,
          applicationStartAt: offsetDays(-60),
          applicationEndAt: offsetDays(-50),
          startAt: PROGRAM_START_AT,
          endAt: programEndAt,
          teamMinSize: 2,
          teamMaxSize: 4,
          description: '#110 시드 fixture — milestones profile 전용',
        },
      }),
  );
  const reviewer = await upsertSeedUser(stats, {
    id: REVIEWER_ID,
    role: 'STAFF',
  });
  await upsertSeedProfile({
    userId: reviewer.id,
    name: '합성 마일스톤 교직원',
    studentId: null,
    department: '합성 사업단',
    type: UserType.STAFF,
  });
  const applicantPersonal = await upsertSeedUser(stats, {
    id: APPLICANT_PERSONAL_ID,
    role: 'STUDENT',
  });
  await upsertSeedProfile({
    userId: applicantPersonal.id,
    name: '합성 개인 신청자',
    studentId: '261001',
    department: '합성 학과',
    type: UserType.STUDENT,
  });
  const teamLeader = await upsertSeedUser(stats, {
    id: TEAM_LEADER_ID,
    role: 'STUDENT',
  });
  await upsertSeedProfile({
    userId: teamLeader.id,
    name: '합성 팀장',
    studentId: '261002',
    department: '합성 학과',
    type: UserType.STUDENT,
  });
  const teamMember = await upsertSeedUser(stats, {
    id: TEAM_MEMBER_ID,
    role: 'STUDENT',
  });
  await upsertSeedProfile({
    userId: teamMember.id,
    name: '합성 팀원',
    studentId: '261003',
    department: '합성 학과',
    type: UserType.STUDENT,
  });
  const personalTeamId = seedId('milestones', 'application-personal', 'team');
  await upsertTracked(
    stats,
    'Team',
    () => prisma.team.findUnique({ where: { id: personalTeamId } }),
    () =>
      prisma.team.upsert({
        where: { id: personalTeamId },
        update: {},
        create: {
          id: personalTeamId,
          programId: PROGRAM_ID,
          name: '마일스톤 개인 참여 1인 팀',
          leaderId: applicantPersonal.id,
          applicantId: applicantPersonal.id,
          answers: { title: '마일스톤 개인 참여 1인 팀' },
          applicationTemplateVersion: 1,
        },
      }),
  );
  await upsertTracked(
    stats,
    'TeamMember',
    () =>
      prisma.teamMember.findUnique({
        where: {
          teamId_userId: {
            teamId: personalTeamId,
            userId: applicantPersonal.id,
          },
        },
      }),
    () =>
      prisma.teamMember.upsert({
        where: {
          teamId_userId: {
            teamId: personalTeamId,
            userId: applicantPersonal.id,
          },
        },
        update: {},
        create: {
          teamId: personalTeamId,
          programId: PROGRAM_ID,
          userId: applicantPersonal.id,
        },
      }),
  );
  await upsertTracked(
    stats,
    'Team',
    () => prisma.team.findUnique({ where: { id: personalTeamId } }),
    () =>
      prisma.team.update({
        where: { id: personalTeamId },
        data: {
          programId: PROGRAM_ID,
          applicantId: applicantPersonal.id,
          answers: { title: '마일스톤 개인 참여 1인 팀' },
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
        update: {},
        create: {
          id: TEAM_ID,
          programId: PROGRAM_ID,
          name: 'seed-milestones-team',
          leaderId: teamLeader.id,
          applicantId: teamLeader.id,
          answers: { title: 'seed-milestones-team' },
          applicationTemplateVersion: 1,
        },
      }),
  );
  await upsertTracked(
    stats,
    'TeamMember',
    () =>
      prisma.teamMember.findUnique({
        where: { teamId_userId: { teamId: TEAM_ID, userId: teamLeader.id } },
      }),
    () =>
      prisma.teamMember.upsert({
        where: { teamId_userId: { teamId: TEAM_ID, userId: teamLeader.id } },
        update: {},
        create: {
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
        where: { teamId_userId: { teamId: TEAM_ID, userId: teamMember.id } },
      }),
    () =>
      prisma.teamMember.upsert({
        where: { teamId_userId: { teamId: TEAM_ID, userId: teamMember.id } },
        update: {},
        create: {
          teamId: TEAM_ID,
          programId: PROGRAM_ID,
          userId: teamMember.id,
        },
      }),
  );
  await upsertTracked(
    stats,
    'Team',
    () => prisma.team.findUnique({ where: { id: TEAM_ID } }),
    () =>
      prisma.team.update({
        where: { id: TEAM_ID },
        data: {
          programId: PROGRAM_ID,
          applicantId: teamLeader.id,
          answers: { title: 'seed-milestones-team' },
          applicationTemplateVersion: 1,
          status: ApplicationStatus.APPROVED,
        },
      }),
  );
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
  const [overdueId] = MILESTONE_SCENARIOS['milestones-overdue'];
  await upsertMilestone(stats, {
    id: overdueId,
    name: 'seed-milestone-overdue',
    dueAt: offsetDays(-3),
    submissionType: MilestoneSubmissionType.FILE,
  });
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
    teamId: personalTeamId,
    submittedById: applicantPersonal.id,
    status: SubmissionStatus.SUBMITTED,
  });
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
    teamId: TEAM_ID,
    submittedById: teamLeader.id,
    status: SubmissionStatus.SUBMITTED,
  });
  const [approvedId] = MILESTONE_SCENARIOS['submission-approved'];
  await upsertMilestone(stats, {
    id: approvedId,
    name: 'seed-milestone-submission-approved',
    dueAt: offsetDays(8),
    submissionType: MilestoneSubmissionType.TEXT,
  });
  await createSubmissionScenario(stats, {
    scenarioId: 'submission-approved',
    milestoneId: approvedId,
    teamId: personalTeamId,
    submittedById: applicantPersonal.id,
    status: SubmissionStatus.APPROVED,
    review: { decision: ReviewDecision.APPROVED },
  });
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
    teamId: TEAM_ID,
    submittedById: teamMember.id,
    status: SubmissionStatus.CHANGES_REQUESTED,
    review: {
      decision: ReviewDecision.CHANGES_REQUESTED,
      comment: '누락된 항목을 보완해 재제출해 주세요 (seed fixture)',
    },
  });
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
    teamId: personalTeamId,
    submittedById: applicantPersonal.id,
    status: SubmissionStatus.REJECTED,
    review: {
      decision: ReviewDecision.REJECTED,
      comment: '제출 요건을 충족하지 못했습니다 (seed fixture)',
    },
  });
}
