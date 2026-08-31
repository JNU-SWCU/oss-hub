import { Prisma } from '@prisma/client';

export interface SubmissionPublicIdentity {
  readonly id: string;
  readonly legacySubmissionId: string | null;
}

export class SubmissionPublicIdCollisionError extends Error {
  override readonly name = 'SubmissionPublicIdCollisionError';
}

export function publicSubmissionId(identity: SubmissionPublicIdentity): string {
  return identity.legacySubmissionId ?? identity.id;
}

export function submissionPublicIdWhere(
  publicId: string,
): Prisma.MilestoneDocumentSubmissionWhereInput {
  return { OR: [{ id: publicId }, { legacySubmissionId: publicId }] };
}

export function exactSubmissionByPublicId<T>(rows: readonly T[]): T | null {
  if (rows.length > 1) {
    throw new SubmissionPublicIdCollisionError(
      'Ambiguous submission public id',
    );
  }
  return rows[0] ?? null;
}
