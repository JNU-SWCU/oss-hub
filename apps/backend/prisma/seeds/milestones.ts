import {
  ApplicationStatus,
  MilestoneDocumentKind,
  MilestoneDocumentSubmissionHistoryEvent,
  MilestoneSubmissionType,
  ProgramCategory,
  ReviewDecision,
  SubmissionStatus,
} from '@prisma/client';
import { MemberKind } from '@prisma/client';
import {
  offsetDays,
  prisma,
  seedId,
  SeedStats,
  upsertSeedProfile,
  upsertSeedUser,
  upsertTracked,
} from './helpers';
import { computeJoinCodeDigest } from '../../src/programs/domain/join-code-digest';
import { resolveJoinCodeSecret } from '../../src/runtime-config/join-code-secret';

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
          submissionType: params.submissionType,
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
    () => prisma.milestoneDocument.findUnique({ where: { id: documentId } }),
    () =>
      prisma.milestoneDocument.upsert({
        where: { id: documentId },
        update: { name: params.name },
        create: {
          id: documentId,
          milestoneId: params.id,
          name: params.name,
          required: true,
          sortOrder: -1,
          kind: MilestoneDocumentKind.LEGACY_MILESTONE_SUBMISSION,
        },
      }),
  );
}

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
  const documentId = seedId(
    'milestones',
    params.milestoneId,
    'legacy-submission-document',
  );
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
          name: '기존 제출 자료',
          required: true,
          sortOrder: -1,
          kind: MilestoneDocumentKind.LEGACY_MILESTONE_SUBMISSION,
        },
      }),
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
      prisma.milestoneDocumentSubmission.findUnique({
        where: { id: targetSubmissionId },
      }),
    () =>
      prisma.milestoneDocumentSubmission.upsert({
        where: { id: targetSubmissionId },
        update: { status: params.status, revision: 1 },
        create: {
          id: targetSubmissionId,
          legacySubmissionId: null,
          milestoneDocumentId: documentId,
          applicationId: params.applicationId,
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
      prisma.milestoneDocumentSubmissionHistory.findUnique({
        where: { id: targetHistoryId },
      }),
    () =>
      prisma.milestoneDocumentSubmissionHistory.upsert({
        where: { id: targetHistoryId },
        update: {},
        create: {
          id: targetHistoryId,
          milestoneDocumentSubmissionId: targetSubmissionId,
          event: MilestoneDocumentSubmissionHistoryEvent.SUBMITTED,
          revision: 1,
          content: { seedPlaceholder: true, scenarioId: params.scenarioId },
          actorId: params.submittedById,
        },
      }),
  );
  if (params.review) {
    const targetReviewId = seedId(
      'milestones',
      params.scenarioId,
      'target-review',
    );
    await upsertTracked(
      stats,
      'MilestoneDocumentReviewHistory',
      () =>
        prisma.milestoneDocumentReviewHistory.findUnique({
          where: { id: targetReviewId },
        }),
      () =>
        prisma.milestoneDocumentReviewHistory.upsert({
          where: { id: targetReviewId },
          update: {
            decision: params.review?.decision,
            comment: params.review?.comment,
          },
          create: {
            id: targetReviewId,
            milestoneDocumentSubmissionId: targetSubmissionId,
            submissionHistoryId: targetHistoryId,
            reviewerId: REVIEWER_ID,
            decision: params.review!.decision,
            comment: params.review?.comment,
          },
        }),
    );
    const targetReviewEventId = seedId(
      'milestones',
      params.scenarioId,
      'target-review-event',
    );
    await upsertTracked(
      stats,
      'MilestoneDocumentSubmissionHistory',
      () =>
        prisma.milestoneDocumentSubmissionHistory.findUnique({
          where: { id: targetReviewEventId },
        }),
      () =>
        prisma.milestoneDocumentSubmissionHistory.upsert({
          where: { id: targetReviewEventId },
          update: {
            event: params.review!.decision,
            comment: params.review?.comment,
            actorId: REVIEWER_ID,
          },
          create: {
            id: targetReviewEventId,
            milestoneDocumentSubmissionId: targetSubmissionId,
            event: params.review!.decision,
            revision: 1,
            comment: params.review?.comment,
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
          applicationTemplateKey: ProgramCategory.BASIC.toLowerCase(),
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
    memberKind: MemberKind.STAFF,
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
    memberKind: MemberKind.STUDENT,
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
    memberKind: MemberKind.STUDENT,
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
    memberKind: MemberKind.STUDENT,
  });

  const personalTeamId = seedId('milestones', 'application-personal', 'team');
  await upsertTracked(
    stats,
    'Team',
    () => prisma.team.findUnique({ where: { id: personalTeamId } }),
    () =>
      prisma.team.upsert({
        where: { id: personalTeamId },
        update: {
          joinCodeDigest: computeJoinCodeDigest(
            'SEED-MILESTONES-SOLO',
            resolveJoinCodeSecret(),
          ),
        },
        create: {
          id: personalTeamId,
          programId: PROGRAM_ID,
          name: '마일스톤 개인 참여 1인 팀',
          joinCodeDigest: computeJoinCodeDigest(
            'SEED-MILESTONES-SOLO',
            resolveJoinCodeSecret(),
          ),
          leaderId: applicantPersonal.id,
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
          id: seedId('milestones', 'application-personal', 'team-member'),
          teamId: personalTeamId,
          programId: PROGRAM_ID,
          userId: applicantPersonal.id,
        },
      }),
  );

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
          teamId: personalTeamId,
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
          joinCodeDigest: computeJoinCodeDigest(
            'SEED-MILESTONES-TEAM',
            resolveJoinCodeSecret(),
          ),
        },
        create: {
          id: TEAM_ID,
          programId: PROGRAM_ID,
          name: 'seed-milestones-team',
          joinCodeDigest: computeJoinCodeDigest(
            'SEED-MILESTONES-TEAM',
            resolveJoinCodeSecret(),
          ),
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
    applicationId: APPLICATION_PERSONAL_ID,
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
    applicationId: APPLICATION_TEAM_ID,
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
    applicationId: APPLICATION_PERSONAL_ID,
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
    applicationId: APPLICATION_TEAM_ID,
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
    applicationId: APPLICATION_PERSONAL_ID,
    submittedById: applicantPersonal.id,
    status: SubmissionStatus.REJECTED,
    review: {
      decision: ReviewDecision.REJECTED,
      comment: '제출 요건을 충족하지 못했습니다 (seed fixture)',
    },
  });
}
