export const APPLICATION_DECISION_ACTIONS = {
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  REVERT: 'REVERT',
} as const;

export const APPLICATION_LIST_STATUSES = [
  'all',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
] as const;

export const APPLICATION_LIST_VIEWS = ['default', 'team-management'] as const;
