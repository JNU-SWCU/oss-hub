import type { PrismaService } from '../platform/prisma.service';
import { ProgramDeletionScopeRepository } from './programs.repository';

describe('readProgramDeletionScopeCounts', () => {
  it('target 제출 원장만 한 스냅샷에서 센다', async () => {
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
        submissions: 2n,
        submissionEvents: 7n,
        scopeFingerprint: '0123456789abcdef0123456789abcdef',
      },
    ]);
    const transaction = {
      $queryRaw: queryRaw,
    } as unknown as PrismaService;

    await expect(
      new ProgramDeletionScopeRepository().readProgramDeletionScopeCounts(
        transaction,
        'synthetic-program',
      ),
    ).resolves.toEqual({
      applications: 1,
      teams: 1,
      boardPosts: 0,
      submissions: 2,
      submissionEvents: 7,
      scopeFingerprint: '0123456789abcdef0123456789abcdef',
    });

    const query = queryRaw.mock.calls[0]?.[0] as
      { readonly strings?: readonly string[] } | undefined;
    const sql = query?.strings?.join('?') ?? '';
    expect(sql).toContain('FROM "Submission"');
    expect(sql).toContain('FROM "SubmissionHistory"');
    expect(sql).toContain('FROM "File" file');
    expect(sql).toContain('OR file."submissionHistoryId" IN');
    expect(sql).toContain('FROM "BoardComment"');
    expect(sql).toContain('FROM "TeamMember"');
    expect(sql).toContain('FROM "TeamInvitation"');
    expect(sql).toContain('AS "scopeFingerprint"');
    expect(sql).not.toContain('FROM "SubmissionRevision"');
    expect(sql).not.toContain('FROM "Review"');
  });
});
