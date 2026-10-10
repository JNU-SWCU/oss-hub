import { MemberKind, StaffAccessRequestStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type {
  StaffAccessRequestOutcome,
  StaffAccessRequestTarget,
} from '../domain/onboarding-store';

type StaffAccessRequestTransaction = {
  readonly staffAccessRequest: Pick<
    Prisma.TransactionClient['staffAccessRequest'],
    'findFirst' | 'create'
  >;
};

const NOTHING_REQUESTED: StaffAccessRequestOutcome = { requestStatus: null };

export async function requestStaffAccess(
  transaction: StaffAccessRequestTransaction,
  target: StaffAccessRequestTarget,
): Promise<StaffAccessRequestOutcome> {
  if (target.memberKind !== MemberKind.STAFF || target.hasStaffAccess) {
    return NOTHING_REQUESTED;
  }

  const pending = await transaction.staffAccessRequest.findFirst({
    where: { userId: target.id, status: StaffAccessRequestStatus.PENDING },
  });
  if (pending) {
    return { requestStatus: pending.status };
  }
  const created = await transaction.staffAccessRequest.create({
    data: { userId: target.id },
  });
  return { requestStatus: created.status };
}
