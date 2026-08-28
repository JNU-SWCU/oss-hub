import { SubmissionStatus } from '@prisma/client';
import type {
  SubmissionDashboardApplicationRecord,
  SubmissionDashboardDocumentSubmissionRecord,
  SubmissionDashboardMilestoneDocumentRecord,
  SubmissionDashboardMilestoneRecord,
  SubmissionDashboardSubmissionRecord,
  SubmissionDashboardSummaryRepositoryPort,
} from './submission-dashboard-summary.repository';
import { SubmissionDashboardSummaryService } from './submission-dashboard-summary.service';

class FakeSubmissionDashboardSummaryRepository implements SubmissionDashboardSummaryRepositoryPort {
  readonly calls: string[][] = [];

  constructor(
    private readonly applications: readonly SubmissionDashboardApplicationRecord[],
    private readonly milestones: readonly SubmissionDashboardMilestoneRecord[],
    private readonly submissions: readonly SubmissionDashboardSubmissionRecord[],
    private readonly milestoneDocuments: readonly SubmissionDashboardMilestoneDocumentRecord[] = [],
    private readonly documentSubmissions: readonly SubmissionDashboardDocumentSubmissionRecord[] = [],
  ) {}

  listRecords(programIds: readonly string[]) {
    this.calls.push([...programIds]);
    return Promise.resolve({
      applications: this.applications,
      milestones: this.milestones,
      submissions: this.submissions,
      milestoneDocuments: this.milestoneDocuments,
      documentSubmissions: this.documentSubmissions,
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

  it('서류만 받는 마일스톤도 진행으로 센다 (#820)', async () => {
    // Given: 코드 제출이 없고 필수 서류 두 건만 있는 마일스톤. 한 팀은 둘 다 승인,
    // 다른 팀은 한 건만 승인하고 나머지는 아직 안 냈다.
    const repository = new FakeSubmissionDashboardSummaryRepository(
      [
        { id: 'team-done', programId: 'program-doc' },
        { id: 'team-partial', programId: 'program-doc' },
      ],
      [{ id: 'milestone-doc', programId: 'program-doc' }],
      [],
      [
        {
          id: 'doc-1',
          milestoneId: 'milestone-doc',
          milestoneProgramId: 'program-doc',
        },
        {
          id: 'doc-2',
          milestoneId: 'milestone-doc',
          milestoneProgramId: 'program-doc',
        },
      ],
      [
        documentSubmission(
          'team-done',
          'doc-1',
          SubmissionStatus.APPROVED,
          'program-doc',
          'milestone-doc',
        ),
        documentSubmission(
          'team-done',
          'doc-2',
          SubmissionStatus.APPROVED,
          'program-doc',
          'milestone-doc',
        ),
        documentSubmission(
          'team-partial',
          'doc-1',
          SubmissionStatus.APPROVED,
          'program-doc',
          'milestone-doc',
        ),
      ],
    );
    const service = new SubmissionDashboardSummaryService(repository);

    // When
    const summaries = await service.listByProgram(['program-doc']);

    // Then: 예전에는 Submission 행이 없어 두 칸 모두 미제출이었다.
    expect(summaries).toEqual([
      {
        programId: 'program-doc',
        approvedApplications: 2,
        milestones: 1,
        total: 2,
        notSubmitted: 1,
        submitted: 0,
        approved: 1,
        changesRequested: 0,
        rejected: 0,
      },
    ]);
  });

  it('서류가 다 승인이어도 코드 제출이 심사 중이면 승인으로 세지 않는다', async () => {
    // Given: 두 축이 다 쓰인 마일스톤.
    const repository = new FakeSubmissionDashboardSummaryRepository(
      [{ id: 'team-both', programId: 'program-both' }],
      [{ id: 'milestone-both', programId: 'program-both' }],
      [
        {
          applicationId: 'team-both',
          applicationProgramId: 'program-both',
          milestoneId: 'milestone-both',
          milestoneProgramId: 'program-both',
          status: SubmissionStatus.SUBMITTED,
        },
      ],
      [
        {
          id: 'doc-1',
          milestoneId: 'milestone-both',
          milestoneProgramId: 'program-both',
        },
      ],
      [
        documentSubmission(
          'team-both',
          'doc-1',
          SubmissionStatus.APPROVED,
          'program-both',
          'milestone-both',
        ),
      ],
    );
    const service = new SubmissionDashboardSummaryService(repository);

    // When
    const summaries = await service.listByProgram(['program-both']);

    // Then: 나쁜 쪽(심사 중)이 이긴다.
    expect(summaries[0]).toMatchObject({
      total: 1,
      approved: 0,
      submitted: 1,
      notSubmitted: 0,
    });
  });

  it('제출 축이 없는 안내용 마일스톤은 제출 현황 분모에서 제외한다', async () => {
    const repository = new FakeSubmissionDashboardSummaryRepository(
      [{ id: 'team-1', programId: 'program-info' }],
      [
        {
          id: 'milestone-info',
          programId: 'program-info',
          submissionType: null,
        },
      ],
      [],
    );
    const service = new SubmissionDashboardSummaryService(repository);

    await expect(service.listByProgram(['program-info'])).resolves.toEqual([
      {
        ...emptySummary('program-info'),
        approvedApplications: 1,
      },
    ]);
  });

  it('버킷 합은 언제나 total 과 같다', async () => {
    // Given: 두 축이 섞인 프로그램.
    const repository = new FakeSubmissionDashboardSummaryRepository(
      [
        { id: 'team-1', programId: 'p' },
        { id: 'team-2', programId: 'p' },
      ],
      [
        { id: 'm-code', programId: 'p' },
        { id: 'm-doc', programId: 'p' },
      ],
      [
        {
          applicationId: 'team-1',
          applicationProgramId: 'p',
          milestoneId: 'm-code',
          milestoneProgramId: 'p',
          status: SubmissionStatus.REJECTED,
        },
      ],
      [{ id: 'd-1', milestoneId: 'm-doc', milestoneProgramId: 'p' }],
      [
        documentSubmission(
          'team-2',
          'd-1',
          SubmissionStatus.APPROVED,
          'p',
          'm-doc',
        ),
      ],
    );
    const service = new SubmissionDashboardSummaryService(repository);

    // When
    const summaries = await service.listByProgram(['p']);
    const summary = summaries[0];
    if (summary === undefined) throw new Error('요약이 없다');

    // Then: 칸을 직접 돌기 때문에 어긋날 수 없다.
    expect(
      summary.notSubmitted +
        summary.submitted +
        summary.approved +
        summary.changesRequested +
        summary.rejected,
    ).toBe(summary.total);
    expect(summary.total).toBe(4);
  });
});

function documentSubmission(
  applicationId: string,
  milestoneDocumentId: string,
  status: SubmissionStatus,
  programId: string,
  milestoneId: string,
) {
  return {
    applicationId,
    applicationProgramId: programId,
    milestoneDocumentId,
    milestoneId,
    milestoneProgramId: programId,
    status,
  };
}

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
