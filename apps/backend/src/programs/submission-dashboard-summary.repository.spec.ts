import { ApplicationStatus, SubmissionStatus } from '@prisma/client';
import {
  type DashboardApplicationRow,
  type DashboardMilestoneRow,
  type DashboardDocumentSubmissionRow,
  type DashboardMilestoneDocumentRow,
  type SubmissionDashboardSummaryDataSource,
  SubmissionDashboardSummaryRepository,
} from './submission-dashboard-summary.repository';
class FakeFindManyDelegate<TArgs, TRow> {
  readonly calls: TArgs[] = [];
  constructor(private readonly rows: readonly TRow[]) {}
  findMany(args: TArgs): Promise<readonly TRow[]> {
    this.calls.push(args);
    return Promise.resolve(this.rows);
  }
}
describe('SubmissionDashboardSummaryRepository', () => {
  it('queries approved applications, milestones, and current submissions once for all programs', async () => {
    const applications = new FakeFindManyDelegate<
      Parameters<SubmissionDashboardSummaryDataSource['team']['findMany']>[0],
      DashboardApplicationRow
    >([
      { id: 'approved-team', programId: 'program-a' },
      { id: 'approved-team-team', programId: 'program-b' },
    ]);
    const milestones = new FakeFindManyDelegate<
      Parameters<
        SubmissionDashboardSummaryDataSource['milestone']['findMany']
      >[0],
      DashboardMilestoneRow
    >([
      {
        id: 'milestone-a',
        programId: 'program-a',
      },
      {
        id: 'milestone-b',
        programId: 'program-b',
      },
    ]);
    const milestoneDocuments = new FakeFindManyDelegate<
      Parameters<
        SubmissionDashboardSummaryDataSource['milestoneDocument']['findMany']
      >[0],
      DashboardMilestoneDocumentRow
    >([
      {
        id: 'document-a',
        milestoneId: 'milestone-a',
        milestone: { programId: 'program-a' },
      },
    ]);
    const documentSubmissions = new FakeFindManyDelegate<
      Parameters<
        SubmissionDashboardSummaryDataSource['milestoneDocumentSubmission']['findMany']
      >[0],
      DashboardDocumentSubmissionRow
    >([
      {
        teamId: 'approved-team',
        milestoneDocumentId: 'document-a',
        status: SubmissionStatus.APPROVED,
        team: { programId: 'program-a' },
        milestoneDocument: {
          milestoneId: 'milestone-a',
          milestone: { programId: 'program-a' },
        },
      },
      {
        teamId: 'approved-team',
        milestoneDocumentId: 'legacy-document-a',
        status: SubmissionStatus.SUBMITTED,
        team: { programId: 'program-a' },
        milestoneDocument: {
          milestoneId: 'milestone-a',
          milestone: { programId: 'program-a' },
        },
      },
    ]);
    const prisma = {
      team: applications,
      milestone: milestones,
      milestoneDocument: milestoneDocuments,
      milestoneDocumentSubmission: documentSubmissions,
    } satisfies SubmissionDashboardSummaryDataSource;
    const repository = new SubmissionDashboardSummaryRepository(prisma);
    const records = await repository.listRecords(['program-a', 'program-b']);
    expect(records).toEqual({
      applications: [
        { id: 'approved-team', programId: 'program-a' },
        { id: 'approved-team-team', programId: 'program-b' },
      ],
      milestones: [
        {
          id: 'milestone-a',
          programId: 'program-a',
        },
        {
          id: 'milestone-b',
          programId: 'program-b',
        },
      ],
      submissions: [],
      milestoneDocuments: [
        {
          id: 'document-a',
          milestoneId: 'milestone-a',
          milestoneProgramId: 'program-a',
        },
      ],
      documentSubmissions: [
        {
          teamId: 'approved-team',
          applicationProgramId: 'program-a',
          milestoneDocumentId: 'document-a',
          milestoneId: 'milestone-a',
          milestoneProgramId: 'program-a',
          status: SubmissionStatus.APPROVED,
        },
        {
          teamId: 'approved-team',
          applicationProgramId: 'program-a',
          milestoneDocumentId: 'legacy-document-a',
          milestoneId: 'milestone-a',
          milestoneProgramId: 'program-a',
          status: SubmissionStatus.SUBMITTED,
        },
      ],
    });
    expect(applications.calls).toHaveLength(1);
    expect(milestones.calls).toHaveLength(1);
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
    expect(milestoneDocuments.calls[0]).toEqual({
      where: {
        required: true,
        milestone: { is: { programId: { in: ['program-a', 'program-b'] } } },
      },
      select: {
        id: true,
        milestoneId: true,
        milestone: { select: { programId: true } },
      },
    });
    expect(documentSubmissions.calls[0]).toEqual({
      where: {
        team: {
          is: {
            programId: { in: ['program-a', 'program-b'] },
            status: ApplicationStatus.APPROVED,
          },
        },
        milestoneDocument: {
          is: {
            milestone: {
              is: { programId: { in: ['program-a', 'program-b'] } },
            },
            required: true,
          },
        },
      },
      select: {
        teamId: true,
        milestoneDocumentId: true,
        status: true,
        team: { select: { programId: true } },
        milestoneDocument: {
          select: {
            milestoneId: true,
            milestone: { select: { programId: true } },
          },
        },
      },
    });
  });
  it('returns empty records without database fan-out when no program ids are requested', async () => {
    const applications = new FakeFindManyDelegate<
      Parameters<SubmissionDashboardSummaryDataSource['team']['findMany']>[0],
      DashboardApplicationRow
    >([]);
    const milestones = new FakeFindManyDelegate<
      Parameters<
        SubmissionDashboardSummaryDataSource['milestone']['findMany']
      >[0],
      DashboardMilestoneRow
    >([]);
    const milestoneDocuments = new FakeFindManyDelegate<
      Parameters<
        SubmissionDashboardSummaryDataSource['milestoneDocument']['findMany']
      >[0],
      DashboardMilestoneDocumentRow
    >([]);
    const documentSubmissions = new FakeFindManyDelegate<
      Parameters<
        SubmissionDashboardSummaryDataSource['milestoneDocumentSubmission']['findMany']
      >[0],
      DashboardDocumentSubmissionRow
    >([]);
    const prisma = {
      team: applications,
      milestone: milestones,
      milestoneDocument: milestoneDocuments,
      milestoneDocumentSubmission: documentSubmissions,
    } satisfies SubmissionDashboardSummaryDataSource;
    const records = await new SubmissionDashboardSummaryRepository(
      prisma,
    ).listRecords([]);
    expect(records).toEqual({
      applications: [],
      milestones: [],
      submissions: [],
      milestoneDocuments: [],
      documentSubmissions: [],
    });
    expect(applications.calls).toHaveLength(0);
    expect(milestones.calls).toHaveLength(0);
    expect(milestoneDocuments.calls).toHaveLength(0);
    expect(documentSubmissions.calls).toHaveLength(0);
  });
});
