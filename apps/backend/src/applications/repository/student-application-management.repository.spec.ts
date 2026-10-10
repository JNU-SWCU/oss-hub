import { ApplicationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StudentApplicationManagementRepository } from './student-application-management.repository';

const NOW = new Date('2026-07-15T00:00:00.000Z');
const POLICY = {
  applicationStartAt: new Date('2026-07-01T00:00:00.000Z'),
  applicationEndAt: new Date('2026-07-31T23:59:59.000Z'),
  applicationTemplateVersion: 1,
};

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

      expect(lockedTables(transaction)).toEqual(['Program', 'Team']);
    },
  );

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
