import { SubmissionStatus } from '@prisma/client';
import type {
  SubmissionDashboardApplicationRecord,
  SubmissionDashboardDocumentSubmissionRecord,
  SubmissionDashboardMilestoneDocumentRecord,
  SubmissionDashboardMilestoneRecord,
  SubmissionDashboardSummaryRepositoryPort,
} from './submission-dashboard-summary.repository';
import { SubmissionDashboardSummaryService } from './submission-dashboard-summary.service';
import { MilestoneCompletionService } from './milestone-completion.service';
class FakeSubmissionDashboardSummaryRepository implements SubmissionDashboardSummaryRepositoryPort {
  readonly calls: string[][] = [];
  constructor(
    private readonly applications: readonly SubmissionDashboardApplicationRecord[],
    private readonly milestones: readonly SubmissionDashboardMilestoneRecord[],
    private readonly milestoneDocuments: readonly SubmissionDashboardMilestoneDocumentRecord[] = [],
    private readonly documentSubmissions: readonly SubmissionDashboardDocumentSubmissionRecord[] = [],
  ) {}
  listRecords(programIds: readonly string[]) {
    this.calls.push([...programIds]);
    return Promise.resolve({
      applications: this.applications,
      milestones: this.milestones,
      submissions: [],
      milestoneDocuments: this.milestoneDocuments,
      documentSubmissions: this.documentSubmissions,
    });
  }
}
describe('SubmissionDashboardSummaryService', () => {
  it('counts submission states across approved applications and milestones', async () => {
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
          id: 'milestone-a-1-item',
          milestoneId: 'milestone-a-1',
          milestoneProgramId: 'program-a',
        },
        {
          id: 'milestone-a-2-item',
          milestoneId: 'milestone-a-2',
          milestoneProgramId: 'program-a',
        },
        {
          id: 'milestone-a-3-item',
          milestoneId: 'milestone-a-3',
          milestoneProgramId: 'program-a',
        },
        {
          id: 'milestone-b-1-item',
          milestoneId: 'milestone-b-1',
          milestoneProgramId: 'program-b',
        },
      ],
      [
        {
          milestoneDocumentId: 'milestone-a-1-item',
          teamId: 'approved-personal',
          applicationProgramId: 'program-a',
          milestoneId: 'milestone-a-1',
          milestoneProgramId: 'program-a',
          status: SubmissionStatus.SUBMITTED,
        },
        {
          milestoneDocumentId: 'milestone-a-2-item',
          teamId: 'approved-personal',
          applicationProgramId: 'program-a',
          milestoneId: 'milestone-a-2',
          milestoneProgramId: 'program-a',
          status: SubmissionStatus.APPROVED,
        },
        {
          milestoneDocumentId: 'milestone-a-1-item',
          teamId: 'approved-team',
          applicationProgramId: 'program-a',
          milestoneId: 'milestone-a-1',
          milestoneProgramId: 'program-a',
          status: SubmissionStatus.CHANGES_REQUESTED,
        },
        {
          milestoneDocumentId: 'milestone-a-2-item',
          teamId: 'approved-team',
          applicationProgramId: 'program-a',
          milestoneId: 'milestone-a-2',
          milestoneProgramId: 'program-a',
          status: SubmissionStatus.REJECTED,
        },
        {
          milestoneDocumentId: 'milestone-b-1-item',
          teamId: 'approved-other',
          applicationProgramId: 'program-b',
          milestoneId: 'milestone-b-1',
          milestoneProgramId: 'program-b',
          status: SubmissionStatus.SUBMITTED,
        },
      ],
    );
    const service = new SubmissionDashboardSummaryService(
      repository,
      new MilestoneCompletionService(),
    );
    const summaries = await service.listByProgram(['program-a', 'program-b']);
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
    const repository = new FakeSubmissionDashboardSummaryRepository(
      [{ id: 'approved-without-milestone', programId: 'no-milestones' }],
      [
        {
          id: 'milestone-without-application',
          programId: 'no-applications',
        },
      ],
      [
        {
          id: 'milestone-without-application-item',
          milestoneId: 'milestone-without-application',
          milestoneProgramId: 'no-applications',
        },
      ],
      [],
    );
    const service = new SubmissionDashboardSummaryService(
      repository,
      new MilestoneCompletionService(),
    );
    const summaries = await service.listByProgram([
      'empty',
      'no-milestones',
      'no-applications',
    ]);
    expect(summaries).toEqual([
      emptySummary('empty'),
      { ...emptySummary('no-milestones'), approvedApplications: 1 },
      { ...emptySummary('no-applications'), milestones: 1 },
    ]);
  });
  it('ignores submissions outside same-program approved application cells', async () => {
    const repository = new FakeSubmissionDashboardSummaryRepository(
      [{ id: 'approved-application', programId: 'program-a' }],
      [{ id: 'milestone-a', programId: 'program-a' }],
      [
        {
          id: 'milestone-a-item',
          milestoneId: 'milestone-a',
          milestoneProgramId: 'program-a',
        },
      ],
      [
        {
          milestoneDocumentId: 'milestone-a-item',
          teamId: 'pending-application',
          applicationProgramId: 'program-a',
          milestoneId: 'milestone-a',
          milestoneProgramId: 'program-a',
          status: SubmissionStatus.APPROVED,
        },
        {
          milestoneDocumentId: 'foreign-milestone-item',
          teamId: 'approved-application',
          applicationProgramId: 'program-a',
          milestoneId: 'foreign-milestone',
          milestoneProgramId: 'program-b',
          status: SubmissionStatus.REJECTED,
        },
      ],
    );
    const service = new SubmissionDashboardSummaryService(
      repository,
      new MilestoneCompletionService(),
    );
    const summaries = await service.listByProgram(['program-a']);
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
    const repository = new FakeSubmissionDashboardSummaryRepository(
      [
        { id: 'team-done', programId: 'program-doc' },
        { id: 'team-partial', programId: 'program-doc' },
      ],
      [{ id: 'milestone-doc', programId: 'program-doc' }],
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
    const service = new SubmissionDashboardSummaryService(
      repository,
      new MilestoneCompletionService(),
    );
    const summaries = await service.listByProgram(['program-doc']);
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
    const repository = new FakeSubmissionDashboardSummaryRepository(
      [{ id: 'team-both', programId: 'program-both' }],
      [
        {
          id: 'milestone-both',
          programId: 'program-both',
        },
      ],
      [
        {
          id: 'milestone-both-item',
          milestoneId: 'milestone-both',
          milestoneProgramId: 'program-both',
        },
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
        {
          milestoneDocumentId: 'milestone-both-item',
          teamId: 'team-both',
          applicationProgramId: 'program-both',
          milestoneId: 'milestone-both',
          milestoneProgramId: 'program-both',
          status: SubmissionStatus.SUBMITTED,
        },
      ],
    );
    const service = new SubmissionDashboardSummaryService(
      repository,
      new MilestoneCompletionService(),
    );
    const summaries = await service.listByProgram(['program-both']);
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
        },
      ],
      [],
      [],
    );
    const service = new SubmissionDashboardSummaryService(
      repository,
      new MilestoneCompletionService(),
    );
    await expect(service.listByProgram(['program-info'])).resolves.toEqual([
      {
        ...emptySummary('program-info'),
        approvedApplications: 1,
      },
    ]);
  });
  it('버킷 합은 언제나 total 과 같다', async () => {
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
        { id: 'd-1', milestoneId: 'm-doc', milestoneProgramId: 'p' },
        { id: 'm-code-item', milestoneId: 'm-code', milestoneProgramId: 'p' },
      ],
      [
        documentSubmission(
          'team-2',
          'd-1',
          SubmissionStatus.APPROVED,
          'p',
          'm-doc',
        ),
        {
          milestoneDocumentId: 'm-code-item',
          teamId: 'team-1',
          applicationProgramId: 'p',
          milestoneId: 'm-code',
          milestoneProgramId: 'p',
          status: SubmissionStatus.REJECTED,
        },
      ],
    );
    const service = new SubmissionDashboardSummaryService(
      repository,
      new MilestoneCompletionService(),
    );
    const summaries = await service.listByProgram(['p']);
    const summary = summaries[0];
    if (summary === undefined) throw new Error('요약이 없다');
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
  teamId: string,
  milestoneDocumentId: string,
  status: SubmissionStatus,
  programId: string,
  milestoneId: string,
) {
  return {
    teamId,
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
