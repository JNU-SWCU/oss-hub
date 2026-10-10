import {
  ApplicationStatus,
  RepositoryConnectionMode,
  type Prisma,
} from '@prisma/client';

export function repositoryAccessSyncTargetWhere(
  teamId: string,
): Prisma.ApplicationWhereInput {
  return {
    teamId,
    status: ApplicationStatus.APPROVED,
    repositoryConnectionMode: RepositoryConnectionMode.NEW,
    program: { repositoryProvisioningEnabled: true },
  };
}
