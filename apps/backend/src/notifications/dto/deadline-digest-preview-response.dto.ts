import type { BuiltDeadlineMail } from '../deadline-digest-mail-template.policy';
import type { PersonalizedDeadlinePreview } from '../deadline-digest-preview.policy';
import type { DeadlineDigestPreview } from '../notifications.types';

export class DeadlineDigestPreviewResponseDto {
  declare readonly applicationCount: number;
  declare readonly milestoneCount: number;
  declare readonly recipientCount: number;
  declare readonly inactiveCount: number;
  declare readonly optedOutCount: number;
  declare readonly noEmailCount: number;
  declare readonly staffRecipientCount: number;
  declare readonly previewedAt: string;
  declare readonly expiresAt: string;
  declare readonly previewVersion: string;
  declare readonly studentPreviews: readonly PersonalizedDeadlinePreview[];
  declare readonly staffPreview: BuiltDeadlineMail | null;

  static from(
    preview: DeadlineDigestPreview,
  ): DeadlineDigestPreviewResponseDto {
    return {
      applicationCount: preview.applicationCount,
      milestoneCount: preview.milestoneCount,
      recipientCount: preview.recipientCount,
      inactiveCount: preview.inactiveCount,
      optedOutCount: preview.optedOutCount,
      noEmailCount: preview.noEmailCount,
      staffRecipientCount: preview.staffRecipientCount,
      previewedAt: preview.previewedAt,
      expiresAt: preview.expiresAt,
      previewVersion: preview.previewVersion,
      studentPreviews: preview.studentPreviews,
      staffPreview: preview.staffPreview,
    };
  }
}
