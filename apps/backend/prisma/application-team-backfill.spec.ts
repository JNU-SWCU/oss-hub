import { Prisma } from '@prisma/client';
import {
  APPLICATION_TEAM_BACKFILL_ERROR_KIND,
  backfillApplicationTeams,
  buildSoloTeamName,
  isJoinCodeDigestUniqueConflict,
  JOIN_CODE_ATTEMPTS,
  type ApplicationTeamBackfillDeps,
} from './application-team-backfill';

function uniqueConflict(
  target: string | string[],
): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target },
  });
}

describe('buildSoloTeamName', () => {
  it('프로필 이름을 최우선으로 쓴다', () => {
    expect(
      buildSoloTeamName({
        id: 'user-1',
        name: '레거시이름',
        nickname: 'nick',
        profile: { name: '홍길동' },
      }),
    ).toBe('홍길동의 팀');
  });

  it('프로필이 없으면 User.name 을 쓴다', () => {
    expect(
      buildSoloTeamName({
        id: 'user-1',
        name: '김철수',
        nickname: 'nick',
        profile: null,
      }),
    ).toBe('김철수의 팀');
  });

  it('이름 필드가 비면 nickname 을 쓴다', () => {
    expect(
      buildSoloTeamName({
        id: 'user-1',
        name: '   ',
        nickname: 'oss-student',
        profile: null,
      }),
    ).toBe('oss-student의 팀');
  });

  it('표시 가능한 이름이 없으면 id 기반 대체명을 쓴다', () => {
    expect(
      buildSoloTeamName({
        id: 'abcdefghijklmnop',
        name: null,
        nickname: '  ',
        profile: null,
      }),
    ).toBe('참가자 abcdefgh의 팀');
  });
});

describe('isJoinCodeDigestUniqueConflict', () => {
  it('joinCodeDigest target 의 P2002 만 true', () => {
    expect(
      isJoinCodeDigestUniqueConflict(uniqueConflict('joinCodeDigest')),
    ).toBe(true);
    expect(
      isJoinCodeDigestUniqueConflict(
        uniqueConflict(['Team_joinCodeDigest_key']),
      ),
    ).toBe(true);
    expect(
      isJoinCodeDigestUniqueConflict(uniqueConflict(['programId', 'userId'])),
    ).toBe(false);
    expect(isJoinCodeDigestUniqueConflict(new Error('other'))).toBe(false);
  });
});

type FakeApplication = {
  id: string;
  programId: string;
  applicantId: string;
  teamId: string | null;
  applicant: {
    id: string;
    name: string | null;
    nickname: string;
    profile: { name: string } | null;
  };
};

function buildFakePrisma(seed: {
  applications: FakeApplication[];
  existingDigests?: Set<string>;
  failMemberCreate?: boolean;
}) {
  const applications = new Map(
    seed.applications.map((row) => [row.id, { ...row }]),
  );
  const digests = seed.existingDigests ?? new Set<string>();
  const teams: Array<{
    id: string;
    programId: string;
    name: string;
    joinCodeDigest: string;
    leaderId: string;
  }> = [];
  const members: Array<{ teamId: string; programId: string; userId: string }> =
    [];

  let teamSeq = 0;

  const tx = {
    application: {
      findUnique: jest.fn(({ where: { id } }: { where: { id: string } }) => {
        const row = applications.get(id);
        return row ? { teamId: row.teamId } : null;
      }),
      update: jest.fn(
        ({
          where: { id },
          data: { teamId },
        }: {
          where: { id: string };
          data: { teamId: string };
        }) => {
          const row = applications.get(id);
          if (!row) {
            throw new Error(`missing application ${id}`);
          }
          row.teamId = teamId;
          return row;
        },
      ),
    },
    team: {
      create: jest.fn(
        ({
          data,
        }: {
          data: {
            programId: string;
            name: string;
            joinCodeDigest: string;
            leaderId: string;
          };
        }) => {
          if (digests.has(data.joinCodeDigest)) {
            throw uniqueConflict('joinCodeDigest');
          }
          digests.add(data.joinCodeDigest);
          teamSeq += 1;
          const id = `team-${teamSeq}`;
          teams.push({ id, ...data });
          return { id };
        },
      ),
    },
    teamMember: {
      create: jest.fn(
        ({
          data,
        }: {
          data: { teamId: string; programId: string; userId: string };
        }) => {
          if (seed.failMemberCreate) {
            throw uniqueConflict(['programId', 'userId']);
          }
          members.push(data);
          return data;
        },
      ),
    },
  };

  const prisma = {
    application: {
      findMany: jest.fn(() =>
        [...applications.values()]
          .filter((row) => row.teamId === null)
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((row) => ({
            id: row.id,
            programId: row.programId,
            applicantId: row.applicantId,
            applicant: row.applicant,
          })),
      ),
      findUnique: jest.fn(({ where: { id } }: { where: { id: string } }) => {
        const row = applications.get(id);
        return row ? { teamId: row.teamId } : null;
      }),
      count: jest.fn(({ where: { teamId } }: { where: { teamId: null } }) => {
        void teamId;
        return [...applications.values()].filter((row) => row.teamId === null)
          .length;
      }),
    },
    $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<void>) =>
      fn(tx),
    ),
    _state: { applications, teams, members, digests, tx },
  };

  return prisma;
}

function buildDeps(
  overrides: Partial<ApplicationTeamBackfillDeps> & {
    readonly codes?: string[];
  } = {},
): ApplicationTeamBackfillDeps {
  const codes = overrides.codes ?? ['CODE000001'];
  let index = 0;
  return {
    generateJoinCode:
      overrides.generateJoinCode ??
      (() => {
        const code = codes[Math.min(index, codes.length - 1)] ?? 'FALLBACK01';
        index += 1;
        return code;
      }),
    computeJoinCodeDigest:
      overrides.computeJoinCodeDigest ??
      ((joinCode, secret) => `digest:${secret}:${joinCode}`),
    joinCodeSecret: overrides.joinCodeSecret ?? 'test-secret',
    joinCodeAttempts: overrides.joinCodeAttempts,
  };
}

describe('backfillApplicationTeams', () => {
  it('teamId 가 이미 있으면 건너뛴다(멱등)', async () => {
    const prisma = buildFakePrisma({
      applications: [
        {
          id: 'app-linked',
          programId: 'prog-1',
          applicantId: 'user-1',
          teamId: 'existing-team',
          applicant: {
            id: 'user-1',
            name: '이미연결',
            nickname: 'linked',
            profile: null,
          },
        },
      ],
    });

    const result = await backfillApplicationTeams(prisma as never, buildDeps());

    expect(result).toEqual({ processed: 0, skipped: 0, created: 0 });
    expect(prisma._state.teams).toHaveLength(0);
  });

  it('NULL teamId 신청에 1인 팀을 만들고 Application 을 연결한다', async () => {
    const prisma = buildFakePrisma({
      applications: [
        {
          id: 'app-1',
          programId: 'prog-1',
          applicantId: 'user-1',
          teamId: null,
          applicant: {
            id: 'user-1',
            name: null,
            nickname: 'student-a',
            profile: { name: '이영희' },
          },
        },
      ],
    });

    const result = await backfillApplicationTeams(
      prisma as never,
      buildDeps({ codes: ['JOINCODE01'] }),
    );

    expect(result).toEqual({ processed: 1, skipped: 0, created: 1 });
    expect(prisma._state.teams).toEqual([
      {
        id: 'team-1',
        programId: 'prog-1',
        name: '이영희의 팀',
        joinCodeDigest: 'digest:test-secret:JOINCODE01',
        leaderId: 'user-1',
      },
    ]);
    expect(prisma._state.members).toEqual([
      { teamId: 'team-1', programId: 'prog-1', userId: 'user-1' },
    ]);
    expect(prisma._state.applications.get('app-1')?.teamId).toBe('team-1');
  });

  it('joinCodeDigest 충돌 시 재시도하고 성공한다', async () => {
    const prisma = buildFakePrisma({
      applications: [
        {
          id: 'app-1',
          programId: 'prog-1',
          applicantId: 'user-1',
          teamId: null,
          applicant: {
            id: 'user-1',
            name: '충돌테스트',
            nickname: 'c',
            profile: null,
          },
        },
      ],
      existingDigests: new Set(['digest:test-secret:TAKEN00001']),
    });

    const result = await backfillApplicationTeams(
      prisma as never,
      buildDeps({ codes: ['TAKEN00001', 'FRESH00002'] }),
    );

    expect(result.created).toBe(1);
    expect(prisma._state.teams[0]?.joinCodeDigest).toBe(
      'digest:test-secret:FRESH00002',
    );
    expect(prisma._state.tx.team.create).toHaveBeenCalledTimes(2);
  });

  it('재시도 한도를 넘기면 JOIN_CODE_RETRIES_EXHAUSTED 로 실패한다', async () => {
    const prisma = buildFakePrisma({
      applications: [
        {
          id: 'app-1',
          programId: 'prog-1',
          applicantId: 'user-1',
          teamId: null,
          applicant: {
            id: 'user-1',
            name: '한도초과',
            nickname: 'x',
            profile: null,
          },
        },
      ],
      existingDigests: new Set([
        'digest:test-secret:A',
        'digest:test-secret:B',
      ]),
    });

    await expect(
      backfillApplicationTeams(
        prisma as never,
        buildDeps({
          codes: ['A', 'B', 'A', 'B', 'A'],
          joinCodeAttempts: 2,
        }),
      ),
    ).rejects.toMatchObject({
      kind: APPLICATION_TEAM_BACKFILL_ERROR_KIND.JOIN_CODE_RETRIES_EXHAUSTED,
      applicationId: 'app-1',
    });
    expect(JOIN_CODE_ATTEMPTS).toBe(5);
  });

  it('TeamMember unique 충돌은 MEMBERSHIP_CONFLICT 로 실패한다', async () => {
    const prisma = buildFakePrisma({
      applications: [
        {
          id: 'app-1',
          programId: 'prog-1',
          applicantId: 'user-1',
          teamId: null,
          applicant: {
            id: 'user-1',
            name: '멤버충돌',
            nickname: 'm',
            profile: null,
          },
        },
      ],
      failMemberCreate: true,
    });

    await expect(
      backfillApplicationTeams(prisma as never, buildDeps()),
    ).rejects.toMatchObject({
      kind: APPLICATION_TEAM_BACKFILL_ERROR_KIND.MEMBERSHIP_CONFLICT,
      applicationId: 'app-1',
    });
    expect(prisma._state.applications.get('app-1')?.teamId).toBeNull();
  });

  it('루프 후에도 NULL 이 남으면 REMAINING_NULL_TEAM 으로 실패한다', async () => {
    const prisma = buildFakePrisma({
      applications: [
        {
          id: 'app-1',
          programId: 'prog-1',
          applicantId: 'user-1',
          teamId: null,
          applicant: {
            id: 'user-1',
            name: '잔여',
            nickname: 'r',
            profile: null,
          },
        },
      ],
    });
    // Simulate a writer that never links teamId despite create succeeding.
    prisma._state.tx.application.update.mockImplementation(
      ({
        where: { id },
      }: {
        where: { id: string };
        data: { teamId: string };
      }) => {
        const row = prisma._state.applications.get(id);
        if (!row) {
          throw new Error(`missing application ${id}`);
        }
        // Intentionally leave teamId null so the final remaining-count guard fires.
        return row;
      },
    );

    await expect(
      backfillApplicationTeams(prisma as never, buildDeps()),
    ).rejects.toMatchObject({
      kind: APPLICATION_TEAM_BACKFILL_ERROR_KIND.REMAINING_NULL_TEAM,
    });
  });
});
