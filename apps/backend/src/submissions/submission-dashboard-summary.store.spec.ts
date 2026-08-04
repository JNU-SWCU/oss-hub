import { ApplicationStatus, SubmissionStatus } from '@prisma/client';
import {
  type DashboardApplicationRow,
  type DashboardMilestoneRow,
  type DashboardSubmissionRow,
  type SubmissionDashboardSummaryDataSource,
  SubmissionDashboardSummaryStore,
} from './submission-dashboard-summary.store';

class FakeFindManyDelegate<TArgs, TRow> {
  readonly calls: TArgs[] = [];

  constructor(private readonly rows: readonly TRow[]) {}

  findMany(args: TArgs): Promise<readonly TRow[]> {
    this.calls.push(args);
    return Promise.resolve(this.rows);
  }
}

describe('SubmissionDashboardSummaryStore', () => {
  it('queries approved applications, milestones, and current submissions once for all programs', async () => {
    // Given
    const applications = new FakeFindManyDelegate<
      Parameters<
        SubmissionDashboardSummaryDataSource['application']['findMany']
      >[0],
      DashboardApplicationRow
    >([
      { id: 'approved-application', programId: 'program-a' },
      { id: 'approved-team-application', programId: 'program-b' },
    ]);
    const milestones = new FakeFindManyDelegate<
      Parameters<
        SubmissionDashboardSummaryDataSource['milestone']['findMany']
      >[0],
      DashboardMilestoneRow
    >([
      { id: 'milestone-a', programId: 'program-a' },
      { id: 'milestone-b', programId: 'program-b' },
    ]);
    const submissions = new FakeFindManyDelegate<
      Parameters<
        SubmissionDashboardSummaryDataSource['submission']['findMany']
      >[0],
      DashboardSubmissionRow
    >([
      {
        applicationId: 'approved-application',
        milestoneId: 'milestone-a',
        status: SubmissionStatus.SUBMITTED,
        application: { programId: 'program-a' },
        milestone: { programId: 'program-a' },
      },
    ]);
    const prisma = {
      application: applications,
      milestone: milestones,
      submission: submissions,
    } satisfies SubmissionDashboardSummaryDataSource;
    const repository = new SubmissionDashboardSummaryStore(prisma);

    // When
    const records = await repository.listRecords(['program-a', 'program-b']);

    // Then
    expect(records).toEqual({
      applications: [
        { id: 'approved-application', programId: 'program-a' },
        { id: 'approved-team-application', programId: 'program-b' },
      ],
      milestones: [
        { id: 'milestone-a', programId: 'program-a' },
        { id: 'milestone-b', programId: 'program-b' },
      ],
      submissions: [
        {
          applicationId: 'approved-application',
          applicationProgramId: 'program-a',
          milestoneId: 'milestone-a',
          milestoneProgramId: 'program-a',
          status: SubmissionStatus.SUBMITTED,
        },
      ],
    });
    expect(applications.calls).toHaveLength(1);
    expect(milestones.calls).toHaveLength(1);
    expect(submissions.calls).toHaveLength(1);
    expect(applications.calls[0]).toEqual({
      where: {
        programId: { in: ['program-a', 'program-b'] },
        status: ApplicationStatus.APPROVED,
      },
      select: { id: true, programId: true },
    });
    expect(milestones.calls[0]).toEqual({
      where: { programId: { in: ['program-a', 'program-b'] } },
      select: { id: true, programId: true },
    });
    expect(submissions.calls[0]).toEqual({
      where: {
        application: {
          is: {
            programId: { in: ['program-a', 'program-b'] },
            status: ApplicationStatus.APPROVED,
          },
        },
        milestone: {
          is: {
            programId: { in: ['program-a', 'program-b'] },
          },
        },
      },
      select: {
        applicationId: true,
        milestoneId: true,
        status: true,
        application: { select: { programId: true } },
        milestone: { select: { programId: true } },
      },
    });
  });

  it('returns empty records without database fan-out when no program ids are requested', async () => {
    // Given
    const applications = new FakeFindManyDelegate<
      Parameters<
        SubmissionDashboardSummaryDataSource['application']['findMany']
      >[0],
      DashboardApplicationRow
    >([]);
    const milestones = new FakeFindManyDelegate<
      Parameters<
        SubmissionDashboardSummaryDataSource['milestone']['findMany']
      >[0],
      DashboardMilestoneRow
    >([]);
    const submissions = new FakeFindManyDelegate<
      Parameters<
        SubmissionDashboardSummaryDataSource['submission']['findMany']
      >[0],
      DashboardSubmissionRow
    >([]);
    const prisma = {
      application: applications,
      milestone: milestones,
      submission: submissions,
    } satisfies SubmissionDashboardSummaryDataSource;

    // When
    const records = await new SubmissionDashboardSummaryStore(
      prisma,
    ).listRecords([]);

    // Then
    expect(records).toEqual({
      applications: [],
      milestones: [],
      submissions: [],
    });
    expect(applications.calls).toHaveLength(0);
    expect(milestones.calls).toHaveLength(0);
    expect(submissions.calls).toHaveLength(0);
  });
});
