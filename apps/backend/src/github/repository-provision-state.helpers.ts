import { Prisma, RepositoryProvisionJobStatus } from '@prisma/client';
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
