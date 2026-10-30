import { ApplicationDecisionNotificationResponseDto } from '../../src/notifications/dto/application-decision-notification-response.dto';
import { NotificationSettingsResponseDto } from '../../src/notifications/dto/notification-settings-response.dto';
import { TeamDeletionNotificationResponseDto } from '../../src/notifications/dto/team-deletion-notification-response.dto';

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
];

describe('notifications response DTO JSON', () => {
  it.each(cases)('%s', (_name, build) => {
    expect(JSON.stringify(build())).toMatchSnapshot();
  });
});
