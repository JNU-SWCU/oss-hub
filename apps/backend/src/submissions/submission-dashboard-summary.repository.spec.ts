import {
  ApplicationStatus,
  MilestoneDocumentKind,
  MilestoneSubmissionType,
  SubmissionStatus,
} from '@prisma/client';
import {
  type DashboardApplicationRow,
  type DashboardMilestoneRow,
  type DashboardDocumentSubmissionRow,
  type DashboardMilestoneDocumentRow,
  type DashboardSubmissionRow,
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
      {
        id: 'milestone-a',
        programId: 'program-a',
        submissionType: MilestoneSubmissionType.FILE,
      },
      {
        id: 'milestone-b',
        programId: 'program-b',
        submissionType: MilestoneSubmissionType.FILE,
      },
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
        applicationId: 'approved-application',
        milestoneDocumentId: 'document-a',
        status: SubmissionStatus.APPROVED,
        application: { programId: 'program-a' },
        milestoneDocument: {
          milestoneId: 'milestone-a',
          milestone: { programId: 'program-a' },
        },
      },
    ]);
    const prisma = {
      application: applications,
      milestone: milestones,
      submission: submissions,
      milestoneDocument: milestoneDocuments,
      milestoneDocumentSubmission: documentSubmissions,
    } satisfies SubmissionDashboardSummaryDataSource;
    const repository = new SubmissionDashboardSummaryRepository(prisma);

    // When
    const records = await repository.listRecords(['program-a', 'program-b']);

    // Then
    expect(records).toEqual({
      applications: [
        { id: 'approved-application', programId: 'program-a' },
        { id: 'approved-team-application', programId: 'program-b' },
      ],
      milestones: [
        {
          id: 'milestone-a',
          programId: 'program-a',
          submissionType: MilestoneSubmissionType.FILE,
        },
        {
          id: 'milestone-b',
          programId: 'program-b',
          submissionType: MilestoneSubmissionType.FILE,
        },
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
      milestoneDocuments: [
        {
          id: 'document-a',
          milestoneId: 'milestone-a',
          milestoneProgramId: 'program-a',
        },
      ],
      documentSubmissions: [
        {
          applicationId: 'approved-application',
          applicationProgramId: 'program-a',
          milestoneDocumentId: 'document-a',
          milestoneId: 'milestone-a',
          milestoneProgramId: 'program-a',
          status: SubmissionStatus.APPROVED,
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
      select: { id: true, programId: true, submissionType: true },
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
    // ⚠ 필수 서류만 읽어야 한다 — 선택 서류가 섞이면 칸이 영영 미제출로 남는다.
    expect(milestoneDocuments.calls[0]).toEqual({
      where: {
        required: true,
        kind: MilestoneDocumentKind.DOCUMENT,
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
        application: {
          is: {
            programId: { in: ['program-a', 'program-b'] },
            status: ApplicationStatus.APPROVED,
          },
        },
        milestoneDocument: {
          is: {
            required: true,
            milestone: {
              is: { programId: { in: ['program-a', 'program-b'] } },
            },
          },
        },
      },
      select: {
        applicationId: true,
        milestoneDocumentId: true,
        status: true,
        application: { select: { programId: true } },
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
      application: applications,
      milestone: milestones,
      submission: submissions,
      milestoneDocument: milestoneDocuments,
      milestoneDocumentSubmission: documentSubmissions,
    } satisfies SubmissionDashboardSummaryDataSource;

    // When
    const records = await new SubmissionDashboardSummaryRepository(
      prisma,
    ).listRecords([]);

    // Then
    expect(records).toEqual({
      applications: [],
      milestones: [],
      submissions: [],
      milestoneDocuments: [],
      documentSubmissions: [],
    });
    expect(applications.calls).toHaveLength(0);
    expect(milestones.calls).toHaveLength(0);
    expect(submissions.calls).toHaveLength(0);
    expect(milestoneDocuments.calls).toHaveLength(0);
    expect(documentSubmissions.calls).toHaveLength(0);
  });
});
