import type { StudentApplicationView } from '../programs.types';

export class StudentApplicationResponseDto {
  declare readonly id: string;
  declare readonly programId: string;
  declare readonly status: StudentApplicationView['status'];
  declare readonly teamId: string | null;
  declare readonly answers: StudentApplicationView['answers'];
  declare readonly submittedAt: string;
  declare readonly updatedAt: string;
  declare readonly isRepositoryPublicationPlanned: boolean;
  declare readonly rejectionReason: string | null;
  declare readonly isManager: boolean;
  declare readonly canManage: boolean;
  declare readonly canEdit: boolean;
  declare readonly canCancel: boolean;

  static from(
    application: StudentApplicationView,
  ): StudentApplicationResponseDto {
    return {
      id: application.id,
      programId: application.programId,
      status: application.status,
      teamId: application.teamId,
      answers: application.answers,
      submittedAt: application.submittedAt.toISOString(),
      updatedAt: application.updatedAt.toISOString(),
      isRepositoryPublicationPlanned:
        application.isRepositoryPublicationPlanned,
      rejectionReason: application.rejectionReason,
      isManager: application.isManager,
      canManage: application.canManage,
      canEdit: application.canManage,
      canCancel: application.canManage,
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
