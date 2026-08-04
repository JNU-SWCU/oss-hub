import type {
  ApplicationStatus,
  RepositoryConnectionMode,
} from '@prisma/client';
import type { CreatedApplication } from '../applications.repository';

export class CreateApplicationResponseDto {
  readonly id: string;
  readonly programId: string;
  readonly status: ApplicationStatus;
  readonly teamId: string;
  readonly submittedAt: string;
  readonly isRepositoryPublicationPlanned: boolean;
  readonly repositoryConnectionMode: RepositoryConnectionMode;
  readonly repositoryUrl: string | null;

  private constructor(application: CreatedApplication) {
    this.id = application.id;
    this.programId = application.programId;
    this.status = application.status;
    this.teamId = application.teamId;
    this.submittedAt = application.submittedAt.toISOString();
    this.isRepositoryPublicationPlanned =
      application.isRepositoryPublicationPlanned;
    this.repositoryConnectionMode = application.repositoryConnectionMode;
    this.repositoryUrl = application.repositoryUrl;
  }

  static from(application: CreatedApplication): CreateApplicationResponseDto {
    return new CreateApplicationResponseDto(application);
  }
}
