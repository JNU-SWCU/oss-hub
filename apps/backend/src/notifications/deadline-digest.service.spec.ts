import { AccountStatus } from '@prisma/client';
import { DomainException } from '../common/error-code';
import type { DeadlineProgramSource } from './deadline-digest-eligibility';
import { DeadlineDigestService } from './deadline-digest.service';
import type { DeadlineDigestRepositoryPort } from './deadline-digest.repository';
import type { MailSender } from './mail-sender.port';

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
  it('returns count-only preview metadata without recipient or eligibility identities', async () => {
    // Given
    const { service } = setup();

    // When
    const preview = await service.previewProgram(101n, 'program-1', NOW);

    // Then
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
    expect(JSON.stringify(preview)).not.toContain('milestone-1');
  });

  it('recomputes the matching preview, sends multipart mail, and claims the Program-recipient daily key', async () => {
    // Given
    const { claimNotification, send, service } = setup();
    const preview = await service.previewProgram(101n, 'program-1', NOW);

    // When
    const result = await service.sendProgramFromPreview(
      101n,
      'program-1',
      {
        previewedAt: preview.previewedAt,
        previewVersion: preview.previewVersion,
      },
      new Date(NOW.getTime() + 60_000),
    );

    // Then
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
    // Given
    const { claimNotification, send, service } = setup();
    const preview = await service.previewProgram(101n, 'program-1', NOW);

    // When
    const result = await service.sendProgramFromPreview(
      101n,
      'program-1',
      preview,
      new Date(NOW.getTime() + 60_000),
    );

    // Then
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
    // Given
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

    // When
    await service.sendProgramFromPreview(
      101n,
      'program-1',
      preview,
      new Date(NOW.getTime() + 60_000),
    );

    // Then
    const staffMail = send.mock.calls
      .map((call) => call[0])
      .find((mail) => mail.to === 'staff-1@example.com');
    expect(staffMail?.body).toContain(
      '미제출자: 학생 1, 학생 2 (비활성), 학생 3 (수신 거부), 학생 4 (이메일 없음)',
    );
  });

  it('교직원이 같은 프로그램의 팀원을 겸해도 두 통이 각자의 멱등 키로 나간다', async () => {
    // Given: 교직원 계정 id가 학생 수신자 id와 같다.
    const { claimNotification, findNotifiableStaff, send, service } = setup();
    findNotifiableStaff.mockResolvedValue([
      { id: 'student-1', notificationEmail: 'student-1@example.com' },
    ]);
    const preview = await service.previewProgram(101n, 'program-1', NOW);

    // When
    await service.sendProgramFromPreview(
      101n,
      'program-1',
      preview,
      new Date(NOW.getTime() + 60_000),
    );

    // Then
    expect(send).toHaveBeenCalledTimes(2);
    expect(claimNotification.mock.calls.map((call) => call[1])).toEqual(
      expect.arrayContaining([
        'deadline-digest:2026-08-14:program-1:student-1',
        'deadline-digest-staff:2026-08-14:program-1:student-1',
      ]),
    );
  });

  it('교직원 알림 설정이 바뀌어도 미리보기를 stale로 만들지 않는다', async () => {
    // Given
    const { findNotifiableStaff, service } = setup();
    const preview = await service.previewProgram(101n, 'program-1', NOW);

    // When: 미리보기 이후 교직원 한 명이 수신을 켰다.
    findNotifiableStaff.mockResolvedValue([
      { id: 'staff-1', notificationEmail: 'staff-1@example.com' },
      { id: 'staff-2', notificationEmail: 'staff-2@example.com' },
    ]);

    // Then: 학생 발송이 409로 막히지 않고, 새 인원 수가 결과에 반영된다.
    await expect(
      service.sendProgramFromPreview(
        101n,
        'program-1',
        preview,
        new Date(NOW.getTime() + 60_000),
      ),
    ).resolves.toMatchObject({ sentCount: 1, staffRecipientCount: 2 });
  });

  it('rejects a preview after ten minutes or when canonical eligibility changed', async () => {
    // Given
    const { claimNotification, findDeadlineProgram, send, service } = setup();
    const preview = await service.previewProgram(101n, 'program-1', NOW);

    // When / Then: exactly ten minutes remains valid; after it is stale.
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
    // Given
    const { findActiveStaffOrAdmin, findDeadlineProgram, service } = setup();
    findActiveStaffOrAdmin.mockResolvedValue(false);

    // When
    const result = service.previewProgram(202n, 'program-1', NOW);

    // Then
    await expect(result).rejects.toBeInstanceOf(DomainException);
    await expect(result).rejects.toMatchObject({ errorCode: { status: 403 } });
    expect(findDeadlineProgram).not.toHaveBeenCalled();
  });
});

describe('DeadlineDigestService delivery isolation and automatic sharing', () => {
  it('shares Program eligibility with automatic delivery and continues after one SMTP failure', async () => {
    // Given
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

    // When
    await service.sendDeadlineDigests(NOW);

    // Then
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
    // Given
    const { claimNotification, findNotifiableStaff, send, service } = setup();

    // When
    await service.sendDeadlineDigests(NOW);

    // Then
    expect(findNotifiableStaff).not.toHaveBeenCalled();
    expect(send.mock.calls.map((call) => call[0].to)).toEqual([
      'student-1@example.com',
    ]);
    expect(claimNotification.mock.calls.map((call) => call[1])).toEqual([
      'deadline-digest:2026-08-14:program-1:student-1',
    ]);
  });
});
