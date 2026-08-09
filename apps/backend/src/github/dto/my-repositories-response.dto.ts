import type {
  RepositoryInvitationStatus,
  RepositoryProvisionJobStatus,
  RepositoryVisibility,
} from '@prisma/client';
import type { MyRepository } from '../service/repositories.service';

export interface MyRepositoryItemResponseDto {
  readonly repositoryId: string | null;
  readonly applicationId: string;
  readonly applicationMode: 'PERSONAL' | 'TEAM';
  readonly programName: string;
  readonly displayName: string;
  readonly repositoryName: string | null;
  readonly githubUrl: string | null;
  readonly provisionStatus: RepositoryProvisionJobStatus;
  readonly invitationStatus: RepositoryInvitationStatus | null;
  readonly visibility: RepositoryVisibility | null;
  readonly lastErrorCode: string | null;
  readonly updatedAt: string;
}

export class MyRepositoriesResponseDto {
  readonly items: readonly MyRepositoryItemResponseDto[];

  private constructor(items: readonly MyRepository[]) {
    this.items = items.map((item) => ({
      repositoryId: item.repositoryId,
      applicationId: item.applicationId,
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
    }));
  }

  static from(items: readonly MyRepository[]): MyRepositoriesResponseDto {
    return new MyRepositoriesResponseDto(items);
  }
}
