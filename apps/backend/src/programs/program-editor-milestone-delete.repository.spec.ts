import {
  ProgramCoverRepository,
  ProgramAuthoringUploadTransactionRepository,
} from './files.repository';
import { ProgramDeletionScopeRepository } from './programs.repository';
import { LockProgramTreeRepository } from '../platform/lock-program-tree.repository';
import { PrismaService } from '../platform/prisma.service';
import { ProgramEditorRepository } from './program-editor.repository';

const syntheticProgramId = 'cuid-synthetic-program';
const syntheticMilestoneId = 'cuid-synthetic-milestone';

describe('ProgramEditorRepository milestone deletion', () => {
  function buildRepository(documentSubmissionCount = 0) {
    const callOrder: string[] = [];
    const queries: { strings: string[]; values: unknown[] }[] = [];
    const transaction = {
      milestone: {
        findUnique: jest.fn().mockImplementation(() =>
          Promise.resolve({
            id: syntheticMilestoneId,
            programId: syntheticProgramId,
            program: {
              repositoryProvisioningEnabled: false,
              _count: { milestones: 2 },
            },
          }),
        ),
        delete: jest.fn().mockImplementation(() => {
          callOrder.push('milestone.delete');
          return Promise.resolve({});
        }),
      },
      requirement: {
        deleteMany: jest.fn().mockImplementation(() => {
          callOrder.push('requirement.deleteMany');
          return Promise.resolve({ count: 2 });
        }),
      },
      file: {
        updateMany: jest.fn().mockImplementation(() => {
          callOrder.push('file.updateMany');
          return Promise.resolve({ count: 1 });
        }),
      },
      submission: {
        count: jest.fn().mockImplementation(() => {
          callOrder.push('submission.count');
          return Promise.resolve(documentSubmissionCount);
        }),
      },
      $queryRaw: jest
        .fn()
        .mockImplementation(
          (query: { strings: string[]; values: unknown[] }) => {
            queries.push(query);
            callOrder.push(`lock:${lockedTable(query)}`);
            return Promise.resolve([
              { id: syntheticMilestoneId, programId: syntheticProgramId },
            ]);
          },
        ),
    };
    const prisma = {
      $transaction: <T>(operation: (store: typeof transaction) => Promise<T>) =>
        operation(transaction),
    };
    return {
      repository: new ProgramEditorRepository(
        prisma as unknown as PrismaService,
        new LockProgramTreeRepository(),
        new ProgramDeletionScopeRepository(),
        new ProgramAuthoringUploadTransactionRepository(),
        new ProgramCoverRepository(
          prisma as unknown as PrismaService,
          new ProgramAuthoringUploadTransactionRepository(),
        ),
      ),
      transaction,
      callOrder,
      queries,
    };
  }

  function lockedTable(query: { strings: string[] }): string {
    const sql = String(query.strings);
    if (sql.includes('"MilestoneDocument"')) return 'MilestoneDocument';
    if (sql.includes('"Milestone"')) return 'Milestone';
    if (sql.includes('"Program"')) return 'Program';
    return 'unknown';
  }

  it('마일스톤을 지울 때 파일 삭제를 예약한 뒤 서류 항목과 마일스톤을 같은 트랜잭션에서 지운다', async () => {
    const { repository, transaction, callOrder } = buildRepository();
    const scheduledAt: unknown = expect.any(Date);

    await repository.withTransaction((store) =>
      store.deleteMilestone(syntheticMilestoneId),
    );

    expect(callOrder).toEqual([
      'file.updateMany',
      'file.updateMany',
      'requirement.deleteMany',
      'milestone.delete',
    ]);
    expect(transaction.file.updateMany).toHaveBeenCalledWith({
      where: {
        requirement: { milestoneId: syntheticMilestoneId },
        lifecycle: { not: 'DELETED' },
      },
      data: {
        lifecycle: 'DELETE_PENDING',
        nextDeleteAttemptAt: scheduledAt,
      },
    });
    expect(transaction.file.updateMany).toHaveBeenNthCalledWith(2, {
      where: { requirement: { milestoneId: syntheticMilestoneId } },
      data: { requirementId: null },
    });
    expect(transaction.requirement.deleteMany).toHaveBeenCalledWith({
      where: { milestoneId: syntheticMilestoneId },
    });
    expect(transaction.milestone.delete).toHaveBeenCalledWith({
      where: { id: syntheticMilestoneId },
    });
  });

  it('삭제 대상 조회는 서류 항목에 달린 제출 수를 함께 센다', async () => {
    const { repository, transaction } = buildRepository(3);

    const target = await repository.withTransaction((store) =>
      store.findMilestoneForDelete(syntheticMilestoneId),
    );

    expect(target?.documentSubmissionCount).toBe(3);
    expect(transaction.milestone.findUnique).toHaveBeenLastCalledWith({
      where: { id: syntheticMilestoneId },
      include: {
        program: {
          include: { _count: { select: { milestones: true } } },
        },
      },
    });
    expect(transaction.submission.count).toHaveBeenCalledWith({
      where: { requirement: { milestoneId: syntheticMilestoneId } },
    });
  });

  it('제출 수를 세기 전에 그 마일스톤의 서류 항목 행을 학생 제출 경로와 같은 행으로 잠근다', async () => {
    const { repository, callOrder, queries } = buildRepository();

    await repository.withTransaction((store) =>
      store.findMilestoneForDelete(syntheticMilestoneId),
    );

    expect(callOrder).toEqual([
      'lock:Program',
      'lock:Milestone',
      'lock:MilestoneDocument',
      'submission.count',
    ]);

    const documentLock = queries[2];
    expect(String(documentLock?.strings)).toContain('FROM "MilestoneDocument"');
    expect(String(documentLock?.strings)).toContain('FOR UPDATE');
    expect(documentLock?.values).toEqual([syntheticMilestoneId]);
  });
});
