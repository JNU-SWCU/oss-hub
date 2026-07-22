import { Prisma, RepositoryProvisionJobStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  ProvisionedRepository,
  RecordProvisionedRepositoryInput,
} from './repository-provision.contract';

export class RepositoryProvisionLeaseLostError extends Error {
  override readonly name = 'RepositoryProvisionLeaseLostError';
}

export const repositorySelection = {
  id: true,
  applicationId: true,
  githubRepositoryId: true,
  name: true,
  url: true,
  visibility: true,
} as const;

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
