import {
  buildStudentDeadlineMail,
  escapeHtml,
  remainingHeadline,
} from './deadline-digest-mail.template';

describe('deadline-digest-mail.template', () => {
  const now = new Date('2026-08-07T06:00:00.000Z');

  it('remainingHeadline maps windows to DAKER-style titles', () => {
    expect(remainingHeadline(new Date('2026-08-07T06:30:00.000Z'), now)).toBe(
      '제출 마감 1시간 전 (긴급)',
    );
    expect(remainingHeadline(new Date('2026-08-07T08:00:00.000Z'), now)).toBe(
      '제출 마감 3시간 전',
    );
    expect(remainingHeadline(new Date('2026-08-08T05:00:00.000Z'), now)).toBe(
      '제출 마감 24시간 전',
    );
  });

  it('escapeHtml neutralizes markup in injected fields', () => {
    expect(escapeHtml(`<img src=x onerror=alert(1)>`)).toBe(
      '&lt;img src=x onerror=alert(1)&gt;',
    );
  });

  it('buildStudentDeadlineMail emits DAKER card with CTA', () => {
    const mail = buildStudentDeadlineMail({
      displayName: 'alice',
      milestone: {
        id: 'm1',
        programId: 'p1',
        programName: 'Test Program <x>',
        milestoneName: 'Proposal',
        dueAt: new Date('2026-08-07T07:00:00.000Z'),
      },
      now,
      frontendOrigin: 'https://oss.example/',
    });

    expect(mail.subject).toContain('제출 마감 1시간 전 (긴급)');
    expect(mail.html).toContain('안녕하세요, alice님!');
    expect(mail.html).toContain('Test Program &lt;x&gt;');
    expect(mail.html).toContain(
      'https://oss.example/programs/p1/submissions?milestoneId=m1',
    );
    expect(mail.html).toContain('제출하러 가기');
    expect(mail.text).toContain('alice');
  });
});
