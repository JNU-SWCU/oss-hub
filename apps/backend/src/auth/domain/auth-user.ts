import { AccountStatus, Role } from '@prisma/client';

export interface AuthUser {
  id: string;
  githubId: bigint;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  readonly accountStatus: AccountStatus;
  /** DB 정식 소스(Issue #109) — 역할 선택 전 null. */
  role: Role | null;
}

export interface AuthLoginResult {
  user: AuthUser;
  isNew: boolean;
}

/** GitHub /user 응답에서 검증을 거쳐 만든 내부 값 — 액세스 토큰은 여기 포함되지 않는다. */
export interface GithubProfile {
  githubId: bigint;
  login: string;
  name: string | null;
  avatarUrl: string | null;
}
