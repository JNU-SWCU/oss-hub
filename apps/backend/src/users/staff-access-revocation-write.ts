import { StaffAccessRequestStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type {
  AdminAccessInsertedRequest,
  AdminAccessRevokedRequestInsert,
} from './admin-access.repository.types';

export async function insertRevokedStaffAccessRequest(
  transaction: Prisma.TransactionClient,
  input: AdminAccessRevokedRequestInsert,
): Promise<AdminAccessInsertedRequest> {
  const created = await transaction.staffAccessRequest.create({
    data: {
      userId: input.userId,
      status: StaffAccessRequestStatus.REVOKED,
      decidedById: input.actorId,
      decidedAt: input.decidedAt,
    },
    select: { id: true },
  });
  return { id: created.id };
}
