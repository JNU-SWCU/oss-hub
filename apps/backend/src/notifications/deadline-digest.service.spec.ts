import { DeadlineDigestService } from './deadline-digest.service';
import type { DeadlineDigestRepositoryPort } from './deadline-digest.repository';
import type { MailSender } from './mail-sender.port';

describe('DeadlineDigestService', () => {
  const findUpcomingDeadlineMilestones = jest.fn();
  const findStaffRecipients = jest.fn();
  const recordNotification = jest.fn();
  const send = jest.fn();
  const repository = {
    findUpcomingDeadlineMilestones,
    findStaffRecipients,
    recordNotification,
  } as unknown as DeadlineDigestRepositoryPort;
  const mailSender: MailSender = { send };
  const service = new DeadlineDigestService(repository, mailSender);

  const milestone = {
    programName: '전국 디지털 경진대회',
    milestoneName: '최종 제출',
    dueAt: new Date('2026-08-15T00:00:00.000Z'),
  };
  const now = new Date('2026-08-14T00:00:00.000Z');

  beforeEach(() => {
    findUpcomingDeadlineMilestones.mockReset();
    findStaffRecipients.mockReset();
    recordNotification.mockReset().mockResolvedValue(undefined);
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
