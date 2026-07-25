import type { ApplicationStatus } from '@prisma/client';
import type { CreatedApplication } from '../applications.repository';

export class CreateApplicationResponseDto {
  readonly id: string;
  readonly programId: string;
  readonly status: ApplicationStatus;
  readonly teamId: string | null;
  readonly submittedAt: string;

  private constructor(application: CreatedApplication) {
    this.id = application.id;
    this.programId = application.programId;
    this.status = application.status;
    this.teamId = application.teamId;
    this.submittedAt = application.submittedAt.toISOString();
  }

  static from(application: CreatedApplication): CreateApplicationResponseDto {
    return new CreateApplicationResponseDto(application);
  }
}
