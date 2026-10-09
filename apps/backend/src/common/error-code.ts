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
  readonly blockingCounts?: ProblemDetailBlockingCounts;

  readonly currentScopeCounts?: ProblemDetailProgramDeletionScopeCounts;

  readonly currentTeamScopeCounts?: ProblemDetailTeamDeletionScopeCounts;
}

export interface ProblemDetailBlockingCounts {
  readonly applications: number;
  readonly teams: number;
  readonly submissions: number;
  readonly boardPosts: number;
}

export interface ProblemDetailProgramDeletionScopeCounts extends ProblemDetailBlockingCounts {
  readonly submissionEvents: number;
  readonly scopeFingerprint?: string;
}

export interface ProblemDetailTeamDeletionScopeCounts {
  readonly applications: number;
  readonly members: number;
  readonly invitations: number;
  readonly submissions: number;
  readonly submissionEvents: number;
  readonly detachedRepositories: number;
  readonly scopeFingerprint: string;
}

export interface ProblemDetailCurrentAccess {
  readonly id: string;

  readonly role: 'STUDENT' | 'STAFF' | 'ADMIN' | null;
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
import type { AccountStatus } from '@prisma/client';
