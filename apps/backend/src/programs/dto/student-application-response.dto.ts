import type { StudentApplicationView } from '../team-application.service';

export class StudentApplicationResponseDto {
  declare readonly id: string;
  declare readonly status: StudentApplicationView['status'];
  declare readonly teamId: string | null;
  declare readonly answers: {
    readonly applicantName: string;
    readonly title: string;
  };
  declare readonly submittedAt: string;
  declare readonly isRepositoryPublicationPlanned: boolean;
  declare readonly rejectionReason: string | null;
  declare readonly isManager: boolean;
  declare readonly canManage: boolean;

  static from(
    application: StudentApplicationView,
  ): StudentApplicationResponseDto {
    return {
      id: application.id,
      status: application.status,
      teamId: application.teamId,
      answers: application.answers,
      submittedAt: application.submittedAt.toISOString(),
      isRepositoryPublicationPlanned:
        application.isRepositoryPublicationPlanned,
      rejectionReason: application.rejectionReason,
      isManager: application.isManager,
      canManage: application.canManage,
    };
  }
}

export class StudentApplicationCancellationResponseDto {
  declare readonly cancelled: true;

  static from(result: {
    readonly cancelled: true;
  }): StudentApplicationCancellationResponseDto {
    return { cancelled: result.cancelled };
  }
}
