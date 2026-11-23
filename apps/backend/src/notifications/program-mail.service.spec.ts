import { MailPreviewService } from './mail-preview.service';
import { AccountStatus, ApplicationStatus } from '@prisma/client';
import type { ActiveAccountPrincipal } from '../auth/http-auth.types';
import {
  NOTIFICATIONS_ERROR_CODES,
  NotificationsErrorCode,
} from './notifications-error-code.error';
import type {
  MailJobAdmissionRepository,
  JobDelivery,
} from './mail-job-admission.repository';
import { ProgramMailTemplateService } from './program-mail-template.service';
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
  const deliveries: JobDelivery[] = [];
  const accept = jest.fn<
    ReturnType<MailJobAdmissionRepository['accept']>,
    Parameters<MailJobAdmissionRepository['accept']>
  >(async (_intent, prepare) => {
    const batch = await prepare(
      jest.fn() as never,
      new Date('2026-11-18T00:00:00.000Z'),
    );
    deliveries.push(...batch.deliveries);
    return { jobId: 'opaque-job', replay: false };
  });
  const delivery = { accept };
  return {
    deliveries,
    repository,
    delivery,
    service: new ProgramMailService(
      repository,
      delivery,
      {
        recent: jest.fn(),
        status: jest.fn().mockResolvedValue({
          status: 'COMPLETED',
          sentCount: 1,
          duplicateCount: 0,
          failedCount: 0,
          unknownCount: 0,
        }),
      },
      new MailPreviewService(),
      new ProgramMailTemplateService(),
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
  expect(delivery.accept.mock.calls).toHaveLength(0);
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
  const { service, delivery, deliveries } = harness();
  const now = new Date('2026-11-18T00:00:00.000Z');
  const draft = {
    subject: '안내 제목',
    body: '안내 본문',
    applicantIds: ['student-1'],
  };
  const preview = await service.preview('program-1', sender, draft, now);

  const result = await service.send('program-1', sender, {
    ...draft,
    ...preview,
  });

  expect(result).toMatchObject({ sentCount: 1, duplicateCount: 0 });
  expect(delivery.accept.mock.calls).toEqual([
    [
      expect.objectContaining({
        actorId: 'staff-1',
        programId: 'program-1',
        previewVersion: preview.previewVersion,
      }),
      expect.any(Function),
    ],
  ]);
  expect(deliveries).toHaveLength(1);
  expect(deliveries[0]).toMatchObject({
    audience: 'STUDENT',
    userId: 'student-1',
    envelope: { to: 'student@example.com', subject: '[oss-hub] 안내 제목' },
  });
  expect(deliveries[0]?.envelope.body).toContain('안내 본문');
});
