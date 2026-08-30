import { PrismaService } from '../../prisma/prisma.service';
import { ProgramEditorRepository } from './program-editor.repository';

const syntheticProgramId = 'cuid-synthetic-program';
const syntheticMilestoneId = 'cuid-synthetic-milestone';

/**
 * 마일스톤 삭제는 서류 항목(MilestoneDocument)·양식 파일 행까지 같은 트랜잭션에서 함께 지운다.
 * FK가 모두 ON DELETE RESTRICT라 순서가 틀리면 P2003 → 타입 없는 500이 되므로 순서까지 본다.
 */
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

  /** 잠금 문장이 어느 테이블을 잡는지만 뽑는다 — 순서를 보기 위한 이름표다. */
  function lockedTable(query: { strings: string[] }): string {
    const sql = String(query.strings);
    if (sql.includes('"MilestoneDocument"')) return 'MilestoneDocument';
    if (sql.includes('"Milestone"')) return 'Milestone';
    if (sql.includes('"Program"')) return 'Program';
    return 'unknown';
  }

  it('마일스톤을 지울 때 양식 파일 행 → 서류 항목 행 → 마일스톤 순으로 같은 트랜잭션에서 지운다', async () => {
    // Given: 서류 항목이 달린 마일스톤.
    const { repository, transaction, callOrder } = buildRepository();

    // When
    await repository.withTransaction((store) =>
      store.deleteMilestone(syntheticMilestoneId),
    );

    // Then: 자식 행을 먼저 지우지 않으면 FK(RESTRICT)가 막아 500이 된다.
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
    // Given: 이 마일스톤의 서류 항목에 제출이 3건 있다.
    const { repository, transaction } = buildRepository(3);

    // When
    const target = await repository.withTransaction((store) =>
      store.findMilestoneForDelete(syntheticMilestoneId),
    );

    // Then: 서비스가 이 값으로 MILESTONE_HAS_SUBMISSIONS 거부를 판단한다.
    expect(target?.submissionCount).toBe(0);
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
    // Given: 학생 제출 경로(upsertSubmission)는 마일스톤이 아니라 MilestoneDocument 행을
    // 잠근다. 삭제 쪽이 마일스톤만 잠그면 서로 다른 행이라 직렬화되지 않는다 — 「제출 0건」을
    // 본 뒤 학생 제출이 커밋되고, 이어지는 서류 항목 삭제가 FK(P2003) → 타입 없는 500이 된다.
    const { repository, callOrder, queries } = buildRepository();

    // When
    await repository.withTransaction((store) =>
      store.findMilestoneForDelete(syntheticMilestoneId),
    );

    // Then: 부모 먼저(Program → Milestone → MilestoneDocument) 순서를 유지한 채,
    // 세는 것은 항상 잠근 뒤다.
    expect(callOrder).toEqual([
      'lock:Program',
      'lock:Milestone',
      'lock:MilestoneDocument',
      'milestoneDocumentSubmission.count',
    ]);
    // Then: 학생 쪽 FOR SHARE와 충돌해야 실제로 기다리게 되므로 FOR UPDATE여야 한다.
    const documentLock = queries[2];
    expect(String(documentLock?.strings)).toContain('FROM "MilestoneDocument"');
    expect(String(documentLock?.strings)).toContain('FOR UPDATE');
    expect(documentLock?.values).toEqual([syntheticMilestoneId]);
  });
});
