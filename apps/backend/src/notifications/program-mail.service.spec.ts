import { MailPreviewService } from './mail-preview.service';
import { AccountStatus, ApplicationStatus } from '@prisma/client';
import type { ActiveAccountPrincipal } from '../auth/http-auth.types';
import {
  NOTIFICATIONS_ERROR_CODES,
  NotificationsErrorCode,
} from './notifications-error-code.error';
import type { ProgramMailDeliveryService } from './program-mail-delivery.service';
import type {
  ProgramMailAudience,
  ProgramMailRepositoryPort,
} from './program-mail.repository';
import { ProgramMailService } from './program-mail.service';

const sender: ActiveAccountPrincipal = {
  id: 'staff-1',
  githubId: 1n,
  nickname: 'staff-login',
  name: '담당 교직원',
  avatarUrl: null,
  accountStatus: AccountStatus.ACTIVE,
  sessionVersion: 0,
  memberKind: 'STAFF',
  hasStaffAccess: true,
  hasAdminAccess: false,
  isProfileComplete: true,
};

const audience: ProgramMailAudience = {
  id: 'program-1',
  name: '합성 프로그램',
  teams: [
    {
      id: 'team-1',
      name: '합성 팀',
      status: ApplicationStatus.SUBMITTED,
      deadlineEligible: true,
      applicants: [
        {
          id: 'student-1',
          displayName: '학생 한 명',
          nickname: 'student-login',
          notificationEmail: 'student@example.com',
          mailAvailable: true,
        },
      ],
    },
  ],
};

function harness() {
  const repository: jest.Mocked<ProgramMailRepositoryPort> = {
    findAudience: jest.fn().mockResolvedValue(audience),
  };
  const delivery: jest.Mocked<Pick<ProgramMailDeliveryService, 'send'>> = {
    send: jest.fn().mockResolvedValue({
      kind: 'COMPLETED',
      batchKey: 'program-mail-send:preview',
      jobId: 'opaque-job',
      result: {
        sentCount: 1,
        duplicateCount: 0,
        failedCount: 0,
        unknownCount: 0,
      },
    }),
  };
  return {
    repository,
    delivery,
    service: new ProgramMailService(
      repository,
      delivery,
      {
        recent: jest.fn(),
        status: jest.fn(),
      },
      new MailPreviewService(),
    ),
  };
}

it('rejects an applicant id that does not belong to the program before delivery', async () => {
  const { service, delivery } = harness();

  await expect(
    service.preview('program-1', sender, {
      subject: '안내 제목',
      body: '안내 본문',
      applicantIds: ['other-program-student'],
    }),
  ).rejects.toMatchObject({
    errorCode:
      NOTIFICATIONS_ERROR_CODES[
        NotificationsErrorCode.PROGRAM_MAIL_RECIPIENT_INVALID
      ],
  });
  expect(delivery.send.mock.calls).toHaveLength(0);
});

it('rejects a selected applicant whose notification settings do not permit mail', async () => {
  const { service, repository } = harness();
  repository.findAudience.mockResolvedValue({
    ...audience,
    teams: [
      {
        id: 'team-1',
        name: '합성 팀',
        status: ApplicationStatus.SUBMITTED,
        deadlineEligible: true,
        applicants: [
          {
            id: 'student-1',
            displayName: '학생 한 명',
            nickname: 'student-login',
            notificationEmail: null,
            mailAvailable: false,
          },
        ],
      },
    ],
  });

  await expect(
    service.preview('program-1', sender, {
      subject: '안내 제목',
      body: '안내 본문',
      applicantIds: ['student-1'],
    }),
  ).rejects.toMatchObject({
    errorCode:
      NOTIFICATIONS_ERROR_CODES[
        NotificationsErrorCode.PROGRAM_MAIL_RECIPIENT_INVALID
      ],
  });
});

it('rejects a send that exceeds the bounded recipient limit', async () => {
  const { service } = harness();

  await expect(
    service.preview('program-1', sender, {
      subject: '안내 제목',
      body: '안내 본문',
      applicantIds: Array.from(
        { length: 201 },
        (_, index) => `student-${index}`,
      ),
    }),
  ).rejects.toMatchObject({
    errorCode:
      NOTIFICATIONS_ERROR_CODES[
        NotificationsErrorCode.PROGRAM_MAIL_RECIPIENT_LIMIT
      ],
  });
});

it('passes a confirmed preview to the durable delivery owner', async () => {
  const { service, delivery } = harness();
  const now = new Date('2026-11-18T00:00:00.000Z');
  const draft = {
    subject: '안내 제목',
    body: '안내 본문',
    applicantIds: ['student-1'],
  };
  const preview = await service.preview('program-1', sender, draft, now);

  const result = await service.send(
    'program-1',
    sender,
    { ...draft, ...preview },
    now,
  );

  expect(result).toMatchObject({ sentCount: 1, duplicateCount: 0 });
  expect(delivery.send.mock.calls).toEqual([
    [
      expect.objectContaining({
        actorId: 'staff-1',
        programId: 'program-1',
        previewVersion: preview.previewVersion,
        occurredAt: now,
        recipients: [
          expect.objectContaining({
            id: 'student-1',
            notificationEmail: 'student@example.com',
          }),
        ],
      }),
    ],
  ]);
});
