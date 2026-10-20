export interface TeamDeletionNotification {
  readonly id: string;
  readonly teamId: string;
  readonly teamName: string;
  readonly programId: string;
  readonly programName: string;
  readonly message: string | null;
  readonly deletedAt: Date;
}
