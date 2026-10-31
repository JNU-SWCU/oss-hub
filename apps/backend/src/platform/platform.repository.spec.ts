import { Prisma } from '@prisma/client';
import { PlatformRepository } from './platform.repository';

describe('submission-membership-lock.repository', () => {
  const APPLICATION_ID = 'synthetic-application';
  const PROGRAM_ID = 'synthetic-program';
  const TEAM_ID = 'synthetic-team';
  const MEMBER_ID = 'synthetic-member';
  const LEADER_ID = 'synthetic-leader';
  const DEPARTED_ID = 'synthetic-departed';

  type TeamState = Readonly<{
    leaderId: string;
    memberUserIds: readonly string[];
  }>;

  type Fixture = Readonly<{
    application?: Readonly<{
      programId: string;
      teamId: string;
      applicantId: string;
    }> | null;

    programExists?: boolean;
    teamExists?: boolean;
    team?: TeamState;
  }>;

  function tableOf(sql: Prisma.Sql): string {
    return /FROM "(\w+)"/.exec(sql.sql)?.[1] ?? sql.sql;
  }

  function evaluateParticipantWhere(
    where: Prisma.ApplicationWhereInput,
    team: TeamState,
  ): boolean {
    const forbidden = ['applicantId', 'OR', 'uploaderId', 'submittedById'];
    for (const key of forbidden) {
      if (key in where) {
        throw new Error(`권한 술어에 기록 기반 절이 들어 있다: ${key}`);
      }
    }
    const teamWhere = where.team as unknown as
      | { members?: { some?: { userId?: string } }; leaderId?: string }
      | undefined;
    const candidateId = teamWhere?.members?.some?.userId;
    if (candidateId === undefined) {
      throw new Error('현재 TeamMember 술어 없이 권한을 판정했다');
    }
    if (teamWhere?.leaderId !== undefined) {
      throw new Error('팀장 자리를 권한으로 썼다');
    }
    return team.memberUserIds.includes(candidateId);
  }

  function buildHarness(fixture: Fixture = {}) {
    const application = fixture.application ?? {
      programId: PROGRAM_ID,
      teamId: TEAM_ID,
      applicantId: DEPARTED_ID,
    };
    const team = fixture.team ?? {
      leaderId: LEADER_ID,
      memberUserIds: [LEADER_ID, MEMBER_ID],
    };
    const order: string[] = [];

    const findUnique = jest.fn(
      (args: { where: { id: string }; select: unknown }) => {
        order.push('read:coordinates');
        if (fixture.application === null || args.where.id !== APPLICATION_ID) {
          return Promise.resolve(null);
        }
        return Promise.resolve({
          programId: application.programId,
          teamId: application.teamId,
        });
      },
    );

    const findFirst = jest.fn(
      (args: { where: Prisma.ApplicationWhereInput; select: unknown }) => {
        order.push('read:membership');
        const where = args.where;
        if ((where.id as unknown as string) !== APPLICATION_ID) {
          return Promise.resolve(null);
        }
        return Promise.resolve(
          evaluateParticipantWhere(where, team) ? { id: APPLICATION_ID } : null,
        );
      },
    );

    const queryRaw = jest.fn((sql: Prisma.Sql) => {
      const table = tableOf(sql);
      order.push(`lock:${table}`);
      if (!sql.sql.includes('FOR UPDATE')) {
        throw new Error(`${table} 잠금이 FOR UPDATE가 아니다`);
      }
      if (table === 'Program') {
        return Promise.resolve(
          fixture.programExists === false ? [] : [{ id: PROGRAM_ID }],
        );
      }
      if (table === 'Team') {
        return Promise.resolve(
          fixture.teamExists === false ? [] : [{ id: TEAM_ID }],
        );
      }
      throw new Error(`예상하지 못한 잠금 대상: ${table}`);
    });

    const tx = {
      application: { findUnique, findFirst },
      $queryRaw: queryRaw,
    } as unknown as Prisma.TransactionClient;

    return { tx, order, findUnique, findFirst, queryRaw };
  }

  describe('lockSubmissionMembership', () => {
    it('현재 팀 구성원이면 Program → Team 잠금 뒤 되읽은 사실로 true 를 돌려준다', async () => {
      const { tx, order, findUnique, queryRaw } = buildHarness();

      const allowed = await PlatformRepository.lockSubmissionMembership(
        tx,
        APPLICATION_ID,
        MEMBER_ID,
      );

      expect(allowed).toBe(true);
      expect(order).toEqual([
        'read:coordinates',
        'lock:Program',
        'lock:Team',
        'read:membership',
      ]);
      expect(findUnique).toHaveBeenCalledWith({
        where: { id: APPLICATION_ID },
        select: { programId: true, teamId: true },
      });
      const [programSql, teamSql] = queryRaw.mock.calls.map((call) => call[0]);
      expect(programSql?.values).toContain(PROGRAM_ID);
      expect(teamSql?.values).toContain(TEAM_ID);
    });

    it('User 행은 잠그지 않는다 — 잠금 순서를 뒤집을 여지를 남기지 않는다', async () => {
      const { tx, queryRaw } = buildHarness();

      await PlatformRepository.lockSubmissionMembership(
        tx,
        APPLICATION_ID,
        MEMBER_ID,
      );

      const lockedTables = queryRaw.mock.calls.map((call) => tableOf(call[0]));
      expect(lockedTables).toEqual(['Program', 'Team']);
    });

    it('신청서가 없으면 아무 행도 잠그지 않고 false 를 돌려준다', async () => {
      const { tx, order, queryRaw } = buildHarness({ application: null });

      const allowed = await PlatformRepository.lockSubmissionMembership(
        tx,
        APPLICATION_ID,
        MEMBER_ID,
      );

      expect(allowed).toBe(false);
      expect(queryRaw).not.toHaveBeenCalled();
      expect(order).toEqual(['read:coordinates']);
    });

    it('프로그램 행이 사라졌으면 팀을 잠그지 않고 false 를 돌려준다', async () => {
      const { tx, order } = buildHarness({ programExists: false });

      const allowed = await PlatformRepository.lockSubmissionMembership(
        tx,
        APPLICATION_ID,
        MEMBER_ID,
      );

      expect(allowed).toBe(false);
      expect(order).toEqual(['read:coordinates', 'lock:Program']);
    });

    it('팀 행이 사라졌으면 멤버십을 되읽지 않고 false 를 돌려준다', async () => {
      const { tx, order, findFirst } = buildHarness({ teamExists: false });

      const allowed = await PlatformRepository.lockSubmissionMembership(
        tx,
        APPLICATION_ID,
        MEMBER_ID,
      );

      expect(allowed).toBe(false);
      expect(findFirst).not.toHaveBeenCalled();
      expect(order).toEqual(['read:coordinates', 'lock:Program', 'lock:Team']);
    });

    it('잠금 앞에서는 구성원이었어도 잠금 뒤 소속이 없으면 false 를 돌려준다', async () => {
      const { tx } = buildHarness({
        team: { leaderId: LEADER_ID, memberUserIds: [LEADER_ID] },
      });

      const allowed = await PlatformRepository.lockSubmissionMembership(
        tx,
        APPLICATION_ID,
        MEMBER_ID,
      );

      expect(allowed).toBe(false);
    });

    it('팀을 떠난 최초 신청자에게는 false 를 돌려준다 — applicantId 는 기록이다', async () => {
      const { tx } = buildHarness({
        application: {
          programId: PROGRAM_ID,
          teamId: TEAM_ID,
          applicantId: DEPARTED_ID,
        },
        team: { leaderId: LEADER_ID, memberUserIds: [LEADER_ID, MEMBER_ID] },
      });

      const allowed = await PlatformRepository.lockSubmissionMembership(
        tx,
        APPLICATION_ID,
        DEPARTED_ID,
      );

      expect(allowed).toBe(false);
    });

    it('TeamMember 행이 없는 팀장 자리만으로는 false 를 돌려준다', async () => {
      const { tx } = buildHarness({
        team: { leaderId: LEADER_ID, memberUserIds: [MEMBER_ID] },
      });

      const allowed = await PlatformRepository.lockSubmissionMembership(
        tx,
        APPLICATION_ID,
        LEADER_ID,
      );

      expect(allowed).toBe(false);
    });

    it('잠금 실패는 삼키지 않고 그대로 전파한다', async () => {
      const { tx, queryRaw, findFirst } = buildHarness();
      const failure = new Error('could not serialize access');
      queryRaw.mockImplementationOnce(() => Promise.reject(failure));

      await expect(
        PlatformRepository.lockSubmissionMembership(
          tx,
          APPLICATION_ID,
          MEMBER_ID,
        ),
      ).rejects.toBe(failure);
      expect(findFirst).not.toHaveBeenCalled();
    });

    it('멤버십 되읽기 실패도 그대로 전파한다', async () => {
      const { tx, findFirst } = buildHarness();
      const failure = new Error('connection closed');
      findFirst.mockImplementationOnce(() => Promise.reject(failure));

      await expect(
        PlatformRepository.lockSubmissionMembership(
          tx,
          APPLICATION_ID,
          MEMBER_ID,
        ),
      ).rejects.toBe(failure);
    });
  });
});

describe('user-profile-write.repository', () => {
  function uniqueConstraintError(): Prisma.PrismaClientKnownRequestError {
    return new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      {
        code: 'P2002',
        clientVersion: '6.6.0',
      },
    );
  }

  describe('학번 최초 저장', () => {
    const userId = 'synthetic-user';
    const studentId = '153405';

    function harness(
      options: {
        readonly owner?: { readonly userId: string } | null;
        readonly updatedCount?: number;
        readonly updateError?: unknown;
      } = {},
    ) {
      const findUnique = jest.fn().mockResolvedValue(options.owner ?? null);
      const updateMany = options.updateError
        ? jest.fn().mockRejectedValue(options.updateError)
        : jest.fn().mockResolvedValue({ count: options.updatedCount ?? 1 });
      return {
        findUnique,
        updateMany,
        transaction: {
          userProfile: {
            create: jest.fn(),
            update: jest.fn(),
            upsert: jest.fn(),
            updateMany,
            findUnique,
          },
        },
      };
    }

    it('학번이 비어 있던 프로필에 제약 아래로 학번을 넣는다', async () => {
      const { transaction, updateMany } = harness();

      const outcome = await PlatformRepository.fillStudentIdIfEmpty(
        transaction,
        userId,
        studentId,
      );

      expect(outcome).toBe('filled');
      expect(updateMany).toHaveBeenCalledWith({
        where: { userId, studentId: null },
        data: { studentId },
      });
    });

    it('다른 계정이 그 학번을 쓰고 있으면 쓰지 않고 taken을 알린다', async () => {
      const { transaction, updateMany } = harness({
        owner: { userId: 'other-user' },
      });

      const outcome = await PlatformRepository.fillStudentIdIfEmpty(
        transaction,
        userId,
        studentId,
      );

      expect(outcome).toBe('taken');
      expect(updateMany).not.toHaveBeenCalled();
    });

    it('자기 자신이 이미 그 학번을 가지고 있으면 최초 저장이 아니다', async () => {
      const { transaction } = harness({ owner: { userId } });

      await expect(
        PlatformRepository.fillStudentIdIfEmpty(transaction, userId, studentId),
      ).resolves.toBe('conflict');
    });

    it('같은 계정을 다른 요청이 먼저 채웠으면 conflict로 멈춘다', async () => {
      const { transaction } = harness({ updatedCount: 0 });

      await expect(
        PlatformRepository.fillStudentIdIfEmpty(transaction, userId, studentId),
      ).resolves.toBe('conflict');
    });

    it('조회와 쓰기 사이에 끼어든 동시 저장은 제약이 잡아 taken이 된다', async () => {
      const { transaction } = harness({ updateError: uniqueConstraintError() });

      await expect(
        PlatformRepository.fillStudentIdIfEmpty(transaction, userId, studentId),
      ).resolves.toBe('taken');
    });

    it('unique 충돌이 아닌 오류는 그대로 던진다', async () => {
      const failure = new TypeError('synthetic profile update failure');
      const { transaction } = harness({ updateError: failure });

      await expect(
        PlatformRepository.fillStudentIdIfEmpty(transaction, userId, studentId),
      ).rejects.toBe(failure);
    });
  });
});
