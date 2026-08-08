import { PrismaService } from '../prisma/prisma.service';
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
    const transaction = {
      milestone: {
        findUnique: jest.fn().mockImplementation(() =>
          Promise.resolve({
            id: syntheticMilestoneId,
            programId: syntheticProgramId,
            _count: { submissions: 0, submissionFiles: 0 },
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
        count: jest.fn().mockResolvedValue(documentSubmissionCount),
      },
      $queryRaw: jest
        .fn()
        .mockResolvedValue([
          { id: syntheticMilestoneId, programId: syntheticProgramId },
        ]),
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
    };
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
    expect(target?.documentSubmissionCount).toBe(3);
    expect(transaction.milestoneDocumentSubmission.count).toHaveBeenCalledWith({
      where: { milestoneDocument: { milestoneId: syntheticMilestoneId } },
    });
  });
});
