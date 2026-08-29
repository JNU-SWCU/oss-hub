import type { PrismaService } from '../prisma/prisma.service';
import { readProgramDeletionScopeCounts } from './program-deletion-scope';

describe('readProgramDeletionScopeCounts', () => {
  it('기존 제출과 신규 제출 항목 제출을 한 스냅샷에서 함께 센다', async () => {
    const queryRaw: jest.MockedFunction<
      (query: unknown) => Promise<
        readonly {
          applications: bigint;
          teams: bigint;
          boardPosts: bigint;
          submissions: bigint;
          submissionEvents: bigint;
          scopeFingerprint: string;
        }[]
      >
    > = jest.fn().mockResolvedValue([
      {
        applications: 1n,
        teams: 1n,
        boardPosts: 0n,
        submissions: 3n,
        submissionEvents: 7n,
        scopeFingerprint: '0123456789abcdef0123456789abcdef',
      },
    ]);
    const transaction = {
      $queryRaw: queryRaw,
    } as unknown as PrismaService;

    await expect(
      readProgramDeletionScopeCounts(transaction, 'synthetic-program'),
    ).resolves.toEqual({
      applications: 1,
      teams: 1,
      boardPosts: 0,
      submissions: 3,
      submissionEvents: 7,
      scopeFingerprint: '0123456789abcdef0123456789abcdef',
    });

    const query = queryRaw.mock.calls[0]?.[0] as
      { readonly strings?: readonly string[] } | undefined;
    const sql = query?.strings?.join('?') ?? '';
    expect(sql).toContain('FROM "Submission"');
    expect(sql).toContain('FROM "MilestoneDocumentSubmission"');
    expect(sql).toContain('FROM "MilestoneDocumentSubmissionHistory"');
    expect(sql).toContain('FROM "MilestoneDocumentReviewHistory"');
    expect(sql).toContain('FROM "SubmissionFile"');
    expect(sql).toContain('OR "milestoneDocumentSubmissionHistoryId" IN');
    expect(sql).toContain('FROM "BoardComment"');
    expect(sql).toContain('FROM "MilestoneDocumentTemplateFile"');
    expect(sql).toContain('FROM "TeamMember"');
    expect(sql).toContain('FROM "TeamInvitation"');
    expect(sql).toContain('FROM "ProgramAuthoringUpload"');
    expect(sql).toContain('AS "scopeFingerprint"');
    expect(sql).toMatch(/\)\s*\+\s*\(SELECT count\(\*\).*\)\s*AS submissions/s);
  });
});
