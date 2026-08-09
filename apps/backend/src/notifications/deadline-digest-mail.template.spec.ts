import {
  buildStaffDeadlineMail,
  buildStudentDeadlineMail,
  parseFrontendOrigin,
} from './deadline-digest-mail.template';

describe('deadline-digest-mail.template', () => {
  const now = new Date('2026-08-14T00:00:00.000Z');
  const dueAt = new Date('2026-08-14T12:00:00.000Z');

  it('학생 메일의 text와 HTML에 프로그램, 마일스톤, KST 마감, CTA를 담는다', () => {
    const mail = buildStudentDeadlineMail({
      displayName: 'student',
      milestones: [
        {
          id: 'milestone-1',
          programId: 'program-1',
          programName: '합성 프로그램',
          milestoneName: '최종 제출',
          dueAt,
        },
      ],
      now,
      frontendOrigin: parseFrontendOrigin('https://oss.example/'),
    });

    for (const content of [mail.text, mail.html]) {
      expect(content).toContain('합성 프로그램');
      expect(content).toContain('최종 제출');
      expect(content).toContain('2026. 08. 14. 21:00');
      expect(content).toContain(
        'https://oss.example/programs/program-1/submissions?milestoneId=milestone-1',
      );
    }
    expect(mail.text).toContain('Asia/Seoul');
    expect(mail.html).toContain('제출하러 가기');
  });

  it('교직원 메일의 text와 HTML에 비활성 표시와 대시보드 CTA를 담는다', () => {
    const mail = buildStaffDeadlineMail({
      milestones: [
        {
          id: 'milestone-1',
          programId: 'program-1',
          programName: '합성 프로그램',
          milestoneName: '최종 제출',
          dueAt,
          missingNicknames: ['active-student', 'inactive-student (비활성)'],
        },
      ],
      now,
      frontendOrigin: parseFrontendOrigin('https://oss.example'),
    });

    for (const content of [mail.text, mail.html]) {
      expect(content).toContain('합성 프로그램');
      expect(content).toContain('최종 제출');
      expect(content).toContain('inactive-student (비활성)');
      expect(content).toContain('https://oss.example/staff/dashboard');
    }
  });

  it('신뢰하지 않는 필드를 HTML로 해석하지 않는다', () => {
    const injection = `<img src=x onerror="alert('x')">`;
    const mail = buildStudentDeadlineMail({
      displayName: injection,
      milestones: [
        {
          id: 'milestone-1',
          programId: 'program-1',
          programName: injection,
          milestoneName: injection,
          dueAt,
        },
      ],
      now,
      frontendOrigin: parseFrontendOrigin('https://oss.example'),
    });

    expect(mail.html).not.toContain(injection);
    expect(mail.html).not.toContain('<img');
    expect(mail.html).toContain('&lt;img');
  });

  it.each([
    '',
    '   ',
    'not-a-url',
    'javascript:alert(1)',
    'https://oss.example/path',
    'https://user:secret@oss.example',
    'https://oss.example?next=other',
    'https://oss.example#fragment',
  ])('잘못된 FRONTEND_URL %p를 거부한다', (value) => {
    expect(() => parseFrontendOrigin(value)).toThrow(
      'FRONTEND_URL must be an HTTP(S) origin.',
    );
  });
});
