import type { TeamDeletionNotification } from '../team-deletion-notification.types';

export class TeamDeletionNotificationResponseDto {
  readonly id: string;
  readonly teamId: string;
  readonly teamName: string;
  readonly programId: string;
  readonly programName: string;
  readonly message: string | null;
  readonly deletedAt: string;

  constructor(notification: TeamDeletionNotification) {
    this.id = notification.id;
    this.teamId = notification.teamId;
    this.teamName = notification.teamName;
    this.programId = notification.programId;
    this.programName = notification.programName;
    this.message = notification.message;
    this.deletedAt = notification.deletedAt.toISOString();
  }
}
