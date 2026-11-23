import { MailPreviewService } from './mail-preview.service';
import {
  DeadlineDigestMailService,
  mailSenderProvider,
} from './deadline-digest-mail.service';
import { ScheduleModule, SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModule } from '@nestjs/testing';
import { DeadlineDigestService } from './deadline-digest.service';
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
import type { DeadlineDigestRepositoryPort } from './deadline-digest.repository';

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
        { accept: jest.fn() },
        { FRONTEND_URL: 'https://oss.example' },
        new DeadlineDigestMailService(),
        new MailPreviewService(),
        { legacyDigest: jest.fn() },
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
        DeadlineDigestMailService,
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
        new DeadlineDigestMailService().resolveMailSender(frozenSnapshot({})),
      ).toThrow(/MAIL_MODE/);
    });

    it('blank MAIL_MODE throws', () => {
      expect(() =>
        new DeadlineDigestMailService().resolveMailSender(
          frozenSnapshot({ MAIL_MODE: '   ' }),
        ),
      ).toThrow(/MAIL_MODE/);
    });

    it('invalid MAIL_MODE throws', () => {
      expect(() =>
        new DeadlineDigestMailService().resolveMailSender(
          frozenSnapshot({ MAIL_MODE: 'production' }),
        ),
      ).toThrow(/MAIL_MODE/);
      expect(() =>
        new DeadlineDigestMailService().resolveMailSender(
          frozenSnapshot({ MAIL_MODE: 'real' }),
        ),
      ).toThrow(/MAIL_MODE/);
    });

    it('dry-run with complete credentials resolves LogMailClient', () => {
      const sender = new DeadlineDigestMailService().resolveMailSender(
        frozenSnapshot({
          MAIL_MODE: 'dry-run',
          ...COMPLETE_GMAIL,
        }),
      );
      expect(sender).toBeInstanceOf(LogMailClient);
    });

    it('dry-run with incomplete credentials resolves LogMailClient', () => {
      const sender = new DeadlineDigestMailService().resolveMailSender(
        frozenSnapshot({
          MAIL_MODE: 'dry-run',
        }),
      );
      expect(sender).toBeInstanceOf(LogMailClient);
    });
    it('send with complete four credentials resolves GmailMailClient', () => {
      const sender = new DeadlineDigestMailService().resolveMailSender(
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
        new DeadlineDigestMailService().resolveMailSender(
          frozenSnapshot(overrides),
        ),
      ).toThrow(/GMAIL_/);
    });

    it('send with blank Gmail credential throws', () => {
      expect(() =>
        new DeadlineDigestMailService().resolveMailSender(
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
        new DeadlineDigestMailService().resolveMailSender(
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
