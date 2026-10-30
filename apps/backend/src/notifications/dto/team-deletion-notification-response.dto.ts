import type { TeamDeletionNotification } from '../notifications.types';

export class TeamDeletionNotificationResponseDto {
  declare readonly id: string;
  declare readonly teamId: string;
  declare readonly teamName: string;
  declare readonly programId: string;
  declare readonly programName: string;
  declare readonly message: string | null;
  declare readonly deletedAt: string;

  static from(
    notification: TeamDeletionNotification,
  ): TeamDeletionNotificationResponseDto {
    return {
      id: notification.id,
      teamId: notification.teamId,
      teamName: notification.teamName,
      programId: notification.programId,
      programName: notification.programName,
      message: notification.message,
      deletedAt: notification.deletedAt.toISOString(),
    };
  }
}
