import { AccountStatus, ApplicationStatus } from '@prisma/client';
import type { ActiveAccountPrincipal } from '../auth/http-auth.types';
import type { MailSender } from './gmail-mail.client';
import {
  NOTIFICATIONS_ERROR_CODES,
  NotificationsErrorCode,
} from './notifications-error-code.error';
import type {
  ProgramMailAudience,
  ProgramMailRepositoryPort,
} from './program-mail.repository';
import { ProgramMailDeliveryService } from './program-mail-delivery.service';
import { ProgramMailService } from './program-mail.service';
import { ProgramMailTemplateService } from './program-mail-template.service';

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
    claimNotification: jest.fn().mockResolvedValue(true),
    completeNotification: jest.fn().mockResolvedValue(undefined),
  };
  const mailSender: jest.Mocked<MailSender> = {
    send: jest.fn().mockResolvedValue(undefined),
  };
  return {
    repository,
    mailSender,
    service: new ProgramMailService(
      repository,
      new ProgramMailDeliveryService(
        repository,
        mailSender,
        new ProgramMailTemplateService(),
      ),
    ),
  };
}

it('rejects an applicant id that does not belong to the program before claiming mail', async () => {
  const { service, repository, mailSender } = harness();

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
  expect(repository.claimNotification.mock.calls).toHaveLength(0);
  expect(mailSender.send.mock.calls).toHaveLength(0);
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

it('sends the confirmed preview once and deduplicates a repeated confirmation', async () => {
  const { service, repository, mailSender } = harness();
  const now = new Date('2026-11-18T00:00:00.000Z');
  const draft = {
    subject: '안내 제목',
    body: '안내 본문',
    applicantIds: ['student-1'],
  };
  const preview = await service.preview('program-1', sender, draft, now);

  const first = await service.send(
    'program-1',
    sender,
    { ...draft, ...preview },
    now,
  );
  repository.claimNotification.mockResolvedValue(false);
  const repeated = await service.send(
    'program-1',
    sender,
    { ...draft, ...preview },
    now,
  );

  expect(first).toMatchObject({ sentCount: 1, duplicateCount: 0 });
  expect(repeated).toMatchObject({ sentCount: 0, duplicateCount: 1 });
  expect(mailSender.send.mock.calls).toHaveLength(1);
  const sentMail = mailSender.send.mock.calls[0]?.[0];
  expect(sentMail?.to).toBe('student@example.com');
  expect(sentMail?.subject).toBe('[oss-hub] 안내 제목');
  expect(sentMail?.body).toContain('보낸 사람: 담당 교직원');
  expect(sentMail?.html).toContain('이 메일은 oss-hub에서 발송했습니다.');
});
