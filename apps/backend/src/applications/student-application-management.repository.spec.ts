import { ApplicationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StudentApplicationManagementRepository } from './student-application-management.repository';

const NOW = new Date('2026-07-15T00:00:00.000Z');
const POLICY = {
  applicationStartAt: new Date('2026-07-01T00:00:00.000Z'),
  applicationEndAt: new Date('2026-07-31T23:59:59.000Z'),
  applicationTemplateVersion: 1,
};
/**
 * 행위자(`student-1`)는 신청자가 **아니다.** 신청자는 `applicant-1`이고 지금 팀장은 행위자다 —
 * 신청 뒤 팀장 승계가 일어난 팀의 모습이다. 권한이 `applicantId`가 아니라 현재 팀 소속·팀장에서
 * 나온다는 것이 이 파일이 고정하는 것이다.
 */
const APPLICATION = {
  id: 'application-1',
  programId: 'program-1',
  status: ApplicationStatus.SUBMITTED,
  teamId: 'team-1',
  team: { leaderId: 'student-1' },
  applicant: {
    id: 'applicant-1',
    nickname: 'applicant',
    profile: { name: 'Applicant' },
  },
  answers: {
    applicantName: 'Applicant',
    title: 'Original title',
    summary: 'Original summary',
  },
  submittedAt: NOW,
  updatedAt: NOW,
  isRepositoryPublicationPlanned: true,
  rejectionReason: null,
};

const MEMBERSHIP_WHERE = {
  team: { members: { some: { userId: 'student-1' } } },
};
const MANAGER_WHERE = {
  team: {
    leaderId: 'student-1',
    members: { some: { userId: 'student-1' } },
  },
};

describe('StudentApplicationManagementRepository', () => {
  /**
   * 읽기 범위는 **지금 그 팀에 속한 사람**이다. `applicantId` 절이나 멤버십 없는 `leaderId`
   * 절을 남기면 팀을 떠난 원 신청자가 옛 팀의 답변·반려 사유를 계속 읽는다.
   */
  it('scopes the owner read path to current team membership only', async () => {
    const findFirst = jest.fn().mockResolvedValue(APPLICATION);
    const repository = new StudentApplicationManagementRepository(
      createPrisma({ application: { findFirst } }),
      () => NOW,
    );

    await repository.findOwnedApplication('program-1', 'student-1');

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { programId: 'program-1', ...MEMBERSHIP_WHERE },
      }),
    );
    const where = firstWhere(findFirst);
    expect(where).not.toHaveProperty('OR');
    expect(JSON.stringify(where)).not.toContain('applicantId');
  });

  /**
   * 사유는 `Application.rejectionReason`에만 있고 알림·감사 로그에는 담지 않는다
   * (`audit-log/audit-log-metadata.ts`). select가 빠뜨리면 학생에게 닿을 길이 없다(#722).
   */
  it('selects the rejection reason on the owner read path', async () => {
    const findFirst = jest.fn().mockResolvedValue(APPLICATION);
    const repository = new StudentApplicationManagementRepository(
      createPrisma({ application: { findFirst } }),
      () => NOW,
    );

    const result = await repository.findOwnedApplication(
      'program-1',
      'student-1',
    );

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ rejectionReason: true }) as unknown,
      }),
    );
    expect(result).toHaveProperty('rejectionReason', null);
  });

  it('carries a stored rejection reason out of the owner read path', async () => {
    const findFirst = jest
      .fn()
      .mockResolvedValue({ ...APPLICATION, rejectionReason: '합성 반려 사유' });
    const repository = new StudentApplicationManagementRepository(
      createPrisma({ application: { findFirst } }),
      () => NOW,
    );

    const result = await repository.findOwnedApplication(
      'program-1',
      'student-1',
    );

    expect(result?.rejectionReason).toBe('합성 반려 사유');
  });

  /**
   * 원 신청자 정보는 **표시용으로 계속 실린다.** 권한에서 빼는 것과 기록을 지우는 것은
   * 다른 이야기다 — 답변의 `applicantName`이 이 값으로 보정된다.
   */
  it('keeps the original applicant on the read record while scoping by membership', async () => {
    const findFirst = jest.fn().mockResolvedValue(APPLICATION);
    const repository = new StudentApplicationManagementRepository(
      createPrisma({ application: { findFirst } }),
      () => NOW,
    );

    const result = await repository.findOwnedApplication(
      'program-1',
      'student-1',
    );

    expect(result?.applicant).toEqual({
      id: 'applicant-1',
      name: 'Applicant',
      nickname: 'applicant',
    });
    expect(result?.teamLeaderId).toBe('student-1');
  });

  /**
   * ⚠ 쓰기는 읽기보다 좁다 — 위 읽기 범위는 **읽기만** 정당화한다(#1083).
   * 같은 조건을 재사용하면 팀원 아무나 팀 전체의 신청을 고치거나 되돌릴 수 없게
   * 지운다(하드 삭제라 복구 경로가 없다).
   * `leaderId`와 멤버십을 **함께** 요구하는 것도 요점이다 — 승계는 두 곳을 함께 옮기므로
   * 한쪽만 보는 조건은 그 사이 상태에서 갈린다.
   */
  it.each(['update', 'delete'] as const)(
    'scopes the %s path to the current team leader only',
    async (operation) => {
      const findFirst = jest
        .fn()
        .mockResolvedValueOnce({ id: APPLICATION.id })
        .mockResolvedValueOnce(APPLICATION);
      const transaction = createTransaction({
        application: {
          findFirst,
          update: jest.fn().mockResolvedValue(APPLICATION),
        },
      });
      const repository = new StudentApplicationManagementRepository(
        createPrisma({ transaction }),
        () => NOW,
      );

      await run(repository, operation);

      const calls = whereCalls(findFirst);
      expect(calls).not.toHaveLength(0);
      for (const where of calls) {
        expect(where).toMatchObject(MANAGER_WHERE);
        expect(where).not.toHaveProperty('OR');
        expect(JSON.stringify(where)).not.toContain('applicantId');
      }
    },
  );

  /**
   * 잠금 순서는 `Program` → `Team` → `Application`이다. 신청 생성·초대 수락·탈퇴·제외가
   * 모두 `Team` 행을 먼저 잡으므로, 이 경로만 `Application`을 먼저 잡으면 순서가 갈려
   * 교착이 된다.
   */
  it.each(['update', 'delete'] as const)(
    'locks Program then Team then Application on the %s path',
    async (operation) => {
      const transaction = createTransaction({
        application: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce({ id: APPLICATION.id })
            .mockResolvedValueOnce(APPLICATION),
          update: jest.fn().mockResolvedValue(APPLICATION),
        },
      });
      const repository = new StudentApplicationManagementRepository(
        createPrisma({ transaction }),
        () => NOW,
      );

      await run(repository, operation);

      expect(lockedTables(transaction)).toEqual([
        'Program',
        'Team',
        'Application',
      ]);
    },
  );

  /**
   * 팀 행을 잡기 **전에** 읽은 소속은 낡을 수 있다. 잠금 뒤에 다시 읽지 않으면 기다리는
   * 사이에 커밋된 제외·승계를 못 보고 지나간다.
   */
  it('re-reads the membership after the Team lock, not before it', async () => {
    const order: string[] = [];
    const membershipFindUnique = jest.fn(() => {
      order.push('membership');
      return Promise.resolve({
        teamId: 'team-1',
        team: { leaderId: 'student-1' },
      });
    });
    const transaction = createTransaction({
      teamMember: { findUnique: membershipFindUnique },
      application: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ id: APPLICATION.id })
          .mockResolvedValueOnce(APPLICATION),
        update: jest.fn().mockResolvedValue(APPLICATION),
      },
    });
    transaction.$queryRaw.mockImplementation(
      (strings: { readonly raw: readonly string[] }) => {
        order.push(`lock:${tableOf(strings)}`);
        return Promise.resolve([{ id: 'locked' }]);
      },
    );
    const repository = new StudentApplicationManagementRepository(
      createPrisma({ transaction }),
      () => NOW,
    );

    await repository.updatePendingApplication({
      programId: 'program-1',
      studentId: 'student-1',
      answers: { title: 'Updated', summary: 'Updated' },
      applicationTemplateVersion: 1,
    });

    expect(order).toEqual([
      'lock:Program',
      'membership',
      'lock:Team',
      'membership',
      'lock:Application',
    ]);
  });

  /**
   * 팀을 떠난 사람은 그가 **원 신청자였더라도** 쓰지 못한다. 여기서 멈추지 않으면
   * `applicantId`가 다시 권한처럼 작동한다.
   */
  it.each(['update', 'delete'] as const)(
    'rejects the %s of a departed member who is still the historical applicant',
    async (operation) => {
      const applicationFindFirst = jest.fn();
      const transaction = createTransaction({
        teamMember: { findUnique: jest.fn().mockResolvedValue(null) },
        application: { findFirst: applicationFindFirst },
      });
      const repository = new StudentApplicationManagementRepository(
        createPrisma({ transaction }),
        () => NOW,
      );

      await expect(run(repository, operation)).resolves.toEqual({
        kind: 'application-not-found',
      });
      expect(applicationFindFirst).not.toHaveBeenCalled();
      expect(transaction.application.update).not.toHaveBeenCalled();
      expect(transaction.application.delete).not.toHaveBeenCalled();
      expect(lockedTables(transaction)).toEqual(['Program']);
    },
  );

  /**
   * 팀장 자리를 잃은 뒤에 잠금을 얻은 행위자는 거절된다 — 잠금 앞의 판정만 믿으면
   * 「내가 팀장일 때 보낸 요청」이 팀장이 아닌 시점에 커밋된다(TOCTOU).
   */
  it.each(['update', 'delete'] as const)(
    'rejects the %s when leadership moves away while the Team lock is awaited',
    async (operation) => {
      const membershipFindUnique = jest
        .fn()
        .mockResolvedValueOnce({ teamId: 'team-1' })
        .mockResolvedValueOnce({
          teamId: 'team-1',
          team: { leaderId: 'successor-1' },
        });
      const applicationFindFirst = jest.fn();
      const transaction = createTransaction({
        teamMember: { findUnique: membershipFindUnique },
        application: { findFirst: applicationFindFirst },
      });
      const repository = new StudentApplicationManagementRepository(
        createPrisma({ transaction }),
        () => NOW,
      );

      await expect(run(repository, operation)).resolves.toEqual({
        kind: 'application-not-found',
      });
      expect(applicationFindFirst).not.toHaveBeenCalled();
      expect(transaction.application.update).not.toHaveBeenCalled();
      expect(transaction.application.delete).not.toHaveBeenCalled();
      // Application 행은 잠그지 않는다 — 될 수 없는 요청이 남의 커밋을 세우지 않게 한다.
      expect(lockedTables(transaction)).toEqual(['Program', 'Team']);
    },
  );

  /** 제외당한 사람은 팀 자체가 바뀌어 있을 수도 있다 — 잠근 팀과 다르면 그대로 거절한다. */
  it.each(['update', 'delete'] as const)(
    'rejects the %s when the actor moved to another team under the lock',
    async (operation) => {
      const transaction = createTransaction({
        teamMember: {
          findUnique: jest
            .fn()
            .mockResolvedValueOnce({ teamId: 'team-1' })
            .mockResolvedValueOnce({
              teamId: 'team-2',
              team: { leaderId: 'student-1' },
            }),
        },
      });
      const repository = new StudentApplicationManagementRepository(
        createPrisma({ transaction }),
        () => NOW,
      );

      await expect(run(repository, operation)).resolves.toEqual({
        kind: 'application-not-found',
      });
      expect(transaction.application.update).not.toHaveBeenCalled();
      expect(transaction.application.delete).not.toHaveBeenCalled();
    },
  );

  it('locks and revalidates the program and owned application before updating', async () => {
    const update = jest.fn().mockResolvedValue(APPLICATION);
    const transaction = createTransaction({
      application: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ id: APPLICATION.id })
          .mockResolvedValueOnce(APPLICATION),
        update,
      },
    });
    const repository = new StudentApplicationManagementRepository(
      createPrisma({ transaction }),
      () => NOW,
    );

    const result = await repository.updatePendingApplication({
      programId: 'program-1',
      studentId: 'student-1',
      answers: { title: 'Updated', summary: 'Updated' },
      applicationTemplateVersion: 1,
    });

    expect(result).toMatchObject({ kind: 'updated' });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: APPLICATION.id },
        data: {
          answers: { title: 'Updated', summary: 'Updated' },
          applicationTemplateVersion: 1,
        },
      }),
    );
  });

  it('returns template-version-mismatch without writing when the form moved on', async () => {
    const transaction = createTransaction({
      application: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ id: APPLICATION.id })
          .mockResolvedValueOnce(APPLICATION),
        update: jest.fn(),
      },
    });
    const repository = new StudentApplicationManagementRepository(
      createPrisma({ transaction }),
      () => NOW,
    );

    await expect(
      repository.updatePendingApplication({
        programId: 'program-1',
        studentId: 'student-1',
        answers: { title: 'Updated', summary: 'Updated' },
        applicationTemplateVersion: 2,
      }),
    ).resolves.toEqual({ kind: 'template-version-mismatch' });
    expect(transaction.application.update).not.toHaveBeenCalled();
  });

  it('returns application-not-found when cancellation wins a race', async () => {
    const transaction = createTransaction({
      application: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    const repository = new StudentApplicationManagementRepository(
      createPrisma({ transaction }),
      () => NOW,
    );

    await expect(
      repository.updatePendingApplication({
        programId: 'program-1',
        studentId: 'student-1',
        answers: { title: 'Updated', summary: 'Updated' },
        applicationTemplateVersion: 1,
      }),
    ).resolves.toEqual({ kind: 'application-not-found' });
  });

  it('returns already-decided when approval wins a race', async () => {
    const transaction = createTransaction({
      application: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ id: APPLICATION.id })
          .mockResolvedValueOnce({
            ...APPLICATION,
            status: ApplicationStatus.APPROVED,
          }),
      },
    });
    const repository = new StudentApplicationManagementRepository(
      createPrisma({ transaction }),
      () => NOW,
    );

    await expect(
      repository.deletePendingApplication({
        programId: 'program-1',
        studentId: 'student-1',
      }),
    ).resolves.toEqual({ kind: 'already-decided' });
  });

  it('returns program-not-found when the program row is gone', async () => {
    const transaction = createTransaction();
    transaction.$queryRaw.mockResolvedValue([]);
    const repository = new StudentApplicationManagementRepository(
      createPrisma({ transaction }),
      () => NOW,
    );

    await expect(
      repository.deletePendingApplication({
        programId: 'program-1',
        studentId: 'student-1',
      }),
    ).resolves.toEqual({ kind: 'program-not-found' });
    expect(transaction.teamMember.findUnique).not.toHaveBeenCalled();
  });

  it.each(['update', 'delete'] as const)(
    'rejects %s after application lock wait crosses the deadline',
    async (operation) => {
      let releaseApplicationLock: (() => void) | undefined;
      const applicationLock = new Promise<readonly { id: string }[]>(
        (resolve) => {
          releaseApplicationLock = () => resolve([{ id: APPLICATION.id }]);
        },
      );
      let applicationLockRequested: (() => void) | undefined;
      const applicationLockReady = new Promise<void>((resolve) => {
        applicationLockRequested = resolve;
      });
      const transaction = createTransaction({
        application: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce({ id: APPLICATION.id })
            .mockResolvedValueOnce(APPLICATION),
          update: jest.fn().mockResolvedValue(APPLICATION),
        },
      });
      transaction.$queryRaw.mockImplementation(
        (strings: { readonly raw: readonly string[] }) => {
          if (tableOf(strings) === 'Application') {
            applicationLockRequested?.();
            return applicationLock;
          }
          return Promise.resolve([{ id: 'locked' }]);
        },
      );
      const clock = jest.fn(() => NOW);
      const repository = new StudentApplicationManagementRepository(
        createPrisma({ transaction }),
        clock,
      );

      const result = run(repository, operation);

      await applicationLockReady;
      clock.mockReturnValue(new Date('2026-08-01T00:00:00.000Z'));
      releaseApplicationLock?.();

      await expect(result).resolves.toEqual({ kind: 'period-closed' });
      expect(transaction.application.update).not.toHaveBeenCalled();
      expect(transaction.application.delete).not.toHaveBeenCalled();
    },
  );
});

type Transaction = ReturnType<typeof createTransaction>;

function run(
  repository: StudentApplicationManagementRepository,
  operation: 'update' | 'delete',
): Promise<unknown> {
  return operation === 'update'
    ? repository.updatePendingApplication({
        programId: 'program-1',
        studentId: 'student-1',
        answers: { title: 'Updated', summary: 'Updated' },
        applicationTemplateVersion: 1,
      })
    : repository.deletePendingApplication({
        programId: 'program-1',
        studentId: 'student-1',
      });
}

/** 태그드 템플릿의 정적 조각에서 `FOR UPDATE` 대상 table 이름을 뽑는다. */
function tableOf(strings: { readonly raw: readonly string[] }): string {
  const sql = strings.raw.join('');
  return /FROM "(\w+)"/.exec(sql)?.[1] ?? sql;
}

function lockedTables(transaction: Transaction): readonly string[] {
  const calls = transaction.$queryRaw.mock
    .calls as unknown as readonly (readonly [
    { readonly raw: readonly string[] },
  ])[];
  return calls.map((call) => tableOf(call[0]));
}

function whereCalls(findFirst: jest.Mock): readonly Record<string, unknown>[] {
  const calls = findFirst.mock.calls as unknown as readonly (readonly [
    { readonly where: Record<string, unknown> },
  ])[];
  return calls.map((call) => call[0].where);
}

function firstWhere(findFirst: jest.Mock): Record<string, unknown> {
  const where = whereCalls(findFirst)[0];
  if (where === undefined) {
    throw new Error('application.findFirst 가 호출되지 않았다');
  }
  return where;
}

function createTransaction(input?: {
  readonly teamMember?: { readonly findUnique?: jest.Mock };
  readonly application?: {
    readonly findFirst?: jest.Mock;
    readonly update?: jest.Mock;
    readonly delete?: jest.Mock;
  };
}) {
  return {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'locked' }]),
    program: { findUnique: jest.fn().mockResolvedValue(POLICY) },
    teamMember: {
      findUnique:
        input?.teamMember?.findUnique ??
        jest.fn().mockResolvedValue({
          teamId: 'team-1',
          team: { leaderId: 'student-1' },
        }),
    },
    application: {
      findFirst: input?.application?.findFirst ?? jest.fn(),
      update: input?.application?.update ?? jest.fn(),
      delete: input?.application?.delete ?? jest.fn(),
    },
  };
}

function createPrisma(input: {
  readonly application?: { readonly findFirst?: jest.Mock };
  readonly transaction?: Transaction;
}): PrismaService {
  const prisma = new PrismaService();
  const transaction = input.transaction ?? createTransaction();
  Object.defineProperties(prisma, {
    application: {
      value: { findFirst: input.application?.findFirst ?? jest.fn() },
    },
    $transaction: {
      value: (operation: (client: Transaction) => Promise<unknown>) =>
        operation(transaction),
    },
  });
  return prisma;
}
