import type { PrismaService } from '../prisma/prisma.service';
import { TEAM_PURGE_DELETION_ORDER } from './program-purge-deletion-matrix';
import {
  readTeamDeletionScopeCounts,
  sameTeamDeletionScopeCountValues,
  sameTeamDeletionScopeCounts,
  type TeamDeletionScopeCounts,
} from './team-deletion-scope';

const SCOPE: TeamDeletionScopeCounts = {
  applications: 1,
  members: 3,
  invitations: 2,
  submissions: 4,
  submissionEvents: 9,
  detachedRepositories: 1,
  scopeFingerprint: '0123456789abcdef0123456789abcdef',
};

function queryRawStub() {
  return jest.fn().mockResolvedValue([
    {
      applications: 1n,
      members: 3n,
      invitations: 2n,
      submissions: 4n,
      submissionEvents: 9n,
      detachedRepositories: 1n,
      scopeFingerprint: SCOPE.scopeFingerprint,
    },
  ]) as jest.MockedFunction<(query: unknown) => Promise<readonly unknown[]>>;
}

function capturedSql(queryRaw: ReturnType<typeof queryRawStub>): string {
  const query = queryRaw.mock.calls[0]?.[0] as
    { readonly strings?: readonly string[] } | undefined;
  return query?.strings?.join('?') ?? '';
}

describe('readTeamDeletionScopeCounts', () => {
  it('팀 하나의 범위만 한 스냅샷에서 세고 bigint 를 number 로 좁힌다', async () => {
    const queryRaw = queryRawStub();
    const transaction = { $queryRaw: queryRaw } as unknown as PrismaService;

    await expect(
      readTeamDeletionScopeCounts(transaction, 'synthetic-team'),
    ).resolves.toEqual(SCOPE);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('행이 없으면 0 으로 얼버무리지 않고 명시적으로 실패한다', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);
    const transaction = { $queryRaw: queryRaw } as unknown as PrismaService;

    await expect(
      readTeamDeletionScopeCounts(transaction, 'synthetic-team'),
    ).rejects.toThrow('Team deletion scope count query returned no result.');
  });

  /**
   * 세는 범위와 지우는 범위가 어긋나면 재확인이 통과한 뒤 사후 대조에서 터진다.
   * `TEAM_PURGE_DELETION_ORDER` 가 덮는 모델이 쿼리에 실제로 등장하는지 고정한다.
   */
  it('TEAM_PURGE_DELETION_ORDER 가 덮는 표를 모두 조회하고 프로그램 전용 표는 건드리지 않는다', async () => {
    const queryRaw = queryRawStub();
    const transaction = { $queryRaw: queryRaw } as unknown as PrismaService;
    await readTeamDeletionScopeCounts(transaction, 'synthetic-team');
    const sql = capturedSql(queryRaw);

    for (const table of [
      'Application',
      'TeamMember',
      'TeamInvitation',
      'MilestoneDocumentSubmission',
      'MilestoneDocumentSubmissionHistory',
      'MilestoneDocumentReviewHistory',
      'SubmissionFile',
      'RepositoryProvisionJob',
      'GithubRepository',
      'OutboxEvent',
      'Notification',
    ]) {
      expect(sql).toContain(`"${table}"`);
    }
    expect(sql).toContain('AS "scopeFingerprint"');

    // 프로그램에만 매달린 표는 팀 하나를 지운다고 세지 않는다.
    for (const programOnly of [
      '"BoardPost"',
      '"BoardComment"',
      '"Milestone"',
      '"MilestoneDocumentTemplateFile"',
      '"ProgramCreateRequest"',
      '"ProgramAuthoringUpload"',
      '"ProgramCover"',
    ]) {
      expect(sql).not.toContain(programOnly);
    }
  });

  it('DETACH 되는 저장소는 FK 상태까지 지문에 넣어 재연결·재발행을 범위 변경으로 본다', async () => {
    const queryRaw = queryRawStub();
    const transaction = { $queryRaw: queryRaw } as unknown as PrismaService;
    await readTeamDeletionScopeCounts(transaction, 'synthetic-team');
    const sql = capturedSql(queryRaw);

    expect(sql).toContain("'GithubRepository:'");
    expect(sql).toContain('repository."programId"');
    expect(sql).toContain('repository."applicationId"');
    expect(sql).toContain('repository."teamId"');
  });

  it('판정 알림은 payload.applicationId 로 이 팀의 신청에만 묶는다', async () => {
    const queryRaw = queryRawStub();
    const transaction = { $queryRaw: queryRaw } as unknown as PrismaService;
    await readTeamDeletionScopeCounts(transaction, 'synthetic-team');
    const sql = capturedSql(queryRaw);

    expect(sql).toContain("payload->>'applicationId'");
    // DEADLINE_DIGEST 는 프로그램 전 수신자에게 나가므로 팀 범위가 아니다.
    expect(sql).not.toContain('DEADLINE_DIGEST');
  });

  it('세는 축은 좁힌 삭제 순서가 실제로 지우는 축과 같은 이름을 쓴다', () => {
    const covered = TEAM_PURGE_DELETION_ORDER.flatMap((step) => step.covers);
    expect(covered).toContain('Team->Application');
    expect(covered).toContain('Team->TeamMember');
    expect(covered).toContain('Team->TeamInvitation');
    expect(Object.keys(SCOPE).sort()).toEqual([
      'applications',
      'detachedRepositories',
      'invitations',
      'members',
      'scopeFingerprint',
      'submissionEvents',
      'submissions',
    ]);
  });
});

describe('sameTeamDeletionScopeCounts', () => {
  it('지문이 다르면 수치가 같아도 다른 범위다 — 같은 수의 다른 행일 수 있다', () => {
    const swapped = { ...SCOPE, scopeFingerprint: 'f'.repeat(32) };
    expect(sameTeamDeletionScopeCounts(SCOPE, swapped)).toBe(false);
    expect(sameTeamDeletionScopeCountValues(SCOPE, swapped)).toBe(true);
  });

  it('수치가 하나라도 다르면 어긋난 것으로 본다', () => {
    for (const key of [
      'applications',
      'members',
      'invitations',
      'submissions',
      'submissionEvents',
      'detachedRepositories',
    ] as const) {
      expect(
        sameTeamDeletionScopeCounts(SCOPE, { ...SCOPE, [key]: SCOPE[key] + 1 }),
      ).toBe(false);
    }
  });

  it('같은 스냅샷은 같다', () => {
    expect(sameTeamDeletionScopeCounts(SCOPE, { ...SCOPE })).toBe(true);
  });
});
