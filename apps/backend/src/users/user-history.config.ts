import type { UserHistoryEvent } from '@prisma/client';

export const APPROVAL_TRANSITION_EVENTS: readonly UserHistoryEvent[] = [
  'APPROVAL_REQUESTED',
  'APPROVED',
  'REJECTED',
  'REVOKED',
  'REQUEST_SUPERSEDED',
];

export const USER_APPROVAL_SELECT = {
  type: true,
  approvalStatus: true,
  approvalRequestId: true,
  approvalRequestedAt: true,
  approvalDecidedAt: true,
  approvalDecidedById: true,
  approvalReason: true,
} as const;
