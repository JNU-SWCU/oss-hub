import { ScheduleModule, SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';
import {
  DeadlineDigestService,
  mailSenderProvider,
} from './deadline-digest.service';
import {
  loadRuntimeConfig,
  type RuntimeConfig,
} from '../platform/runtime-config.config';
import { RUNTIME_CONFIG } from '../platform/runtime-config-instance.config';
import {
  GmailMailClient,
  LogMailClient,
  MAIL_SENDER,
  type MailSender,
} from './gmail-mail.client';
import { AccountStatus } from '@prisma/client';
import { DomainException } from '../platform/error-code.error';
import type {
  DeadlineDigestRepositoryPort,
  DeadlineProgramSource,
} from './deadline-digest.repository';

describe('deadline digest cron', () => {
  describe('DeadlineDigestService.run', () => {
    let testingModule: TestingModule;
    let scheduler: DeadlineDigestService;
    const sendDeadlineDigests = jest.fn<Promise<void>, []>();

    const registeredJobs = () => [
      ...testingModule.get(SchedulerRegistry).getCronJobs().values(),
    ];
    const onlyRegisteredJob = () => {
      const [job, ...others] = registeredJobs();
      if (job === undefined || others.length > 0) {
        throw new Error(
          `expected exactly one cron job, got ${registeredJobs().length}`,
        );
      }
      return job;
    };

    beforeEach(async () => {
      sendDeadlineDigests.mockReset();
      sendDeadlineDigests.mockResolvedValue(undefined);
      scheduler = new DeadlineDigestService(
        {} as DeadlineDigestRepositoryPort,
        {} as MailSender,
        { FRONTEND_URL: 'https://oss.example' },
      );
      scheduler.sendDeadlineDigests = sendDeadlineDigests;
      testingModule = await Test.createTestingModule({
        imports: [ScheduleModule.forRoot()],
        providers: [{ provide: DeadlineDigestService, useValue: scheduler }],
      }).compile();
      await testingModule.init();
    });

    afterEach(async () => {
      await testingModule.close();
    });

    it('이름 없이 매일 09시 표현식과 서울 시간대, 라이브러리 완료 대기 없음으로 cron 하나를 등록한다', () => {
      expect(registeredJobs()).toHaveLength(1);
      const job = onlyRegisteredJob();

      expect(job.name).toBeUndefined();
      expect(job.cronTime.source).toBe('0 09 * * *');
      expect(job.cronTime.timeZone).toBe('Asia/Seoul');
      expect(job.waitForCompletion).toBe(false);
    });

    it('등록된 cron tick 1회가 마감 다이제스트 발송 1회로 위임되고 기준 시각은 서비스가 정한다', async () => {
      await onlyRegisteredJob().fireOnTick();

      expect(sendDeadlineDigests).toHaveBeenCalledTimes(1);
      expect(sendDeadlineDigests).toHaveBeenCalledWith();
    });

    it('run은 발송 실패를 감싸거나 삼키지 않는다', async () => {
      sendDeadlineDigests.mockRejectedValue(
        new Error('digest delivery failed'),
      );

      await expect(scheduler.run()).rejects.toThrow('digest delivery failed');
    });
  });
});

describe('mail-sender-provider.service', () => {
  const BASE_ENV = { ...process.env };

  const COMPLETE_GMAIL = {
    GMAIL_SENDER: 'synthetic-sender@example.com',
    GMAIL_OAUTH_CLIENT_ID: 'synthetic-client-id',
    GMAIL_OAUTH_CLIENT_SECRET: 'synthetic-client-secret',
    GMAIL_OAUTH_REFRESH_TOKEN: 'synthetic-refresh-token',
  } as const;

  function frozenSnapshot(
    overrides: Partial<Record<keyof RuntimeConfig, string | undefined>> = {},
  ): RuntimeConfig {
    return Object.freeze({
      ...loadRuntimeConfig({}),
      ...overrides,
    });
  }

  async function resolveViaProvider(
    snapshot: RuntimeConfig,
  ): Promise<MailSender> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        mailSenderProvider,
        { provide: RUNTIME_CONFIG, useValue: snapshot },
      ],
    }).compile();
    return moduleRef.get<MailSender>(MAIL_SENDER);
  }

  describe('resolveMailSender / mailSenderProvider', () => {
    afterEach(() => {
      process.env = { ...BASE_ENV };
    });

    it('missing MAIL_MODE throws', () => {
      expect(() =>
        DeadlineDigestService.resolveMailSender(frozenSnapshot({})),
      ).toThrow(/MAIL_MODE/);
    });

    it('blank MAIL_MODE throws', () => {
      expect(() =>
        DeadlineDigestService.resolveMailSender(
          frozenSnapshot({ MAIL_MODE: '   ' }),
        ),
      ).toThrow(/MAIL_MODE/);
    });

    it('invalid MAIL_MODE throws', () => {
      expect(() =>
        DeadlineDigestService.resolveMailSender(
          frozenSnapshot({ MAIL_MODE: 'production' }),
        ),
      ).toThrow(/MAIL_MODE/);
      expect(() =>
        DeadlineDigestService.resolveMailSender(
          frozenSnapshot({ MAIL_MODE: 'real' }),
        ),
      ).toThrow(/MAIL_MODE/);
    });

    it('dry-run with complete credentials resolves LogMailClient', () => {
      const sender = DeadlineDigestService.resolveMailSender(
        frozenSnapshot({
          MAIL_MODE: 'dry-run',
          ...COMPLETE_GMAIL,
        }),
      );
      expect(sender).toBeInstanceOf(LogMailClient);
    });

    it('dry-run with incomplete credentials resolves LogMailClient', () => {
      const sender = DeadlineDigestService.resolveMailSender(
        frozenSnapshot({
          MAIL_MODE: 'dry-run',
        }),
      );
      expect(sender).toBeInstanceOf(LogMailClient);
    });
    it('send with complete four credentials resolves GmailMailClient', () => {
      const sender = DeadlineDigestService.resolveMailSender(
        frozenSnapshot({
          MAIL_MODE: 'send',
          ...COMPLETE_GMAIL,
        }),
      );
      expect(sender).toBeInstanceOf(GmailMailClient);
    });

    it.each([
      ['GMAIL_SENDER'],
      ['GMAIL_OAUTH_CLIENT_ID'],
      ['GMAIL_OAUTH_CLIENT_SECRET'],
      ['GMAIL_OAUTH_REFRESH_TOKEN'],
    ] as const)('send missing %s throws', (missingKey) => {
      const overrides: Partial<
        Record<keyof RuntimeConfig, string | undefined>
      > = {
        MAIL_MODE: 'send',
        ...COMPLETE_GMAIL,
        [missingKey]: undefined,
      };
      expect(() =>
        DeadlineDigestService.resolveMailSender(frozenSnapshot(overrides)),
      ).toThrow(/GMAIL_/);
    });

    it('send with blank Gmail credential throws', () => {
      expect(() =>
        DeadlineDigestService.resolveMailSender(
          frozenSnapshot({
            MAIL_MODE: 'send',
            ...COMPLETE_GMAIL,
            GMAIL_SENDER: '',
          }),
        ),
      ).toThrow(/GMAIL_/);
    });

    it.each([
      ['GMAIL_SENDER'],
      ['GMAIL_OAUTH_CLIENT_ID'],
      ['GMAIL_OAUTH_CLIENT_SECRET'],
      ['GMAIL_OAUTH_REFRESH_TOKEN'],
    ] as const)('send with whitespace-only %s throws', (blankKey) => {
      expect(() =>
        DeadlineDigestService.resolveMailSender(
          frozenSnapshot({
            MAIL_MODE: 'send',
            ...COMPLETE_GMAIL,
            [blankKey]: '   ',
          }),
        ),
      ).toThrow(/GMAIL_/);
    });

    it('provider DI delegates to the same MAIL_MODE policy', async () => {
      const sender = await resolveViaProvider(
        frozenSnapshot({
          MAIL_MODE: 'dry-run',
          ...COMPLETE_GMAIL,
        }),
      );
      expect(sender).toBeInstanceOf(LogMailClient);
    });

    it('contradictory process.env values do not override injected snapshot', async () => {
      process.env = {
        ...BASE_ENV,
        MAIL_MODE: 'send',
        GMAIL_SENDER: 'env-override@example.com',
        GMAIL_OAUTH_CLIENT_ID: 'env-client-id',
        GMAIL_OAUTH_CLIENT_SECRET: 'env-client-secret',
        GMAIL_OAUTH_REFRESH_TOKEN: 'env-refresh-token',
      };

      const sender = await resolveViaProvider(
        frozenSnapshot({
          MAIL_MODE: 'dry-run',
        }),
      );

      expect(sender).toBeInstanceOf(LogMailClient);
    });
  });
});

const NOW = new Date('2026-08-14T00:00:00.000Z');

function source(
  users: DeadlineProgramSource['applications'][number]['members'] = [
    {
      id: 'student-1',
      nickname: '학생 1',
      notificationEmail: 'student-1@example.com',
      notifyEnabled: true,
      accountStatus: AccountStatus.ACTIVE,
    },
  ],
): DeadlineProgramSource {
  const applicant = users[0];
  if (applicant === undefined)
    throw new TypeError('Missing applicant fixture.');
  return {
    id: 'program-1',
    name: '합성 프로그램',
    notifyOnDeadline: true,
    milestones: [
      {
        id: 'milestone-1',
        name: '최종 제출',
        dueAt: new Date('2026-08-14T12:00:00.000Z'),
        documents: [{ id: 'required-1', required: true }],
      },
    ],
    applications: [
      {
        id: 'application-1',
        applicant,
        members: users,
        submittedDocumentIds: [],
      },
    ],
  };
}

function setup() {
  const findAutomaticProgramIds: jest.MockedFunction<
    DeadlineDigestRepositoryPort['findAutomaticProgramIds']
  > = jest.fn().mockResolvedValue(['program-1']);
  const findDeadlineProgram: jest.MockedFunction<
    DeadlineDigestRepositoryPort['findDeadlineProgram']
  > = jest.fn().mockResolvedValue(source());
  const findActiveStaffOrAdmin: jest.MockedFunction<
    DeadlineDigestRepositoryPort['findActiveStaffOrAdmin']
  > = jest.fn().mockResolvedValue(true);
  const findNotifiableStaff: jest.MockedFunction<
    DeadlineDigestRepositoryPort['findNotifiableStaff']
  > = jest
    .fn()
    .mockResolvedValue([
      { id: 'staff-1', notificationEmail: 'staff-1@example.com' },
    ]);
  const claimNotification: jest.MockedFunction<
    DeadlineDigestRepositoryPort['claimNotification']
  > = jest.fn().mockResolvedValue(true);
  const completeNotification: jest.MockedFunction<
    DeadlineDigestRepositoryPort['completeNotification']
  > = jest.fn().mockResolvedValue(undefined);
  const repository: jest.Mocked<DeadlineDigestRepositoryPort> = {
    findAutomaticProgramIds,
    findDeadlineProgram,
    findActiveStaffOrAdmin,
    findNotifiableStaff,
    claimNotification,
    completeNotification,
  };
  const send: jest.MockedFunction<MailSender['send']> = jest
    .fn()
    .mockResolvedValue(undefined);
  return {
    repository,
    findDeadlineProgram,
    findActiveStaffOrAdmin,
    findNotifiableStaff,
    claimNotification,
    completeNotification,
    send,
    service: new DeadlineDigestService(
      repository,
      { send },
      {
        FRONTEND_URL: 'https://oss.example',
      },
    ),
  };
}

describe('DeadlineDigestService Program preview and send', () => {
  it('sends exactly the confirmed personalized bodies across a headline time boundary', async () => {
    const { findDeadlineProgram, send, service } = setup();
    findDeadlineProgram.mockResolvedValue({
      ...source(),
      milestones: source().milestones.map((milestone) => ({
        ...milestone,
        dueAt: new Date(NOW.getTime() + 12 * 3_600_000 + 5 * 60_000),
      })),
    });
    const draft = {
      studentGuidance: 'student-only <note>',
      staffGuidance: 'staff-only note',
    };
    const preview = await service.previewProgram(101n, 'program-1', NOW, draft);

    await service.sendProgramFromPreview(
      101n,
      'program-1',
      { ...preview, ...draft },
      new Date(NOW.getTime() + 6 * 60_000),
    );

    expect(send.mock.calls[0]?.[0]).toEqual({
      to: 'student-1@example.com',
      subject: preview.studentPreviews[0]?.subject,
      body: preview.studentPreviews[0]?.text,
      html: preview.studentPreviews[0]?.html,
    });
    expect(send.mock.calls[1]?.[0]).toEqual({
      to: 'staff-1@example.com',
      subject: preview.staffPreview?.subject,
      body: preview.staffPreview?.text,
      html: preview.staffPreview?.html,
    });
    expect(preview.studentPreviews[0]?.subject).toContain('24시간');
  });

  it('preserves guidance when re-previewing after expiry but never sends automatically or saves it', async () => {
    const { claimNotification, send, service } = setup();
    const draft = {
      studentGuidance: 'temporary student guidance',
      staffGuidance: 'temporary staff guidance',
    };
    const preview = await service.previewProgram(101n, 'program-1', NOW, draft);
    const later = new Date(NOW.getTime() + 10 * 60_000 + 1);

    await expect(
      service.sendProgramFromPreview(
        101n,
        'program-1',
        { ...preview, ...draft },
        later,
      ),
    ).rejects.toMatchObject({ errorCode: { status: 409 } });
    const fresh = await service.previewProgram(101n, 'program-1', later, draft);
    const independent = await service.previewProgram(101n, 'program-1', later);

    expect(fresh.studentPreviews[0]?.text).toContain(draft.studentGuidance);
    expect(fresh.staffPreview?.text).toContain(draft.staffGuidance);
    expect(independent.studentPreviews[0]?.text).not.toContain(
      draft.studentGuidance,
    );
    expect(independent.staffPreview?.text).not.toContain(draft.staffGuidance);
    expect(claimNotification).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('returns rendered preview metadata without private recipient identities or addresses', async () => {
    const { service } = setup();

    const preview = await service.previewProgram(101n, 'program-1', NOW);

    expect(preview).toMatchObject({
      applicationCount: 1,
      milestoneCount: 1,
      recipientCount: 1,
      inactiveCount: 0,
      optedOutCount: 0,
      noEmailCount: 0,
      staffRecipientCount: 1,
      previewedAt: NOW.toISOString(),
      expiresAt: new Date(NOW.getTime() + 10 * 60 * 1000).toISOString(),
    });
    expect(preview.previewVersion).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(preview)).not.toContain('student-1');
    expect(JSON.stringify(preview)).not.toContain('staff-1');
    expect(JSON.stringify(preview)).not.toContain('example.com');
    expect(preview.studentPreviews.map((mail) => mail.displayName)).toEqual([
      '학생 1',
    ]);
    expect(typeof preview.studentPreviews[0]?.subject).toBe('string');
    expect(typeof preview.studentPreviews[0]?.text).toBe('string');
    expect(typeof preview.studentPreviews[0]?.html).toBe('string');
    expect(typeof preview.staffPreview?.subject).toBe('string');
    expect(typeof preview.staffPreview?.text).toBe('string');
    expect(typeof preview.staffPreview?.html).toBe('string');
  });

  it('recomputes the matching preview, sends multipart mail, and claims the Program-recipient daily key', async () => {
    const { claimNotification, send, service } = setup();
    const preview = await service.previewProgram(101n, 'program-1', NOW);

    const result = await service.sendProgramFromPreview(
      101n,
      'program-1',
      {
        previewedAt: preview.previewedAt,
        previewVersion: preview.previewVersion,
      },
      new Date(NOW.getTime() + 60_000),
    );

    expect(result).toMatchObject({
      sentCount: 1,
      duplicateCount: 0,
      failedCount: 0,
    });
    expect(claimNotification).toHaveBeenCalledWith(
      'student-1',
      'deadline-digest:2026-08-14:program-1:student-1',
      { milestoneCount: 1 },
    );
    const sentMail = send.mock.calls[0]?.[0];
    expect(sentMail?.to).toBe('student-1@example.com');
    expect(sentMail?.body).toContain('합성 프로그램');
    expect(sentMail?.html).toContain('합성 프로그램');
  });

  it('교직원 요약을 미제출자 명단과 함께 학생과 다른 멱등 키로 보낸다', async () => {
    const { claimNotification, send, service } = setup();
    const preview = await service.previewProgram(101n, 'program-1', NOW);

    const result = await service.sendProgramFromPreview(
      101n,
      'program-1',
      preview,
      new Date(NOW.getTime() + 60_000),
    );

    expect(result.staffRecipientCount).toBe(1);
    expect(claimNotification).toHaveBeenCalledWith(
      'staff-1',
      'deadline-digest-staff:2026-08-14:program-1:staff-1',
      { milestoneCount: 1 },
    );
    const staffMail = send.mock.calls
      .map((call) => call[0])
      .find((mail) => mail.to === 'staff-1@example.com');
    expect(staffMail?.body).toContain('미제출자: 학생 1');
    expect(staffMail?.html).toContain('/dashboard');
  });

  it('미제출 명단에 비활성·수신 거부·이메일 없음으로 제외된 사람도 사유와 함께 남긴다', async () => {
    const { findDeadlineProgram, send, service } = setup();
    findDeadlineProgram.mockResolvedValue(
      source([
        {
          id: 'student-1',
          nickname: '학생 1',
          notificationEmail: 'student-1@example.com',
          notifyEnabled: true,
          accountStatus: AccountStatus.ACTIVE,
        },
        {
          id: 'student-2',
          nickname: '학생 2',
          notificationEmail: 'student-2@example.com',
          notifyEnabled: true,
          accountStatus: AccountStatus.DEACTIVATED,
        },
        {
          id: 'student-3',
          nickname: '학생 3',
          notificationEmail: 'student-3@example.com',
          notifyEnabled: false,
          accountStatus: AccountStatus.ACTIVE,
        },
        {
          id: 'student-4',
          nickname: '학생 4',
          notificationEmail: null,
          notifyEnabled: true,
          accountStatus: AccountStatus.ACTIVE,
        },
      ]),
    );
    const preview = await service.previewProgram(101n, 'program-1', NOW);

    await service.sendProgramFromPreview(
      101n,
      'program-1',
      preview,
      new Date(NOW.getTime() + 60_000),
    );

    const staffMail = send.mock.calls
      .map((call) => call[0])
      .find((mail) => mail.to === 'staff-1@example.com');
    expect(staffMail?.body).toContain(
      '미제출자: 학생 1, 학생 2 (비활성), 학생 3 (수신 거부), 학생 4 (이메일 없음)',
    );
  });

  it('교직원이 같은 프로그램의 팀원을 겸해도 두 통이 각자의 멱등 키로 나간다', async () => {
    const { claimNotification, findNotifiableStaff, send, service } = setup();
    findNotifiableStaff.mockResolvedValue([
      { id: 'student-1', notificationEmail: 'student-1@example.com' },
    ]);
    const preview = await service.previewProgram(101n, 'program-1', NOW);

    await service.sendProgramFromPreview(
      101n,
      'program-1',
      preview,
      new Date(NOW.getTime() + 60_000),
    );

    expect(send).toHaveBeenCalledTimes(2);
    expect(claimNotification.mock.calls.map((call) => call[1])).toEqual(
      expect.arrayContaining([
        'deadline-digest:2026-08-14:program-1:student-1',
        'deadline-digest-staff:2026-08-14:program-1:student-1',
      ]),
    );
  });

  it('교직원 수신자가 바뀌면 확인하지 않은 메일을 보내지 않는다', async () => {
    const { findNotifiableStaff, service, send } = setup();
    const preview = await service.previewProgram(101n, 'program-1', NOW);

    findNotifiableStaff.mockResolvedValue([
      { id: 'staff-1', notificationEmail: 'staff-1@example.com' },
      { id: 'staff-2', notificationEmail: 'staff-2@example.com' },
    ]);

    await expect(
      service.sendProgramFromPreview(
        101n,
        'program-1',
        preview,
        new Date(NOW.getTime() + 60_000),
      ),
    ).rejects.toMatchObject({ errorCode: { status: 409 } });
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects a preview after ten minutes or when canonical eligibility changed', async () => {
    const { claimNotification, findDeadlineProgram, send, service } = setup();
    const preview = await service.previewProgram(101n, 'program-1', NOW);

    claimNotification.mockResolvedValue(false);
    await expect(
      service.sendProgramFromPreview(
        101n,
        'program-1',
        preview,
        new Date(NOW.getTime() + 10 * 60 * 1000),
      ),
    ).resolves.toMatchObject({ duplicateCount: 1 });
    await expect(
      service.sendProgramFromPreview(
        101n,
        'program-1',
        preview,
        new Date(NOW.getTime() + 10 * 60 * 1000 + 1),
      ),
    ).rejects.toMatchObject({ errorCode: { status: 409 } });

    findDeadlineProgram.mockResolvedValue({
      ...source(),
      milestones: source().milestones.map((milestone) => ({
        ...milestone,
        dueAt: new Date('2026-08-14T13:00:00.000Z'),
      })),
    });
    await expect(
      service.sendProgramFromPreview(
        101n,
        'program-1',
        preview,
        new Date(NOW.getTime() + 60_000),
      ),
    ).rejects.toMatchObject({ errorCode: { status: 409 } });
    expect(send).not.toHaveBeenCalled();
  });

  it('returns 403 before reading Program eligibility for a student caller', async () => {
    const { findActiveStaffOrAdmin, findDeadlineProgram, service } = setup();
    findActiveStaffOrAdmin.mockResolvedValue(false);

    const result = service.previewProgram(202n, 'program-1', NOW);

    await expect(result).rejects.toBeInstanceOf(DomainException);
    await expect(result).rejects.toMatchObject({ errorCode: { status: 403 } });
    expect(findDeadlineProgram).not.toHaveBeenCalled();
  });
});

describe('DeadlineDigestService delivery isolation and automatic sharing', () => {
  it('shares Program eligibility with automatic delivery and continues after one SMTP failure', async () => {
    const recipients = [
      {
        id: 'student-1',
        nickname: '학생 1',
        notificationEmail: 'student-1@example.com',
        notifyEnabled: true,
        accountStatus: AccountStatus.ACTIVE,
      },
      {
        id: 'student-2',
        nickname: '학생 2',
        notificationEmail: 'student-2@example.com',
        notifyEnabled: true,
        accountStatus: AccountStatus.ACTIVE,
      },
    ];
    const { completeNotification, findDeadlineProgram, send, service } =
      setup();
    findDeadlineProgram.mockResolvedValue(source(recipients));
    send.mockRejectedValueOnce(
      new Error('SMTP leaked-recipient@example.test token=provider-secret'),
    );

    await service.sendDeadlineDigests(NOW);

    expect(send).toHaveBeenCalledTimes(2);
    expect(completeNotification).toHaveBeenCalledWith(
      'deadline-digest:2026-08-14:program-1:student-1',
      'FAILED',
      {
        milestoneCount: 1,
        code: 'MAIL_DELIVERY_FAILED',
        message: '메일 발송에 실패했습니다.',
      },
    );
    expect(completeNotification).toHaveBeenCalledWith(
      'deadline-digest:2026-08-14:program-1:student-2',
      'SENT',
      { milestoneCount: 1 },
    );
    expect(JSON.stringify(completeNotification.mock.calls)).not.toContain(
      'provider-secret',
    );
  });

  it('자동 발송은 교직원 요약을 만들지도 보내지도 않는다', async () => {
    const { claimNotification, findNotifiableStaff, send, service } = setup();

    await service.sendDeadlineDigests(NOW);

    expect(findNotifiableStaff).not.toHaveBeenCalled();
    expect(send.mock.calls.map((call) => call[0].to)).toEqual([
      'student-1@example.com',
    ]);
    expect(claimNotification.mock.calls.map((call) => call[1])).toEqual([
      'deadline-digest:2026-08-14:program-1:student-1',
    ]);
  });
});
