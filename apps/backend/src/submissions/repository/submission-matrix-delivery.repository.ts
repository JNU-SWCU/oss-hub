import type { Prisma } from '@prisma/client';

export interface MatrixDocumentFirstSubmission {
  readonly applicationId: string;
  readonly milestoneDocumentId: string;
  readonly firstSubmittedAt: Date;
}

export async function findMatrixDocumentFirstSubmissions(
  prisma: Prisma.TransactionClient,
  scope: {
    readonly applicationIds: readonly string[];
    readonly documentIds: readonly string[];
  },
): Promise<readonly MatrixDocumentFirstSubmission[]> {
  if (scope.applicationIds.length === 0 || scope.documentIds.length === 0) {
    return [];
  }
  const submissions = await prisma.milestoneDocumentSubmission.findMany({
    where: {
      applicationId: { in: [...scope.applicationIds] },
      milestoneDocumentId: { in: [...scope.documentIds] },
    },
    select: {
      applicationId: true,
      milestoneDocumentId: true,
      createdAt: true,
      histories: {
        where: { event: 'SUBMITTED', revision: 1 },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 1,
        select: { createdAt: true },
      },
    },
  });
  return submissions.map((submission) => ({
    applicationId: submission.applicationId,
    milestoneDocumentId: submission.milestoneDocumentId,
    firstSubmittedAt:
      submission.histories[0]?.createdAt ?? submission.createdAt,
  }));
}
