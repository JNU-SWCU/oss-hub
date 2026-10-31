export class PendingRequestDecisionConflict extends Error {}

export class MissingAdminAccessTransitionError extends Error {
  constructor(key: string) {
    super(`Missing ADMIN access transition table entry: ${key}`);
    this.name = 'MissingAdminAccessTransitionError';
  }
}

export class InvalidAdminAccessAuditError extends Error {
  override readonly name = 'InvalidAdminAccessAuditError';

  constructor() {
    super('Allowed admin access transition cannot be represented as audit.');
  }
}
