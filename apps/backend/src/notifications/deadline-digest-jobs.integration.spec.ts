import { MailJobConfig } from './mail-job.config';
import { createOwnedIntegrationDatabase } from '../../test/owned-integration-database.fixture';
import { AccountStatus } from '@prisma/client';
import { DeadlineDigestService } from './deadline-digest.service';
import { DeadlineDigestMailService } from './deadline-digest-mail.service';
import { MailPreviewService } from './mail-preview.service';
import { MailJobWorkerService } from './mail-job-worker.service';
import { MailJobClaimRepository } from './mail-job-claim.repository';
import { MailJobAdmissionRepository } from './mail-job-admission.repository';
import { MailJobResultRepository } from './mail-job-result.repository';
import type {
  DeadlineDigestRepositoryPort,
  DeadlineProgramSource,
} from './deadline-digest.repository';
import type { MailSender } from './gmail-mail.client';
const NOW = new Date('2026-08-14T00:00:00.000Z');

function source(
  users: DeadlineProgramSource['teams'][number]['members'] = [
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
        requirements: [{ id: 'required-1', required: true }],
      },
    ],
    teams: [
      {
        id: 'application-1',
        applicant,
        members: users,
        submittedDocumentIds: [],
      },
    ],
  };
}

let database: Awaited<ReturnType<typeof createOwnedIntegrationDatabase>>;
beforeEach(async () => {
  database = await createOwnedIntegrationDatabase();
  const p = database.prisma;
  await p.program.create({
    data: {
      id: 'program-1',
      name: '합성 프로그램',
      category: 'BASIC',
      applicationTemplateKey: 'synthetic',
      applicationTemplateVersion: 1,
      applicationStartAt: new Date('2026-08-01'),
      applicationEndAt: new Date('2026-08-13'),
      startAt: NOW,
      endAt: new Date('2026-08-31'),
      description: '',
    },
  });
  const ids = [
    'staff-actor',
    'staff-1',
    'staff-2',
    'student-1',
    'student-2',
    'student-3',
    'student-4',
  ];
  await p.user.createMany({
    data: ids.map((id, i) => ({
      id,
      nickname: id,
      githubId: BigInt(991000 + i),
    })),
  });
  await p.mailControl.update({ where: { id: 1 }, data: { mode: 'PAUSED' } });
  await p.mailControl.update({ where: { id: 1 }, data: { mode: 'JOBS' } });
}, 90000);
afterEach(async () => {
  await database?.close();
});
function setup() {
  const p = database.prisma;
  let at = NOW;
  const findDeadlineProgram = jest
    .fn<
      ReturnType<DeadlineDigestRepositoryPort['findDeadlineProgram']>,
      Parameters<DeadlineDigestRepositoryPort['findDeadlineProgram']>
    >()
    .mockResolvedValue(source());
  const findNotifiableStaff = jest
    .fn<
      ReturnType<DeadlineDigestRepositoryPort['findNotifiableStaff']>,
      Parameters<DeadlineDigestRepositoryPort['findNotifiableStaff']>
    >()
    .mockResolvedValue([
      { id: 'staff-1', notificationEmail: 'staff-1@example.com' },
    ]);
  const repository = {
    findDeadlineProgram,
    findNotifiableStaff,
    findAutomaticProgramIds: jest.fn().mockResolvedValue(['program-1']),
  };
  const jobs = new MailJobAdmissionRepository(p),
    results = new MailJobResultRepository(p);
  const send = jest
    .fn<ReturnType<MailSender['send']>, Parameters<MailSender['send']>>()
    .mockResolvedValue(undefined);
  const producer = new DeadlineDigestService(
    repository,
    {
      accept: (intent, prepare) => jobs.accept(intent, (tx) => prepare(tx, at)),
    },
    { FRONTEND_URL: 'https://oss.example' },
    new DeadlineDigestMailService(),
    new MailPreviewService(),
    results,
  );
  const worker = new MailJobWorkerService(
    new MailJobClaimRepository(p, results),
    { send },
    {
      prepareJob: (id, _now, anchor, guidance, manual, tx) =>
        producer.prepareJob(id, at, anchor, guidance, manual, tx),
    },
  );
  const drain = async () => {
    while (await worker.step()) continue;
  };
  const service = {
    previewProgram: producer.previewProgram.bind(producer),
    async sendProgramFromPreview(
      id: string,
      preview: Parameters<DeadlineDigestService['accept']>[1],
      actor: string,
      now: Date,
    ) {
      at = now;
      const job = await producer.accept(id, preview, actor, true);
      await drain();
      return results.legacyDigest(
        id,
        job.jobId,
        job.replay,
        preview.previewVersion,
      );
    },
    async sendDeadlineDigests(now: Date) {
      at = now;
      await producer.sendDeadlineDigests(now);
      await drain();
    },
  };
  const keys = async () =>
    (
      await p.mailRecipient.findMany({
        select: { deliveryKey: true },
        take: 10,
        orderBy: { deliveryKey: 'asc' },
      })
    ).map((row) => row.deliveryKey);
  const key = (user: string, staff = false) =>
    (staff ? 'deadline-digest-staff' : 'deadline-digest') +
    ':' +
    MailJobConfig.seoulDay(new Date()) +
    ':program-1:' +
    user;
  return {
    service,
    keys,
    key,
    send,
    findDeadlineProgram,
    findNotifiableStaff,
    p,
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
    const preview = await service.previewProgram('program-1', NOW, draft);

    await service.sendProgramFromPreview(
      'program-1',
      { ...preview, ...draft },
      'staff-actor',
      new Date(NOW.getTime() + 6 * 60_000),
    );

    expect(
      send.mock.calls.find(
        ([mail]) => mail.to === 'student-1@example.com',
      )?.[0],
    ).toEqual({
      to: 'student-1@example.com',
      subject: preview.studentPreviews[0]?.subject,
      body: preview.studentPreviews[0]?.text,
      html: preview.studentPreviews[0]?.html,
    });
    expect(
      send.mock.calls.find(([mail]) => mail.to === 'staff-1@example.com')?.[0],
    ).toEqual({
      to: 'staff-1@example.com',
      subject: preview.staffPreview?.subject,
      body: preview.staffPreview?.text,
      html: preview.staffPreview?.html,
    });
    expect(preview.studentPreviews[0]?.subject).toContain('24시간');
  });

  it('preserves guidance when re-previewing after expiry but never sends automatically or saves it', async () => {
    const { keys, send, service } = setup();
    const draft = {
      studentGuidance: 'temporary student guidance',
      staffGuidance: 'temporary staff guidance',
    };
    const preview = await service.previewProgram('program-1', NOW, draft);
    const later = new Date(NOW.getTime() + 10 * 60_000 + 1);

    await expect(
      service.sendProgramFromPreview(
        'program-1',
        { ...preview, ...draft },
        'staff-actor',
        later,
      ),
    ).rejects.toMatchObject({ errorCode: { status: 409 } });
    const fresh = await service.previewProgram('program-1', later, draft);
    const independent = await service.previewProgram('program-1', later);

    expect(fresh.studentPreviews[0]?.text).toContain(draft.studentGuidance);
    expect(fresh.staffPreview?.text).toContain(draft.staffGuidance);
    expect(independent.studentPreviews[0]?.text).not.toContain(
      draft.studentGuidance,
    );
    expect(independent.staffPreview?.text).not.toContain(draft.staffGuidance);
    expect(await keys()).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it('returns rendered preview metadata without private recipient identities or addresses', async () => {
    const { service } = setup();

    const preview = await service.previewProgram('program-1', NOW);

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
    const { keys, key, send, service } = setup();
    const preview = await service.previewProgram('program-1', NOW);

    const result = await service.sendProgramFromPreview(
      'program-1',
      {
        previewedAt: preview.previewedAt,
        previewVersion: preview.previewVersion,
      },
      'staff-actor',
      new Date(NOW.getTime() + 60_000),
    );

    expect(result).toMatchObject({
      sentCount: 1,
      duplicateCount: 0,
      failedCount: 0,
    });
    expect(await keys()).toContain(key('student-1'));
    const sentMail = send.mock.calls.find(
      ([mail]) => mail.to === 'student-1@example.com',
    )?.[0];
    expect(sentMail?.to).toBe('student-1@example.com');
    expect(sentMail?.body).toContain('합성 프로그램');
    expect(sentMail?.html).toContain('합성 프로그램');
  });

  it('교직원 요약을 미제출자 명단과 함께 학생과 다른 멱등 키로 보낸다', async () => {
    const { keys, key, send, service } = setup();
    const preview = await service.previewProgram('program-1', NOW);

    const result = await service.sendProgramFromPreview(
      'program-1',
      preview,
      'staff-actor',
      new Date(NOW.getTime() + 60_000),
    );

    expect(result.staffRecipientCount).toBe(1);
    expect(await keys()).toContain(key('staff-1', true));
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
    const preview = await service.previewProgram('program-1', NOW);

    await service.sendProgramFromPreview(
      'program-1',
      preview,
      'staff-actor',
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
    const { keys, key, findNotifiableStaff, send, service } = setup();
    findNotifiableStaff.mockResolvedValue([
      { id: 'student-1', notificationEmail: 'student-1@example.com' },
    ]);
    const preview = await service.previewProgram('program-1', NOW);

    await service.sendProgramFromPreview(
      'program-1',
      preview,
      'staff-actor',
      new Date(NOW.getTime() + 60_000),
    );

    expect(send).toHaveBeenCalledTimes(2);
    expect(await keys()).toEqual(
      expect.arrayContaining([key('student-1'), key('student-1', true)]),
    );
  });

  it('교직원 수신자가 바뀌면 확인하지 않은 메일을 보내지 않는다', async () => {
    const { findNotifiableStaff, service, send } = setup();
    const preview = await service.previewProgram('program-1', NOW);

    findNotifiableStaff.mockResolvedValue([
      { id: 'staff-1', notificationEmail: 'staff-1@example.com' },
      { id: 'staff-2', notificationEmail: 'staff-2@example.com' },
    ]);

    await expect(
      service.sendProgramFromPreview(
        'program-1',
        preview,
        'staff-actor',
        new Date(NOW.getTime() + 60_000),
      ),
    ).rejects.toMatchObject({ errorCode: { status: 409 } });
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects a preview after ten minutes or when canonical eligibility changed', async () => {
    const { key, findDeadlineProgram, send, service } = setup();
    const preview = await service.previewProgram('program-1', NOW);

    const mode = (mode: 'JOBS' | 'LEGACY' | 'PAUSED') =>
      database.prisma.mailControl.update({ where: { id: 1 }, data: { mode } });
    await mode('PAUSED');
    await mode('LEGACY');
    await database.prisma.notification.createMany({
      data: [
        ['student-1', key('student-1')],
        ['staff-1', key('staff-1', true)],
      ].map(([id, k]) => ({
        userId: id!,
        type: 'DEADLINE_DIGEST',
        channel: 'EMAIL',
        status: 'SENT',
        idempotencyKey: k,
        payload: {},
      })),
    });
    await mode('PAUSED');
    await mode('JOBS');
    await expect(
      service.sendProgramFromPreview(
        'program-1',
        preview,
        'staff-actor',
        new Date(NOW.getTime() + 10 * 60 * 1000),
      ),
    ).resolves.toMatchObject({ duplicateCount: 1 });
    const freshIntent = await service.previewProgram(
      'program-1',
      new Date(NOW.getTime() + 1),
    );
    await expect(
      service.sendProgramFromPreview(
        'program-1',
        freshIntent,
        'staff-actor',
        new Date(NOW.getTime() + 10 * 60 * 1000 + 2),
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
        'program-1',
        freshIntent,
        'staff-actor',
        new Date(NOW.getTime() + 60_000),
      ),
    ).rejects.toMatchObject({ errorCode: { status: 409 } });
    expect(send).not.toHaveBeenCalled();
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
    const { p, key, findDeadlineProgram, send, service } = setup();
    findDeadlineProgram.mockResolvedValue(source(recipients));
    send.mockRejectedValueOnce(
      Object.assign(
        new Error('SMTP leaked-recipient@example.test token=provider-secret'),
        { responseCode: 550 },
      ),
    );

    await service.sendDeadlineDigests(NOW);

    expect(send).toHaveBeenCalledTimes(2);
    const ledger = await p.mailRecipient.findMany({
      take: 3,
      orderBy: { ordinal: 'asc' },
      select: { deliveryKey: true, state: true, envelope: true, reason: true },
    });
    expect(ledger).toEqual([
      {
        deliveryKey: key('student-1'),
        state: 'FAILED',
        envelope: null,
        reason: null,
      },
      {
        deliveryKey: key('student-2'),
        state: 'SENT',
        envelope: null,
        reason: null,
      },
    ]);
    expect(JSON.stringify(ledger)).not.toContain('provider-secret');
  });

  it('자동 발송은 교직원 요약을 만들지도 보내지도 않는다', async () => {
    const { keys, key, findNotifiableStaff, send, service } = setup();

    await service.sendDeadlineDigests(NOW);

    expect(findNotifiableStaff).not.toHaveBeenCalled();
    expect(send.mock.calls.map((call) => call[0].to)).toEqual([
      'student-1@example.com',
    ]);
    expect(await keys()).toEqual([key('student-1')]);
  });
});
