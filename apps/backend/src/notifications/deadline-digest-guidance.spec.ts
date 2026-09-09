import {
  buildStudentDeadlineMail,
  buildStaffDeadlineMail,
} from './deadline-digest-mail.template';

const context = {
  now: new Date('2026-08-14T00:00:00Z'),
  frontendOrigin: new URL('https://oss.example'),
};
const milestone = {
  id: 'milestone-1',
  programId: 'program-1',
  programName: 'Synthetic programme',
  milestoneName: 'First plan',
  dueAt: new Date('2026-08-14T12:00:00Z'),
};

describe('per-send deadline guidance', () => {
  it('keeps student guidance literal in text and escapes HTML without changing protected facts', () => {
    // Given
    const guidance = '<img src=x onerror="alert(1)"> & first\nsecond';
    const input = {
      ...context,
      displayName: 'synthetic-student',
      milestones: [milestone] as const,
    };
    const original = buildStudentDeadlineMail(input);
    // When
    const mail = buildStudentDeadlineMail({ ...input, guidance });
    // Then
    expect(mail.text).toContain(guidance);
    expect(mail.html).toContain('&lt;img');
    expect(mail.html).not.toContain('<img');
    expect(mail.subject).toBe(original.subject);
    expect(mail.html.match(/href="[^"]+"/gu)).toEqual(
      original.html.match(/href="[^"]+"/gu),
    );
  });

  it('keeps staff guidance separate and does not persist it into the next build', () => {
    // Given
    const input = {
      ...context,
      milestones: [{ ...milestone, missingNicknames: ['synthetic-student'] }],
    };
    const guidance = 'staff-only & <literal>';
    // When
    const mail = buildStaffDeadlineMail({ ...input, guidance });
    // Then
    expect(mail.text).toContain(guidance);
    expect(mail.html).toContain('staff-only &amp; &lt;literal&gt;');
    expect(buildStaffDeadlineMail(input).text).not.toContain(guidance);
  });
});
