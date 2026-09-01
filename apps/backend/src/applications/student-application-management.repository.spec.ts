import { ApplicationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
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
    name: 'Applicant',
    nickname: 'applicant',
    profile: null,
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

describe('StudentApplicationManagementRepository', () => {
  it('includes team participation when finding the owned application', async () => {
    const findFirst = jest.fn().mockResolvedValue(APPLICATION);
    const repository = new StudentApplicationManagementRepository(
      createPrisma({ application: { findFirst } }),
      () => NOW,
    );

    await repository.findOwnedApplication('program-1', 'student-1');

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          programId: 'program-1',
          OR: [
            { applicantId: 'student-1' },
            { team: { leaderId: 'student-1' } },
            { team: { members: { some: { userId: 'student-1' } } } },
          ],
        },
      }),
    );
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

  /**
   * ⚠ 사유를 읽는 사람은 본인만이 아니다 — 팀 신청이면 리더·팀원 전원이 읽는다.
   * 의도된 범위지만(#570 판정 알림 수신자와 같은 집합) 이걸 고정하는 테스트가 없어서,
   * where 를 `applicantId` 만으로 좁혀도 아무도 울지 않았다.
   */
  it('scopes the owner read path to the applicant, the team leader, and team members', async () => {
    const findFirst = jest.fn().mockResolvedValue(APPLICATION);
    const repository = new StudentApplicationManagementRepository(
      createPrisma({ application: { findFirst } }),
      () => NOW,
    );

    await repository.findOwnedApplication('program-1', 'student-1');

    const calls = findFirst.mock.calls as unknown as readonly (readonly {
      readonly where: { readonly OR: readonly unknown[] };
    }[])[];
    const args = calls[0]?.[0];
    if (args === undefined) {
      throw new Error('application.findFirst 가 호출되지 않았다');
    }
    expect(args.where.OR).toEqual(
      expect.arrayContaining([
        { applicantId: 'student-1' },
        { team: { leaderId: 'student-1' } },
        { team: { members: { some: { userId: 'student-1' } } } },
      ]),
    );
  });

  /**
   * ⚠ 쓰기는 읽기보다 좁다 — 위 읽기 범위 주석은 **읽기만** 정당화한다(#1083).
   * 같은 조건을 재사용하면 팀원 아무나 팀 전체의 신청을 고치거나 되돌릴 수 없게
   * 지운다(하드 삭제라 복구 경로가 없다).
   */
  it.each(['update', 'delete'] as const)(
    'scopes the %s path to the applicant and the team leader only',
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

      if (operation === 'update') {
        await repository.updatePendingApplication({
          programId: 'program-1',
          studentId: 'student-1',
          answers: { title: 'Updated', summary: 'Updated' },
          applicationTemplateVersion: 1,
        });
      } else {
        await repository.deletePendingApplication({
          programId: 'program-1',
          studentId: 'student-1',
        });
      }

      const calls = findFirst.mock.calls as unknown as readonly (readonly {
        readonly where: { readonly OR: readonly unknown[] };
      }[])[];
      expect(calls).not.toHaveLength(0);
      for (const call of calls) {
        expect(call[0]?.where.OR).toEqual([
          { applicantId: 'student-1' },
          { team: { leaderId: 'student-1' } },
        ]);
      }
    },
  );

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
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: APPLICATION.id } }),
    );
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
      let locks = 0;
      const transaction = createTransaction({
        application: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce({ id: APPLICATION.id })
            .mockResolvedValueOnce(APPLICATION),
          update: jest.fn().mockResolvedValue(APPLICATION),
        },
      });
      transaction.$queryRaw.mockImplementation(() => {
        locks += 1;
        if (locks === 2) {
          applicationLockRequested?.();
          return applicationLock;
        }
        return Promise.resolve([{ id: 'locked' }]);
      });
      const clock = jest.fn(() => NOW);
      const repository = new StudentApplicationManagementRepository(
        createPrisma({ transaction }),
        clock,
      );

      const result =
        operation === 'update'
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

function createTransaction(input?: {
  readonly application?: {
    readonly findFirst?: jest.Mock;
    readonly update?: jest.Mock;
    readonly delete?: jest.Mock;
  };
}) {
  return {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'locked' }]),
    program: { findUnique: jest.fn().mockResolvedValue(POLICY) },
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
