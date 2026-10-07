import { PrismaService } from '../../prisma/prisma.service';
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
      milestoneDocument: {
        deleteMany: jest.fn().mockImplementation(() => {
          callOrder.push('milestoneDocument.deleteMany');
          return Promise.resolve({ count: 2 });
        }),
      },
      milestoneDocumentTemplateFile: {
        deleteMany: jest.fn().mockImplementation(() => {
          callOrder.push('milestoneDocumentTemplateFile.deleteMany');
          return Promise.resolve({ count: 1 });
        }),
      },
      milestoneDocumentSubmission: {
        count: jest.fn().mockImplementation(() => {
          callOrder.push('milestoneDocumentSubmission.count');
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

  it('마일스톤을 지울 때 양식 파일 행 → 서류 항목 행 → 마일스톤 순으로 같은 트랜잭션에서 지운다', async () => {
    const { repository, transaction, callOrder } = buildRepository();

    await repository.withTransaction((store) =>
      store.deleteMilestone(syntheticMilestoneId),
    );

    expect(callOrder).toEqual([
      'milestoneDocumentTemplateFile.deleteMany',
      'milestoneDocument.deleteMany',
      'milestone.delete',
    ]);
    expect(
      transaction.milestoneDocumentTemplateFile.deleteMany,
    ).toHaveBeenCalledWith({
      where: { milestoneDocument: { milestoneId: syntheticMilestoneId } },
    });
    expect(transaction.milestoneDocument.deleteMany).toHaveBeenCalledWith({
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
    expect(transaction.milestoneDocumentSubmission.count).toHaveBeenCalledWith({
      where: { milestoneDocument: { milestoneId: syntheticMilestoneId } },
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
      'milestoneDocumentSubmission.count',
    ]);

    const documentLock = queries[2];
    expect(String(documentLock?.strings)).toContain('FROM "MilestoneDocument"');
    expect(String(documentLock?.strings)).toContain('FOR UPDATE');
    expect(documentLock?.values).toEqual([syntheticMilestoneId]);
  });
});
