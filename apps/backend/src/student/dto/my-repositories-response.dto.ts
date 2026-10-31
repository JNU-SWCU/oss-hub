import type { MyRepositoryResult } from '../../github/repositories-read.types';
import type {
  RepositoryInvitationStatus,
  RepositoryProvisionJobStatus,
  RepositoryVisibility,
} from '@prisma/client';

export class MyRepositoryItemResponseDto {
  declare readonly repositoryId: string | null;
  declare readonly applicationId: string;
  declare readonly connectionMode: 'NEW' | 'OWN';
  declare readonly applicationMode: 'PERSONAL' | 'TEAM';
  declare readonly programName: string;
  declare readonly displayName: string;
  declare readonly repositoryName: string | null;
  declare readonly githubUrl: string | null;
  declare readonly provisionStatus: RepositoryProvisionJobStatus;
  declare readonly invitationStatus: RepositoryInvitationStatus | null;
  declare readonly visibility: RepositoryVisibility | null;
  declare readonly lastErrorCode: string | null;
  declare readonly updatedAt: string;

  static from(item: MyRepositoryResult): MyRepositoryItemResponseDto {
    return {
      repositoryId: item.repositoryId,
      applicationId: item.applicationId,
      connectionMode: item.connectionMode,
      applicationMode: item.applicationMode,
      programName: item.programName,
      displayName: item.displayName,
      repositoryName: item.repositoryName,
      githubUrl: item.githubUrl,
      provisionStatus: item.provisionStatus,
      invitationStatus: item.invitationStatus,
      visibility: item.visibility,
      lastErrorCode: item.lastErrorCode,
      updatedAt: item.updatedAt.toISOString(),
    };
  }
}

export class MyRepositoriesResponseDto {
  declare readonly items: readonly MyRepositoryItemResponseDto[];

  static from(items: readonly MyRepositoryResult[]): MyRepositoriesResponseDto {
    return {
      items: items.map((item) => MyRepositoryItemResponseDto.from(item)),
    };
  }
}
