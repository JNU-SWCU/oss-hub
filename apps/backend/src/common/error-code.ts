import type { AuthorityLabel } from './authority-label';
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
  /** purge 확인-재확인 사이 범위가 바뀜 때(PRG_014)의 현재 전체 삭제 범위. */
  readonly currentScopeCounts?: ProblemDetailProgramDeletionScopeCounts;
  /**
   * 팀 삭제 확인-재확인 사이 범위가 바뀌었을 때(TEAM_019)의 현재 팀 범위.
   * `currentScopeCounts`와 키를 나눠 둔다 — 두 범위는 세는 축이 다르므로 한 키를
   * 공유하면 받는 쪽이 모양을 추측해야 한다.
   */
  readonly currentTeamScopeCounts?: ProblemDetailTeamDeletionScopeCounts;
}

/** 삭제를 막는 연결 데이터 종류별 건수. 0이면 그 종류는 차단 사유가 아니다. 이 사이즈는 purge의 확인 범위(4종)와 동일하여 재사용된다. */
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

/** 팀 하나를 지울 때 함께 사라지는 것의 건수. `detachedRepositories`만 연결 해제 수다. */
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
  /** 표시 역할 — 관리 화면이 "지금 상태"를 한 단어로 되돌려 줄 때 쓴다. */
  readonly role: AuthorityLabel | null;
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
