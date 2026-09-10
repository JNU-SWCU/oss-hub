import { Prisma } from '@prisma/client';
import {
  SubmissionMembershipChangedError,
  lockSubmissionMembership,
} from './submission-membership.repository';

const APPLICATION_ID = 'synthetic-application';
const PROGRAM_ID = 'synthetic-program';
const TEAM_ID = 'synthetic-team';
const MEMBER_ID = 'synthetic-member';
const LEADER_ID = 'synthetic-leader';
const DEPARTED_ID = 'synthetic-departed';

/**
 * #1269 — 잠금 앞에서 읽은 멤버십은 권한의 정본이 아니다. `lockSubmissionMembership`은
 * `Program` → `Team`을 FOR UPDATE로 잠근 **뒤에** 현재 `TeamMember` 사실을 되읽어야 하고,
 * `applicantId`·`leaderId`·`uploaderId` 같은 기록은 어떤 경우에도 권한이 되면 안 된다.
 */
type TeamState = Readonly<{
  leaderId: string;
  memberUserIds: readonly string[];
}>;

type Fixture = Readonly<{
  /** 신청서가 아예 없으면 null. */
  application?: Readonly<{
    programId: string;
    teamId: string;
    applicantId: string;
  }> | null;
  /** FOR UPDATE가 잠글 행이 남아 있는지. */
  programExists?: boolean;
  teamExists?: boolean;
  team?: TeamState;
}>;

function tableOf(sql: Prisma.Sql): string {
  return /FROM "(\w+)"/.exec(sql.sql)?.[1] ?? sql.sql;
}

/**
 * `where`가 정본 술어(`team.members.some.userId`)로만 판정하는지 확인하면서 실제 소속을
 * 평가한다. 술어가 기록 기반 절로 넓어지면 여기서 곧바로 깨진다.
 */
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
    { members?: { some?: { userId?: string } }; leaderId?: string } | undefined;
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
    // Given
    const { tx, order, findUnique, queryRaw } = buildHarness();

    // When
    const allowed = await lockSubmissionMembership(
      tx,
      APPLICATION_ID,
      MEMBER_ID,
    );

    // Then — 잠금 순서와 「잠금 뒤 판정」이 함께 고정된다.
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
    // Given
    const { tx, queryRaw } = buildHarness();

    // When
    await lockSubmissionMembership(tx, APPLICATION_ID, MEMBER_ID);

    // Then
    const lockedTables = queryRaw.mock.calls.map((call) => tableOf(call[0]));
    expect(lockedTables).toEqual(['Program', 'Team']);
  });

  it('신청서가 없으면 아무 행도 잠그지 않고 false 를 돌려준다', async () => {
    // Given
    const { tx, order, queryRaw } = buildHarness({ application: null });

    // When
    const allowed = await lockSubmissionMembership(
      tx,
      APPLICATION_ID,
      MEMBER_ID,
    );

    // Then
    expect(allowed).toBe(false);
    expect(queryRaw).not.toHaveBeenCalled();
    expect(order).toEqual(['read:coordinates']);
  });

  it('프로그램 행이 사라졌으면 팀을 잠그지 않고 false 를 돌려준다', async () => {
    // Given
    const { tx, order } = buildHarness({ programExists: false });

    // When
    const allowed = await lockSubmissionMembership(
      tx,
      APPLICATION_ID,
      MEMBER_ID,
    );

    // Then
    expect(allowed).toBe(false);
    expect(order).toEqual(['read:coordinates', 'lock:Program']);
  });

  it('팀 행이 사라졌으면 멤버십을 되읽지 않고 false 를 돌려준다', async () => {
    // Given
    const { tx, order, findFirst } = buildHarness({ teamExists: false });

    // When
    const allowed = await lockSubmissionMembership(
      tx,
      APPLICATION_ID,
      MEMBER_ID,
    );

    // Then
    expect(allowed).toBe(false);
    expect(findFirst).not.toHaveBeenCalled();
    expect(order).toEqual(['read:coordinates', 'lock:Program', 'lock:Team']);
  });

  it('잠금 앞에서는 구성원이었어도 잠금 뒤 소속이 없으면 false 를 돌려준다', async () => {
    // Given — 인가와 저장 사이에 탈퇴·제외가 커밋된 경합.
    const { tx } = buildHarness({
      team: { leaderId: LEADER_ID, memberUserIds: [LEADER_ID] },
    });

    // When
    const allowed = await lockSubmissionMembership(
      tx,
      APPLICATION_ID,
      MEMBER_ID,
    );

    // Then
    expect(allowed).toBe(false);
  });

  it('팀을 떠난 최초 신청자에게는 false 를 돌려준다 — applicantId 는 기록이다', async () => {
    // Given
    const { tx } = buildHarness({
      application: {
        programId: PROGRAM_ID,
        teamId: TEAM_ID,
        applicantId: DEPARTED_ID,
      },
      team: { leaderId: LEADER_ID, memberUserIds: [LEADER_ID, MEMBER_ID] },
    });

    // When
    const allowed = await lockSubmissionMembership(
      tx,
      APPLICATION_ID,
      DEPARTED_ID,
    );

    // Then
    expect(allowed).toBe(false);
  });

  it('TeamMember 행이 없는 팀장 자리만으로는 false 를 돌려준다', async () => {
    // Given — 백필 등으로 leaderId 만 남은 상태.
    const { tx } = buildHarness({
      team: { leaderId: LEADER_ID, memberUserIds: [MEMBER_ID] },
    });

    // When
    const allowed = await lockSubmissionMembership(
      tx,
      APPLICATION_ID,
      LEADER_ID,
    );

    // Then
    expect(allowed).toBe(false);
  });

  it('잠금 실패는 삼키지 않고 그대로 전파한다', async () => {
    // Given — 직렬화 충돌 재시도는 상위 트랜잭션의 몫이다.
    const { tx, queryRaw, findFirst } = buildHarness();
    const failure = new Error('could not serialize access');
    queryRaw.mockImplementationOnce(() => Promise.reject(failure));

    // When / Then
    await expect(
      lockSubmissionMembership(tx, APPLICATION_ID, MEMBER_ID),
    ).rejects.toBe(failure);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('멤버십 되읽기 실패도 그대로 전파한다', async () => {
    // Given
    const { tx, findFirst } = buildHarness();
    const failure = new Error('connection closed');
    findFirst.mockImplementationOnce(() => Promise.reject(failure));

    // When / Then
    await expect(
      lockSubmissionMembership(tx, APPLICATION_ID, MEMBER_ID),
    ).rejects.toBe(failure);
  });
});

describe('SubmissionMembershipChangedError', () => {
  it('소비자가 NOT_APPLICATION_MEMBER 로 매핑할 수 있게 맥락을 담는다', () => {
    // Given / When
    const error = new SubmissionMembershipChangedError(
      APPLICATION_ID,
      DEPARTED_ID,
    );

    // Then
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('SubmissionMembershipChangedError');
    expect(error.applicationId).toBe(APPLICATION_ID);
    expect(error.userId).toBe(DEPARTED_ID);
  });
});
