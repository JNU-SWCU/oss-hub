import { ProgramMailTemplateService } from './program-mail-template.service';

it('escapes every HTML interpolation without changing transport text or line breaks', () => {
  const chars = `<>&"'`;
  const escaped = '&lt;&gt;&amp;&quot;&#39;';
  const input = {
    subject: 'subject-' + chars,
    displayName: 'recipient-' + chars,
    programName: 'program-' + chars,
    senderName: 'sender-' + chars,
    body: 'body-' + chars + '\nsecond line',
  };
  const mail = new ProgramMailTemplateService().build(input);
  expect(mail.subject).toBe('[oss-hub] ' + input.subject);
  expect(mail.html).toContain(
    '<title>[oss-hub] subject-' + escaped + '</title>',
  );
  for (const [prefix, value] of Object.entries(input)) {
    expect(mail.html).not.toContain(value);
    expect(mail.html).toContain(value.replace(chars, escaped));
    expect(mail.text).toContain(prefix === 'subject' ? input.body : value);
  }
  expect(mail.html).toContain('white-space:pre-wrap;');
  const footer = '이 메일은 oss-hub에서 발송했습니다.';
  expect(mail.text.endsWith('\n--\n' + footer)).toBe(true);
  expect(mail.html).toContain(footer + '</p>');
});
