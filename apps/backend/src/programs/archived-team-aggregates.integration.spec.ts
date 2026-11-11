import {
  ApplicationStatus,
  ProgramCategory,
  ProgramTrackType,
  SubmissionStatus,
} from '@prisma/client';
import { FileMetadataRepository } from './files.repository';
import { LockProgramTreeRepository } from '../platform/lock-program-tree.repository';
import { PlatformRepository } from '../platform/platform.repository';
import { PrismaService } from '../platform/prisma.service';
import { RepositoryProvisionGenerationRepository } from '../platform/repository-provision-generation.repository';
import { RankingYearService } from '../ranking/ranking-year.service';
import { StaffInsightsQueryService } from '../staff/staff-insights-query.service';
import { StaffInsightsRepository } from '../staff/staff-insights.repository';
import { StaffInsightsService } from '../staff/staff-insights.service';
import { assertIsolatedIntegrationDatabase } from '../../test/integration-database.guard';
import { canonicalUserCreateFromLabel } from '../users/canonical-user-fixture';
import { RequirementCollectionService } from './requirement-archive.service';
import { ProgramDocumentChangeRequestsService } from './requirements.service';
import {
  RequirementArchiveRepository,
  RequirementCollectionReadRepository,
  RequirementsRepository,
  type ProgramDocumentChangeRequestPreview,
} from './requirements.repository';
import {
  ProgramListStatusFilterRepository,
  ProgramsRepository,
} from './programs.repository';
import { MilestoneCompletionService } from './submissions.service';
import {
  SubmissionDashboardSummaryRepository,
  SubmissionsRepository,
} from './submissions.repository';
import { SubmissionDashboardSummaryService } from './submission-matrix.service';
import { TeamHistoryRepository } from './team-history.repository';
import { ApplicationsRepository } from './team.repository';

assertIsolatedIntegrationDatabase({
  databaseUrl: process.env.DATABASE_URL,
  runnerSentinel: process.env.OSS_HUB_INTEGRATION_RUNNER,
});

const prefix = 'test:archived-agg:';
const programId = `${prefix}program`;
const milestoneId = `${prefix}milestone`;
const requirementId = `${prefix}requirement`;
const archivedTeamId = `${prefix}archived-team`;
const stayTeamId = `${prefix}stay-team`;
const submissionId = `${prefix}submission`;
const applicantId = `${prefix}applicant`;
const memberTwoId = `${prefix}member-2`;
const memberThreeId = `${prefix}member-3`;
const memberFourId = `${prefix}member-4`;
const stayApplicantId = `${prefix}stay-applicant`;
const reviewerId = `${prefix}reviewer`;
const archivedAt = new Date('2026-11-11T09:36:00.000Z');

const prisma = new PrismaService();
const platform = new PlatformRepository();
const files = new FileMetadataRepository();
const submissions = new SubmissionsRepository(platform, files);
const requirements = new RequirementsRepository(
  prisma,
  new LockProgramTreeRepository(),
  platform,
  submissions,
  new RequirementCollectionReadRepository(prisma, files),
  files,
);
const applications = new ApplicationsRepository(
  prisma,
  new TeamHistoryRepository(),
  new RepositoryProvisionGenerationRepository(),
  platform,
);
const insights = new StaffInsightsService(
  new StaffInsightsRepository(prisma),
  new RankingYearService(),
  new StaffInsightsQueryService(),
);
const programCounts = new ProgramsRepository(
  prisma,
  platform,
  new ProgramListStatusFilterRepository(),
);
const submissionSummary = new SubmissionDashboardSummaryService(
  new SubmissionDashboardSummaryRepository(prisma),
  new MilestoneCompletionService(),
);
const collection = new RequirementCollectionService(
  new RequirementCollectionReadRepository(prisma, files),
);
const changeRequests = new ProgramDocumentChangeRequestsService(
  requirements,
  new RequirementArchiveRepository(prisma),
  submissions,
);

async function clean(): Promise<void> {
  await prisma.submission.deleteMany({ where: { id: submissionId } });
  await prisma.teamMember.deleteMany({
    where: { teamId: { in: [archivedTeamId, stayTeamId] } },
  });
  await prisma.team.deleteMany({
    where: { id: { in: [archivedTeamId, stayTeamId] } },
  });
  await prisma.requirement.deleteMany({ where: { id: requirementId } });
  await prisma.milestone.deleteMany({ where: { id: milestoneId } });
  await prisma.program.deleteMany({ where: { id: programId } });
  await prisma.user.deleteMany({
    where: {
      id: {
        in: [
          applicantId,
          memberTwoId,
          memberThreeId,
          memberFourId,
          stayApplicantId,
          reviewerId,
        ],
      },
    },
  });
}

async function seedUser(
  id: string,
  githubId: bigint,
  label: 'STUDENT' | 'STAFF',
) {
  await prisma.user.create({
    data: canonicalUserCreateFromLabel(label, {
      id,
      githubId,
      nickname: id,
      name: id,
    }),
  });
}

describe('archived teams leave staff and student aggregates', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await clean();
    await seedUser(applicantId, 881110000001n, 'STUDENT');
    await seedUser(memberTwoId, 881110000002n, 'STUDENT');
    await seedUser(memberThreeId, 881110000003n, 'STUDENT');
    await seedUser(memberFourId, 881110000004n, 'STUDENT');
    await seedUser(stayApplicantId, 881110000005n, 'STUDENT');
    await seedUser(reviewerId, 881110000006n, 'STAFF');
    await prisma.program.create({
      data: {
        id: programId,
        name: 'Archived aggregate program',
        organizer: 'Synthetic organizer',
        category: ProgramCategory.BASIC,
        trackType: ProgramTrackType.CURRICULAR,
        applicationTemplateKey: 'capstone-v1',
        applicationTemplateVersion: 1,
        applicationStartAt: new Date('2026-08-01T00:00:00.000Z'),
        applicationEndAt: new Date('2026-08-31T00:00:00.000Z'),
        startAt: new Date('2026-08-01T00:00:00.000Z'),
        endAt: new Date('2027-08-31T00:00:00.000Z'),
        description: 'Synthetic archived aggregate fixture',
        teamMinSize: 1,
        teamMaxSize: 4,
      },
    });
    await prisma.milestone.create({
      data: {
        id: milestoneId,
        programId,
        name: 'Synthetic milestone',
        startAt: new Date('2026-08-01T00:00:00.000Z'),
        dueAt: new Date('2026-09-30T00:00:00.000Z'),
      },
    });
    await prisma.requirement.create({
      data: {
        id: requirementId,
        milestoneId,
        name: 'Synthetic document',
        required: true,
        sortOrder: 1,
      },
    });
    await prisma.team.create({
      data: {
        id: archivedTeamId,
        programId,
        name: 'Archived team',
        leaderId: applicantId,
        applicantId,
        answers: {},
        applicationTemplateVersion: 1,
        status: ApplicationStatus.APPROVED,
      },
    });
    await prisma.team.create({
      data: {
        id: stayTeamId,
        programId,
        name: 'Staying team',
        leaderId: stayApplicantId,
        applicantId: stayApplicantId,
        answers: {},
        applicationTemplateVersion: 1,
        status: ApplicationStatus.APPROVED,
      },
    });
    for (const userId of [
      applicantId,
      memberTwoId,
      memberThreeId,
      memberFourId,
    ]) {
      await prisma.teamMember.create({
        data: { teamId: archivedTeamId, programId, userId },
      });
    }
    await prisma.teamMember.create({
      data: { teamId: stayTeamId, programId, userId: stayApplicantId },
    });
    await prisma.submission.create({
      data: {
        id: submissionId,
        requirementId,
        teamId: archivedTeamId,
        status: SubmissionStatus.SUBMITTED,
        submittedById: applicantId,
      },
    });
  });

  afterAll(async () => {
    await clean();
    await prisma.$disconnect();
  });

  it('drops the archived team, including its applicant, from the counts people see', async () => {
    const before = await readCounts();
    expect(before.dashboard).toEqual({
      total: 2,
      submitted: 0,
      approved: 2,
      rejected: 0,
    });
    expect(before.participants).toBe(5);
    expect(before.applications).toEqual({ total: 2, pending: 0 });
    expect(before.submissions).toEqual({
      approvedApplications: 2,
      submitted: 1,
      notSubmitted: 1,
    });
    expect(before.collectionTeamIds).toEqual([archivedTeamId, stayTeamId]);
    expect(before.changeRequestSubmitted).toBe(1);

    await prisma.teamMember.deleteMany({ where: { teamId: archivedTeamId } });
    await prisma.team.update({
      where: { id: archivedTeamId },
      data: { archivedAt },
    });

    const after = await readCounts();
    expect(after.dashboard).toEqual({
      total: 1,
      submitted: 0,
      approved: 1,
      rejected: 0,
    });
    expect(after.participants).toBe(1);
    expect(after.applications).toEqual({ total: 1, pending: 0 });
    expect(after.submissions).toEqual({
      approvedApplications: 1,
      submitted: 0,
      notSubmitted: 1,
    });
    expect(after.collectionTeamIds).toEqual([stayTeamId]);
    expect(after.changeRequestSubmitted).toBe(0);

    const requested = await changeRequests.requestChanges(
      reviewerId,
      programId,
      {
        scope: { kind: 'PROGRAM' },
        includeFinalDecisions: false,
        comment: null,
        expectedVersion: after.changeRequestVersion,
      },
    );
    expect(requested.requestedCount).toBe(0);
    const untouched = await prisma.submission.findUniqueOrThrow({
      where: { id: submissionId },
      select: { status: true },
    });
    expect(untouched.status).toBe(SubmissionStatus.SUBMITTED);
  });
});

async function readCounts(): Promise<{
  readonly dashboard: {
    readonly total: number;
    readonly submitted: number;
    readonly approved: number;
    readonly rejected: number;
  };
  readonly participants: number;
  readonly applications: { readonly total: number; readonly pending: number };
  readonly submissions: {
    readonly approvedApplications: number;
    readonly submitted: number;
    readonly notSubmitted: number;
  };
  readonly collectionTeamIds: readonly string[];
  readonly changeRequestSubmitted: number;
  readonly changeRequestVersion: string;
}> {
  const dashboard = await applications.listStaffDashboardSummary();
  const program = dashboard.programs.find((item) => item.id === programId);
  if (program === undefined) {
    throw new Error('missing dashboard program');
  }
  const insight = await insights.summarize({ kind: 'all' });
  const insightProgram = insight.programs.find(
    (item) => item.programId === programId,
  );
  const applicationCounts = await programCounts.countApplicationsByProgram([
    programId,
  ]);
  const applicationsForProgram = applicationCounts.get(programId) ?? {
    total: 0,
    pending: 0,
  };
  const [matrix] = await submissionSummary.listByProgram([programId]);
  if (matrix === undefined) {
    throw new Error('missing submission summary');
  }
  const collected = await collection.collectForStaff(milestoneId, {
    filter: 'ALL',
    page: 1,
    pageSize: 20,
  });
  const preview: ProgramDocumentChangeRequestPreview =
    await changeRequests.targets(programId, { kind: 'PROGRAM' });
  return {
    dashboard: program.applications,
    participants: insightProgram?.participantCount ?? 0,
    applications: applicationsForProgram,
    submissions: {
      approvedApplications: matrix.approvedApplications,
      submitted: matrix.submitted,
      notSubmitted: matrix.notSubmitted,
    },
    collectionTeamIds: collected.rows
      .map((row) => row.application.teamId)
      .sort(),
    changeRequestSubmitted: preview.counts[SubmissionStatus.SUBMITTED],
    changeRequestVersion: preview.version,
  };
}
