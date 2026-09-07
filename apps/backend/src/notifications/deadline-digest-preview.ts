import { createHash } from 'node:crypto';
import type { DeadlineEligibility } from './deadline-digest-eligibility';
import {
  buildStaffDeadlineMail,
  buildStudentDeadlineMail,
  type BuiltDeadlineMail,
} from './deadline-digest-mail.template';
import type { NotifiableStaffRecipient } from './deadline-digest.repository';

export interface DeadlineDigestGuidance {
  readonly studentGuidance?: string;
  readonly staffGuidance?: string;
}

export interface PreparedDeadlineMail {
  readonly audience: 'STUDENT' | 'STAFF';
  readonly recipientId: string;
  readonly to: string;
  readonly milestoneCount: number;
  readonly mail: BuiltDeadlineMail;
}

export interface PersonalizedDeadlinePreview extends BuiltDeadlineMail {
  readonly displayName: string;
}

export function prepareDeadlineDigest(
  eligibility: DeadlineEligibility,
  staffRecipients: readonly NotifiableStaffRecipient[],
  draft: DeadlineDigestGuidance & {
    readonly now: Date;
    readonly frontendOrigin: URL;
  },
): {
  readonly deliveries: readonly PreparedDeadlineMail[];
  readonly studentPreviews: readonly PersonalizedDeadlinePreview[];
  readonly staffPreview: BuiltDeadlineMail | null;
  readonly previewVersion: string;
} {
  const students = eligibility.recipients.flatMap((recipient) => {
    const first = recipient.milestones[0];
    if (first === undefined) return [];
    const mail = buildStudentDeadlineMail({
      displayName: recipient.nickname,
      milestones: [first, ...recipient.milestones.slice(1)],
      now: draft.now,
      frontendOrigin: draft.frontendOrigin,
      guidance: draft.studentGuidance,
    });
    return [{ recipient, mail }];
  });
  const staffPreview =
    staffRecipients.length > 0 && eligibility.staffMilestones.length > 0
      ? buildStaffDeadlineMail({
          milestones: eligibility.staffMilestones,
          now: draft.now,
          frontendOrigin: draft.frontendOrigin,
          guidance: draft.staffGuidance,
        })
      : null;
  const deliveries: readonly PreparedDeadlineMail[] = [
    ...students.map(({ recipient, mail }) => ({
      audience: 'STUDENT' as const,
      recipientId: recipient.id,
      to: recipient.notificationEmail,
      milestoneCount: recipient.milestones.length,
      mail,
    })),
    ...(staffPreview === null
      ? []
      : staffRecipients.map((recipient) => ({
          audience: 'STAFF' as const,
          recipientId: recipient.id,
          to: recipient.notificationEmail,
          milestoneCount: eligibility.staffMilestones.length,
          mail: staffPreview,
        }))),
  ];
  const previewVersion = createHash('sha256')
    .update(
      JSON.stringify({
        eligibility: eligibility.previewVersion,
        previewedAt: draft.now.toISOString(),
        studentGuidance: draft.studentGuidance ?? '',
        staffGuidance: draft.staffGuidance ?? '',
        deliveries,
      }),
    )
    .digest('hex');
  return {
    deliveries,
    studentPreviews: students.map(({ recipient, mail }) => ({
      displayName: recipient.nickname,
      ...mail,
    })),
    staffPreview,
    previewVersion,
  };
}
