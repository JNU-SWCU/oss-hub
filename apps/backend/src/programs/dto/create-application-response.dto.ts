import type {
  ApplicationStatus,
  RepositoryConnectionMode,
} from '@prisma/client';
import type { CreatedApplication } from '../applications.repository';

export class CreateApplicationResponseDto {
  declare readonly id: string;
  declare readonly programId: string;
  declare readonly status: ApplicationStatus;
  declare readonly teamId: string;
  declare readonly submittedAt: string;
  declare readonly isRepositoryPublicationPlanned: boolean;
  declare readonly repositoryConnectionMode: RepositoryConnectionMode;
  declare readonly repositoryUrl: string | null;

  static from(application: CreatedApplication): CreateApplicationResponseDto {
    return {
      id: application.id,
      programId: application.programId,
      status: application.status,
      teamId: application.teamId,
      submittedAt: application.submittedAt.toISOString(),
      isRepositoryPublicationPlanned:
        application.isRepositoryPublicationPlanned,
      repositoryConnectionMode: application.repositoryConnectionMode,
      repositoryUrl: application.repositoryUrl,
    };
  }
}
