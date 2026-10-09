import type {
  RepositoryConnectionMode,
  RepositoryInvitationStatus,
  RepositoryProvisionJobStatus,
  RepositoryVisibility,
} from '@prisma/client';

export interface MyRepositoryResponseDto {
  readonly repositoryId: string | null;
  readonly applicationId: string;
  readonly connectionMode: RepositoryConnectionMode;
  readonly applicationMode: 'PERSONAL' | 'TEAM';
  readonly programName: string;
  readonly displayName: string;
  readonly repositoryName: string | null;
  readonly githubUrl: string | null;
  readonly provisionStatus: RepositoryProvisionJobStatus;
  readonly invitationStatus: RepositoryInvitationStatus | null;
  readonly visibility: RepositoryVisibility | null;
  readonly lastErrorCode: string | null;
  readonly updatedAt: Date;
}
