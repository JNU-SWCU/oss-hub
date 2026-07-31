export interface ErrorCode {
  code: string;
  status: number;
  message: string;
  readonly exposeToClient?: true;
}

export interface ProblemDetailFieldError {
  readonly field: string;
  readonly code: string;
  readonly message: string;
}

export interface ProblemDetailExtensions {
  readonly retryNotBeforeAt?: string;
  readonly fieldErrors?: readonly ProblemDetailFieldError[];
  readonly activeRunId?: string;
  readonly currentAccess?: ProblemDetailCurrentAccess;
}

export interface ProblemDetailCurrentAccess {
  readonly id: string;
  readonly role: Role | null;
  readonly accountStatus: AccountStatus;
  readonly pendingRequest: {
    readonly id: string;
    readonly status: 'PENDING';
    readonly createdAt: string;
  } | null;
}

export class DomainException extends Error {
  constructor(
    public readonly errorCode: ErrorCode,
    public readonly extensions: ProblemDetailExtensions = {},
  ) {
    super(errorCode.message);
    this.name = 'DomainException';
  }
}
import type { AccountStatus, Role } from '@prisma/client';
