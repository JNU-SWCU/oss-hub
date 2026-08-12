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
  /** purge 확인-재확인 사이 범위가 바뀜 때(PRG_014)의 현재(트랜잭션 스냅샷) 4종 건수. */
  readonly currentScopeCounts?: ProblemDetailBlockingCounts;
}

/** 삭제를 막는 연결 데이터 종류별 건수. 0이면 그 종류는 차단 사유가 아니다. 이 사이즈는 purge의 확인 범위(4종)와 동일하여 재사용된다. */
export interface ProblemDetailBlockingCounts {
  readonly applications: number;
  readonly teams: number;
  readonly submissions: number;
  readonly boardPosts: number;
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
