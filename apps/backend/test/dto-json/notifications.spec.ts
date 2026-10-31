import { ApplicationDecisionNotificationResponseDto } from '../../src/notifications/dto/application-decision-notification-response.dto';
import { NotificationSettingsResponseDto } from '../../src/notifications/dto/notification-settings-response.dto';
import { TeamDeletionNotificationResponseDto } from '../../src/notifications/dto/team-deletion-notification-response.dto';
import { DeadlineDigestPreviewResponseDto } from '../../src/notifications/dto/deadline-digest-preview-response.dto';
import { DeadlineDigestSendResponseDto } from '../../src/notifications/dto/deadline-digest-send-response.dto';

const at = (iso: string): Date => new Date(iso);

const cases: ReadonlyArray<readonly [string, () => unknown]> = [
  [
    'ApplicationDecisionNotificationResponseDto',
    () =>
      ApplicationDecisionNotificationResponseDto.from({
        id: 'notification-1',
        applicationId: 'application-1',
        programId: 'program-1',
        programName: 'Program A',
        decision: 'APPROVED',
        decidedAt: at('2026-01-02T03:04:05.000Z'),
      }),
  ],
  [
    'NotificationSettingsResponseDto',
    () =>
      NotificationSettingsResponseDto.from({
        notificationEmail: 'octo@example.com',
        notifyEnabled: true,
      }),
  ],
  [
    'NotificationSettingsResponseDto null email',
    () =>
      NotificationSettingsResponseDto.from({
        notificationEmail: null,
        notifyEnabled: false,
      }),
  ],
  [
    'TeamDeletionNotificationResponseDto',
    () =>
      TeamDeletionNotificationResponseDto.from({
        id: 'notification-2',
        teamId: 'team-1',
        teamName: 'Team A',
        programId: 'program-1',
        programName: 'Program A',
        message: null,
        deletedAt: at('2026-02-03T04:05:06.000Z'),
      }),
  ],
  [
    'DeadlineDigestPreviewResponseDto',
    () =>
      DeadlineDigestPreviewResponseDto.from({
        applicationCount: 3,
        milestoneCount: 2,
        recipientCount: 4,
        inactiveCount: 1,
        optedOutCount: 1,
        noEmailCount: 0,
        staffRecipientCount: 2,
        previewedAt: '2026-05-01T00:00:00.000Z',
        expiresAt: '2026-05-01T00:30:00.000Z',
        previewVersion: 'preview-v1',
        studentPreviews: [
          {
            subject: 'Deadline',
            text: 'Text body',
            html: '<p>Body</p>',
            displayName: 'octo',
          },
        ],
        staffPreview: {
          subject: 'Staff deadline',
          text: 'Staff text',
          html: '<p>Staff</p>',
        },
      }),
  ],
  [
    'DeadlineDigestPreviewResponseDto no staff',
    () =>
      DeadlineDigestPreviewResponseDto.from({
        applicationCount: 0,
        milestoneCount: 0,
        recipientCount: 0,
        inactiveCount: 0,
        optedOutCount: 0,
        noEmailCount: 0,
        staffRecipientCount: 0,
        previewedAt: '2026-05-01T00:00:00.000Z',
        expiresAt: '2026-05-01T00:30:00.000Z',
        previewVersion: 'preview-v0',
        studentPreviews: [],
        staffPreview: null,
      }),
  ],
  [
    'DeadlineDigestSendResponseDto',
    () =>
      DeadlineDigestSendResponseDto.from({
        applicationCount: 3,
        milestoneCount: 2,
        recipientCount: 4,
        inactiveCount: 1,
        optedOutCount: 1,
        noEmailCount: 0,
        staffRecipientCount: 2,
        sentAt: '2026-05-01T00:10:00.000Z',
        previewVersion: 'preview-v1',
        sentCount: 5,
        duplicateCount: 1,
        failedCount: 0,
      }),
  ],
];

describe('notifications response DTO JSON', () => {
  it.each(cases)('%s', (_name, build) => {
    expect(JSON.stringify(build())).toMatchSnapshot();
  });
});
