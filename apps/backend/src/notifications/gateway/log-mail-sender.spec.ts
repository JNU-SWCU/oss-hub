import { Logger } from '@nestjs/common';
import { LogMailSender } from './log-mail-sender';

describe('LogMailSender', () => {
  it('실제 발송 대신 resolve하고 예외를 던지지 않는다(dry-run)', async () => {
    const sender = new LogMailSender();
    await expect(
      sender.send({
        to: 'staff@example.com',
        subject: '제목',
        body: '본문',
        html: '<p>본문</p>',
      }),
    ).resolves.toBeUndefined();
  });

  it('동적 제목과 제어 문자를 로그에 남기지 않는다', async () => {
    const logged: unknown[] = [];
    const logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation((message: unknown) => {
        logged.push(message);
      });
    const sender = new LogMailSender();
    const injectedTitle = '민감 프로그램\nFORGED_EVENT\u0000토큰형제목';

    await sender.send({
      to: 'synthetic-recipient@example.test',
      subject: injectedTitle,
      body: '본문',
      html: '<p>본문</p>',
    });

    expect(logged).toEqual([
      '[dry-run] deadline digest prepared bodyChars=2 htmlChars=9',
    ]);
    expect(JSON.stringify(logged)).not.toContain(injectedTitle);
    expect(JSON.stringify(logged)).not.toContain('FORGED_EVENT');
    logSpy.mockRestore();
  });
});
