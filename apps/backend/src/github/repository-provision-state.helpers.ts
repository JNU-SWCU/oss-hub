import {
  Prisma,
  RepositoryInvitationStatus,
  RepositoryProvisionJobStatus,
} from '@prisma/client';
import type { RepositoryVisibility } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  repositoryNameFromNameWithOwner,
  repositoryUrlFromNameWithOwner,
} from './repository-identity';
import type {
  ProvisionedRepository,
  RecordProvisionedRepositoryInput,
} from './repository-provision.contract';

export class RepositoryProvisionLeaseLostError extends Error {
  override readonly name = 'RepositoryProvisionLeaseLostError';
}

/// GithubRepository는 name/url 컬럼을 두지 않는다(#617 단계 D) — nameWithOwner를 select하고
/// toProvisionedRepository로 name/url을 유도해 기존 ProvisionedRepository 계약 모양을 유지한다.
export const repositorySelection = {
  id: true,
  applicationId: true,
  githubRepositoryId: true,
  nameWithOwner: true,
  visibility: true,
} as const;

export interface ProvisionedRepositoryRow {
  readonly id: string;
  readonly applicationId: string | null;
  readonly githubRepositoryId: bigint;
  readonly nameWithOwner: string;
  readonly visibility: RepositoryVisibility;
}

export function toProvisionedRepository(
  row: ProvisionedRepositoryRow,
): ProvisionedRepository {
  if (row.applicationId === null) {
    // recordRepository/loadContext는 applicationId로 조회하므로 이 경로로 온 행은 항상
    // applicationId를 가진다 — null이면 인벤토리 스윕이 만든 무관한 행을 잘못 짚은 것이다.
    throw new RepositoryProvisionLeaseLostError();
  }
  return {
    id: row.id,
    applicationId: row.applicationId,
    githubRepositoryId: row.githubRepositoryId,
    name: repositoryNameFromNameWithOwner(row.nameWithOwner),
    url: repositoryUrlFromNameWithOwner(row.nameWithOwner),
    visibility: row.visibility,
  };
}

export function claimedJobWhere(jobId: string, workerId: string) {
  return {
    id: jobId,
    status: RepositoryProvisionJobStatus.PROCESSING,
    lockedBy: workerId,
  } as const;
}

export async function assertProvisionLease(
  transaction: Prisma.TransactionClient | PrismaService,
  jobId: string,
  workerId: string,
): Promise<void> {
  const count = await transaction.repositoryProvisionJob.count({
    where: claimedJobWhere(jobId, workerId),
  });
  assertSingleProvisionUpdate(count);
}

export function assertSingleProvisionUpdate(count: number): void {
  if (count !== 1) {
    throw new RepositoryProvisionLeaseLostError();
  }
}

export function isPrismaUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

/**
 * 현재 팀 구성원을 확인할 수 없는데도 NEW 저장소를 계속 조정하면, 빈 목록이
 * "전원 회수"로 해석돼 살아있는 팀의 접근을 통째로 끊는다 — 신청자/리더로
 * 목록을 대신 채우지 않고 여기서 최종 실패로 멈춘다.
 */
export const PROVISION_MEMBERSHIP_UNAVAILABLE_ERROR_CODE =
  'REPOSITORY_PROVISION_MEMBERSHIP_UNAVAILABLE';

/** 회수 축 상태 — 이 상태의 행은 GRANT 축 재시도 대상이 아니다. */
export const REVOCATION_INVITATION_STATUSES = [
  RepositoryInvitationStatus.REVOKE_REQUIRED,
  RepositoryInvitationStatus.REVOKED,
  RepositoryInvitationStatus.REVOKE_FAILED_RETRYABLE,
  RepositoryInvitationStatus.REVOKE_FAILED_FINAL,
] as const;

export function invitationIntent(
  status: RepositoryInvitationStatus,
): 'GRANT' | 'REVOKE' {
  return (
    REVOCATION_INVITATION_STATUSES as readonly RepositoryInvitationStatus[]
  ).includes(status)
    ? 'REVOKE'
    : 'GRANT';
}

/**
 * GitHub login 정규화 — trim + 소문자 + 빈 값 제거 + 중복 제거 + 사전순 정렬.
 * fingerprint 비교가 표기 차이나 순서 차이로 흔들리면 완료 직전 재확인이
 * 매번 거짓 불일치를 내고 job이 영원히 재무장된다.
 */
export function canonicalGithubLogin(login: string | null | undefined): string {
  return (login ?? '').trim().toLowerCase();
}

export function canonicalGithubLogins(
  logins: readonly (string | null | undefined)[],
): readonly string[] {
  return [
    ...new Set(
      logins.map(canonicalGithubLogin).filter((login) => login.length > 0),
    ),
  ].sort();
}

/** 정규화된 login 목록 그대로가 지문이다 — 별도 해시를 두지 않는다. */
export function membershipFingerprint(logins: readonly string[]): string {
  return JSON.stringify(logins);
}

/** live TeamMember 행에서만 login을 읽는다(신청자/리더 fallback 금지). */
export const teamMemberLoginSelection = {
  user: { select: { nickname: true } },
} as const;

export function loginsFromTeamMembers(
  members: readonly { readonly user: { readonly nickname: string } }[],
): readonly string[] {
  return canonicalGithubLogins(members.map((member) => member.user.nickname));
}

/**
 * claim한 job 행만 잠근다. Team → Job 순서로 잠그는 쓰기 경로(멤버십 변경이
 * outbox/job을 건드리는 경로)가 있으므로 여기서 Job을 잡은 뒤 Team을 잠그면
 * 순환 대기가 된다 — 이 함수로 Job 행만 잠그고 멤버십은 잠금 없이 MVCC로 다시
 * 읽는다.
 */
export async function lockClaimedProvisionJob(
  transaction: Prisma.TransactionClient,
  jobId: string,
  workerId: string,
): Promise<{ readonly applicationId: string }> {
  const rows = await transaction.$queryRaw<
    { readonly applicationId: string }[]
  >(Prisma.sql`
    SELECT "applicationId"
    FROM "RepositoryProvisionJob"
    WHERE "id" = ${jobId}
      AND "status" = CAST(${RepositoryProvisionJobStatus.PROCESSING} AS "RepositoryProvisionJobStatus")
      AND "lockedBy" = ${workerId}
    FOR UPDATE
  `);
  const row = rows[0];
  if (rows.length !== 1 || row === undefined) {
    throw new RepositoryProvisionLeaseLostError();
  }
  return row;
}

export function matchesProvisionedMetadata(
  repository: ProvisionedRepository,
  input: RecordProvisionedRepositoryInput,
): boolean {
  return (
    repository.applicationId === input.applicationId &&
    repository.githubRepositoryId === input.metadata.githubRepositoryId &&
    repository.name === input.metadata.name &&
    repository.url === input.metadata.url &&
    repository.visibility === input.metadata.visibility
  );
}
