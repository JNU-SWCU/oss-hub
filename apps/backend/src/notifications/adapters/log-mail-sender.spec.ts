import { LogMailSender } from './log-mail-sender';

describe('LogMailSender', () => {
  it('실제 발송 대신 resolve하고 예외를 던지지 않는다(dry-run)', async () => {
    const sender = new LogMailSender();
    await expect(
      sender.send({ to: 'staff@jnu.ac.kr', subject: '제목', body: '본문' }),
    ).resolves.toBeUndefined();
  });
});
