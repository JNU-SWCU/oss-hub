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
    return { ...preview };
  }
}
