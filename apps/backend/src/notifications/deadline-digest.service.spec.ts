import { DeadlineDigestService } from './deadline-digest.service';
import type { DeadlineDigestRepositoryPort } from './deadline-digest.repository';
import type { MailSender } from './mail-sender.port';

describe('DeadlineDigestService', () => {
  const findUpcomingDeadlineMilestones = jest.fn();
  const findStaffRecipients = jest.fn();
  const findMissingSubmitters = jest.fn();
  const recordNotification = jest.fn();
  const send = jest.fn();
  const repository = {
    findUpcomingDeadlineMilestones,
    findStaffRecipients,
    findMissingSubmitters,
    recordNotification,
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
    recordNotification.mockReset().mockResolvedValue(undefined);
    findMissingSubmitters.mockReset().mockResolvedValue(new Map());
    send.mockReset().mockResolvedValue(undefined);
  });

  it('마감 임박 마일스톤이 없으면 수신자 조회·발송을 하지 않는다', async () => {
    findUpcomingDeadlineMilestones.mockResolvedValue([]);

    await service.sendDeadlineDigests(now);

    expect(findStaffRecipients).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(recordNotification).not.toHaveBeenCalled();
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
    expect(recordNotification).toHaveBeenCalledWith(
      's1',
      'SENT',
      expect.any(Object),
    );
    expect(recordNotification).toHaveBeenCalledWith(
      's2',
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
            },
            {
              id: 'student-1',
              nickname: '미제출학생',
              notificationEmail: 'student@example.com',
              notifyEnabled: true,
            },
            {
              id: 'student-2',
              nickname: '수신거부학생',
              notificationEmail: 'opt-out@example.com',
              notifyEnabled: false,
            },
          ],
        ],
      ]),
    );

    await service.sendDeadlineDigests(now);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'staff@example.com',
        body: expect.stringContaining(
          '미제출자: 미제출학생, 미제출학생, 수신거부학생',
        ),
      }),
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'student@example.com',
        body: expect.stringContaining('2026. 08. 15. 09:00 (Asia/Seoul)'),
      }),
    );
    expect(send).not.toHaveBeenCalledWith(
      expect.objectContaining({ to: 'opt-out@example.com' }),
    );
  });

  it('발송이 실패하면 FAILED를 기록하고 다음 수신자로 계속한다', async () => {
    findUpcomingDeadlineMilestones.mockResolvedValue([milestone]);
    findStaffRecipients.mockResolvedValue([
      { id: 's1', notificationEmail: 'a@example.com' },
      { id: 's2', notificationEmail: 'b@example.com' },
    ]);
    send.mockRejectedValueOnce(new Error('smtp down'));

    await service.sendDeadlineDigests(now);

    expect(recordNotification).toHaveBeenCalledWith(
      's1',
      'FAILED',
      expect.objectContaining({ error: 'smtp down' }),
    );
    expect(recordNotification).toHaveBeenCalledWith(
      's2',
      'SENT',
      expect.any(Object),
    );
  });
});
