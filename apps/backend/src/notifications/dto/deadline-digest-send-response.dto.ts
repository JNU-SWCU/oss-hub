import type { DeadlineDigestSendResult } from '../notifications.types';

export class DeadlineDigestSendResponseDto {
  declare readonly applicationCount: number;
  declare readonly milestoneCount: number;
  declare readonly recipientCount: number;
  declare readonly inactiveCount: number;
  declare readonly optedOutCount: number;
  declare readonly noEmailCount: number;
  declare readonly staffRecipientCount: number;
  declare readonly sentAt: string;
  declare readonly previewVersion: string;
  declare readonly sentCount: number;
  declare readonly duplicateCount: number;
  declare readonly failedCount: number;

  static from(result: DeadlineDigestSendResult): DeadlineDigestSendResponseDto {
    return { ...result };
  }
}
