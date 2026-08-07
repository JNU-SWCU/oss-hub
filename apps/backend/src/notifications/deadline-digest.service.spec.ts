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
  const service = new DeadlineDigestService(repository, mailSender, {
    FRONTEND_URL: 'https://oss.example',
  });

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

  it('마감 임박 마일스톤이 있으면 각 교직원 수신자에게 HTML 포함 발송하고 SENT를 기록한다', async () => {
    findUpcomingDeadlineMilestones.mockResolvedValue([milestone]);
    findStaffRecipients.mockResolvedValue([
      { id: 's1', notificationEmail: 'a@example.com' },
      { id: 's2', notificationEmail: 'b@example.com' },
    ]);

    await service.sendDeadlineDigests(now);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'a@example.com',
        html: expect.stringContaining('마감 정보'),
        body: expect.stringContaining('미제출자'),
      }),
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

  it('미제출 동의 학생에게 DAKER HTML 리마인더를 한 번만 발송한다', async () => {
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

    const messageTo = (address: string) =>
      send.mock.calls
        .map(([message]) => message)
        .find((message) => message.to === address);

    const staffMail = messageTo('staff@example.com');
    expect(staffMail?.body).toContain(
      '미제출자: 미제출학생, 미제출학생, 수신거부학생',
    );
    expect(staffMail?.html).toContain('미제출학생');

    const studentMail = messageTo('student@example.com');
    expect(studentMail?.html).toContain('제출하러 가기');
    expect(studentMail?.html).toContain(
      'https://oss.example/programs/p1/submissions?milestoneId=m1',
    );
    expect(studentMail?.html).toContain('안녕하세요, 미제출학생님!');
    expect(studentMail?.body).toContain('미제출학생');
    expect(studentMail?.subject).toContain('최종 제출');
    expect(messageTo('opt-out@example.com')).toBeUndefined();
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
