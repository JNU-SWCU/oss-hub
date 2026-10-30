import type { ApplicationStatus } from '@prisma/client';
import type { DeadlineEligibilitySummary } from './deadline-digest-eligibility.policy';
import type { BuiltDeadlineMail } from './deadline-digest-mail-template.policy';
import type {
  DeadlineDigestGuidance,
  PersonalizedDeadlinePreview,
} from './deadline-digest-preview.policy';

export interface ApplicationDecisionNotification {
  readonly id: string;
  readonly applicationId: string;
  readonly programId: string;
  readonly programName: string;
  readonly decision:
    | typeof ApplicationStatus.APPROVED
    | typeof ApplicationStatus.REJECTED
    | typeof ApplicationStatus.SUBMITTED;
  readonly decidedAt: Date;
}

export type DeadlineDigestPreview = DeadlineEligibilitySummary & {
  readonly staffRecipientCount: number;
  readonly previewedAt: string;
  readonly expiresAt: string;
  readonly previewVersion: string;
  readonly studentPreviews: readonly PersonalizedDeadlinePreview[];
  readonly staffPreview: BuiltDeadlineMail | null;
};

export type DeadlineDigestSendRequest = DeadlineDigestGuidance & {
  readonly previewedAt: string;
  readonly previewVersion: string;
};

export type DeadlineDigestSendResult = DeadlineEligibilitySummary & {
  readonly staffRecipientCount: number;
  readonly sentAt: string;
  readonly previewVersion: string;
  readonly sentCount: number;
  readonly duplicateCount: number;
  readonly failedCount: number;
};

export interface DeadlineDigestMail {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  readonly html?: string;
}

export interface MailSender {
  send(mail: DeadlineDigestMail): Promise<void>;
}

export const MAIL_SENDER = Symbol('NOTIFICATIONS_MAIL_SENDER');

export interface NotificationSettings {
  readonly notificationEmail: string | null;
  readonly notifyEnabled: boolean;
}

export interface UpdateNotificationEmailInput {
  readonly notificationEmail: string;
  readonly notifyEnabled: boolean;
}

export interface TeamDeletionNotification {
  readonly id: string;
  readonly teamId: string;
  readonly teamName: string;
  readonly programId: string;
  readonly programName: string;
  readonly message: string | null;
  readonly deletedAt: Date;
}
