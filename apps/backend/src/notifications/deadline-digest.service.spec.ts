import { AccountStatus } from '@prisma/client';
import { DeadlineDigestService } from './deadline-digest.service';
import type { DeadlineDigestRepositoryPort } from './deadline-digest.repository';
import type { MailSender } from './mail-sender.port';

describe('DeadlineDigestService', () => {
  const findUpcomingDeadlineMilestones = jest.fn();
  const findStaffRecipients = jest.fn();
  const findMissingSubmitters = jest.fn();
  const claimNotification = jest.fn();
  const completeNotification = jest.fn();
  const send: jest.MockedFunction<MailSender['send']> = jest.fn();
  const repository = {
    findUpcomingDeadlineMilestones,
    findStaffRecipients,
    findMissingSubmitters,
    claimNotification,
    completeNotification,
  } as unknown as DeadlineDigestRepositoryPort;
  const mailSender: MailSender = { send };
  const service = new DeadlineDigestService(repository, mailSender);

  const milestone = {
    id: 'm1',
    programId: 'p1',
    programName: '전국 디지털 경진대회',
    milestoneName: '최종 제출',
    dueAt: new Date('2026-08-15T00:00:00.000Z'),
  };
  const now = new Date('2026-08-14T00:00:00.000Z');

  beforeEach(() => {
    findUpcomingDeadlineMilestones.mockReset();
    findStaffRecipients.mockReset();
    claimNotification.mockReset().mockResolvedValue(true);
    completeNotification.mockReset().mockResolvedValue(undefined);
    findMissingSubmitters.mockReset().mockResolvedValue(new Map());
    send.mockReset().mockResolvedValue(undefined);
  });

  it('마감 임박 마일스톤이 없으면 수신자 조회·발송을 하지 않는다', async () => {
    findUpcomingDeadlineMilestones.mockResolvedValue([]);

    await service.sendDeadlineDigests(now);

    expect(findStaffRecipients).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(claimNotification).not.toHaveBeenCalled();
  });

  it('마감 임박 마일스톤이 있으면 각 교직원 수신자에게 발송하고 SENT를 기록한다', async () => {
    findUpcomingDeadlineMilestones.mockResolvedValue([milestone]);
    findStaffRecipients.mockResolvedValue([
      { id: 's1', notificationEmail: 'a@example.com' },
      { id: 's2', notificationEmail: 'b@example.com' },
    ]);

    await service.sendDeadlineDigests(now);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'a@example.com' }),
    );
    expect(completeNotification).toHaveBeenCalledWith(
      'deadline-digest:2026-08-14:s1',
      'SENT',
      expect.any(Object),
    );
    expect(completeNotification).toHaveBeenCalledWith(
      'deadline-digest:2026-08-14:s2',
      'SENT',
      expect.any(Object),
    );
  });
  it('미제출 동의 학생에게 마일스톤별 중복 없이 한 번만 발송하고 현지 시각을 표기한다', async () => {
    findUpcomingDeadlineMilestones.mockResolvedValue([milestone]);
    findStaffRecipients.mockResolvedValue([
      { id: 's1', notificationEmail: 'staff@example.com' },
    ]);
    findMissingSubmitters.mockResolvedValue(
      new Map([
        [
          'm1',
          [
            {
              id: 'student-1',
              nickname: '미제출학생',
              notificationEmail: 'student@example.com',
              notifyEnabled: true,
              accountStatus: AccountStatus.ACTIVE,
            },
            {
              id: 'student-1',
              nickname: '미제출학생',
              notificationEmail: 'student@example.com',
              notifyEnabled: true,
              accountStatus: AccountStatus.ACTIVE,
            },
            {
              id: 'student-2',
              nickname: '수신거부학생',
              notificationEmail: 'opt-out@example.com',
              notifyEnabled: false,
              accountStatus: AccountStatus.ACTIVE,
            },
            {
              // 알림을 켜 두었지만 계정이 비활성 — 리마인더 대상이 아니다(QA41).
              id: 'student-3',
              nickname: '비활성학생',
              notificationEmail: 'deactivated@example.com',
              notifyEnabled: true,
              accountStatus: AccountStatus.DEACTIVATED,
            },
          ],
        ],
      ]),
    );

    await service.sendDeadlineDigests(now);

    expect(send).toHaveBeenCalledTimes(2);

    const sentTo = (address: string): string | undefined =>
      send.mock.calls
        .map(([message]) => message)
        .find((message) => message.to === address)?.body;

    // 비활성 학생도 집계에는 남는다 — 명단에서 지우면 교직원이 미제출 건을 놓친다.
    // 대신 비활성 계정에만 표시를 붙인다. 수신 거부는 계정 상태가 아니므로 표시하지 않고,
    // 활성 계정에 표시가 붙으면 표시 자체가 뜻을 잃으므로 이 문자열 전체로 고정한다.
    expect(sentTo('staff@example.com')).toContain(
      '미제출자: 미제출학생, 미제출학생, 수신거부학생, 비활성학생 (비활성)',
    );
    // 수신 거부는 비활성이 아니다 — 둘을 같은 표시로 묶지 않는다.
    expect(sentTo('staff@example.com')).not.toContain('수신거부학생 (비활성)');
    expect(sentTo('student@example.com')).toContain(
      '2026. 08. 15. 09:00 (Asia/Seoul)',
    );
    expect(sentTo('opt-out@example.com')).toBeUndefined();
    // 그러나 본인에게는 보내지 않는다 — 로그인이 막혀 제출할 수 없는 계정이다(QA41).
    expect(sentTo('deactivated@example.com')).toBeUndefined();
  });

  it('발송이 실패하면 FAILED를 기록하고 다음 수신자로 계속한다', async () => {
    findUpcomingDeadlineMilestones.mockResolvedValue([milestone]);
    findStaffRecipients.mockResolvedValue([
      { id: 's1', notificationEmail: 'a@example.com' },
      { id: 's2', notificationEmail: 'b@example.com' },
    ]);
    send.mockRejectedValueOnce(new Error('smtp down'));

    await service.sendDeadlineDigests(now);

    expect(completeNotification).toHaveBeenCalledWith(
      'deadline-digest:2026-08-14:s1',
      'FAILED',
      expect.objectContaining({ error: 'smtp down' }),
    );
    expect(completeNotification).toHaveBeenCalledWith(
      'deadline-digest:2026-08-14:s2',
      'SENT',
      expect.any(Object),
    );
  });
  it('same-day claimed digest is not sent again', async () => {
    findUpcomingDeadlineMilestones.mockResolvedValue([milestone]);
    findStaffRecipients.mockResolvedValue([
      { id: 's1', notificationEmail: 'a@example.com' },
    ]);
    claimNotification.mockResolvedValue(false);

    await service.sendDeadlineDigests(now);

    expect(send).not.toHaveBeenCalled();
    expect(completeNotification).not.toHaveBeenCalled();
    expect(claimNotification).toHaveBeenCalledWith(
      's1',
      'deadline-digest:2026-08-14:s1',
      { milestoneCount: 1 },
    );
  });
});
