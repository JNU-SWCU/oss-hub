import { SubmissionStatus } from '@prisma/client';
import type {
  SubmissionDashboardApplicationRecord,
  SubmissionDashboardMilestoneRecord,
  SubmissionDashboardSubmissionRecord,
  SubmissionDashboardSummaryRepositoryPort,
} from './submission-dashboard-summary.store';
import { SubmissionDashboardSummaryService } from './submission-dashboard-summary.service';

class FakeSubmissionDashboardSummaryRepository implements SubmissionDashboardSummaryRepositoryPort {
  readonly calls: string[][] = [];

  constructor(
    private readonly applications: readonly SubmissionDashboardApplicationRecord[],
    private readonly milestones: readonly SubmissionDashboardMilestoneRecord[],
    private readonly submissions: readonly SubmissionDashboardSubmissionRecord[],
  ) {}

  listRecords(programIds: readonly string[]) {
    this.calls.push([...programIds]);
    return Promise.resolve({
      applications: this.applications,
      milestones: this.milestones,
      submissions: this.submissions,
    });
  }
}

describe('SubmissionDashboardSummaryService', () => {
  it('counts submission states across approved applications and milestones', async () => {
    // Given
    const repository = new FakeSubmissionDashboardSummaryRepository(
      [
        { id: 'approved-personal', programId: 'program-a' },
        { id: 'approved-team', programId: 'program-a' },
        { id: 'approved-other', programId: 'program-b' },
      ],
      [
        { id: 'milestone-a-1', programId: 'program-a' },
        { id: 'milestone-a-2', programId: 'program-a' },
        { id: 'milestone-a-3', programId: 'program-a' },
        { id: 'milestone-b-1', programId: 'program-b' },
      ],
      [
        {
          applicationId: 'approved-personal',
          applicationProgramId: 'program-a',
          milestoneId: 'milestone-a-1',
          milestoneProgramId: 'program-a',
          status: SubmissionStatus.SUBMITTED,
        },
        {
          applicationId: 'approved-personal',
          applicationProgramId: 'program-a',
          milestoneId: 'milestone-a-2',
          milestoneProgramId: 'program-a',
          status: SubmissionStatus.APPROVED,
        },
        {
          applicationId: 'approved-team',
          applicationProgramId: 'program-a',
          milestoneId: 'milestone-a-1',
          milestoneProgramId: 'program-a',
          status: SubmissionStatus.CHANGES_REQUESTED,
        },
        {
          applicationId: 'approved-team',
          applicationProgramId: 'program-a',
          milestoneId: 'milestone-a-2',
          milestoneProgramId: 'program-a',
          status: SubmissionStatus.REJECTED,
        },
        {
          applicationId: 'approved-other',
          applicationProgramId: 'program-b',
          milestoneId: 'milestone-b-1',
          milestoneProgramId: 'program-b',
          status: SubmissionStatus.SUBMITTED,
        },
      ],
    );
    const service = new SubmissionDashboardSummaryService(repository);

    // When
    const summaries = await service.listByProgram(['program-a', 'program-b']);

    // Then
    expect(repository.calls).toEqual([['program-a', 'program-b']]);
    expect(summaries).toEqual([
      {
        programId: 'program-a',
        approvedApplications: 2,
        milestones: 3,
        total: 6,
        notSubmitted: 2,
        submitted: 1,
        approved: 1,
        changesRequested: 1,
        rejected: 1,
      },
      {
        programId: 'program-b',
        approvedApplications: 1,
        milestones: 1,
        total: 1,
        notSubmitted: 0,
        submitted: 1,
        approved: 0,
        changesRequested: 0,
        rejected: 0,
      },
    ]);
  });

  it('keeps zero totals when applications or milestones are absent', async () => {
    // Given
    const repository = new FakeSubmissionDashboardSummaryRepository(
      [{ id: 'approved-without-milestone', programId: 'no-milestones' }],
      [{ id: 'milestone-without-application', programId: 'no-applications' }],
      [],
    );
    const service = new SubmissionDashboardSummaryService(repository);

    // When
    const summaries = await service.listByProgram([
      'empty',
      'no-milestones',
      'no-applications',
    ]);

    // Then
    expect(summaries).toEqual([
      emptySummary('empty'),
      { ...emptySummary('no-milestones'), approvedApplications: 1 },
      { ...emptySummary('no-applications'), milestones: 1 },
    ]);
  });

  it('ignores submissions outside same-program approved application cells', async () => {
    // Given
    const repository = new FakeSubmissionDashboardSummaryRepository(
      [{ id: 'approved-application', programId: 'program-a' }],
      [{ id: 'milestone-a', programId: 'program-a' }],
      [
        {
          applicationId: 'pending-application',
          applicationProgramId: 'program-a',
          milestoneId: 'milestone-a',
          milestoneProgramId: 'program-a',
          status: SubmissionStatus.APPROVED,
        },
        {
          applicationId: 'approved-application',
          applicationProgramId: 'program-a',
          milestoneId: 'foreign-milestone',
          milestoneProgramId: 'program-b',
          status: SubmissionStatus.REJECTED,
        },
      ],
    );
    const service = new SubmissionDashboardSummaryService(repository);

    // When
    const summaries = await service.listByProgram(['program-a']);

    // Then
    expect(summaries).toEqual([
      {
        ...emptySummary('program-a'),
        approvedApplications: 1,
        milestones: 1,
        total: 1,
        notSubmitted: 1,
      },
    ]);
  });
});

function emptySummary(programId: string) {
  return {
    programId,
    approvedApplications: 0,
    milestones: 0,
    total: 0,
    notSubmitted: 0,
    submitted: 0,
    approved: 0,
    changesRequested: 0,
    rejected: 0,
  };
}
