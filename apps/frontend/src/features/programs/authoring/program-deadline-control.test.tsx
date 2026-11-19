import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProgramDeadlineControl } from './program-deadline-control';

describe('ProgramDeadlineControl', () => {
  it('keeps regular mail available and replaces the deadline action with one settings line when off', () => {
    const html = renderToStaticMarkup(
      <ProgramDeadlineControl
        id="authoring-deadline-notification"
        enabled={false}
        programId="program-1"
        onEnabledChange={() => undefined}
      />,
    );

    expect(html).toContain('id="authoring-deadline-notification"');
    expect(html).toContain('제출 마감 알림');
    expect(html).toContain('24시간');
    expect(html).toContain('제출 마감 알림을 켜야 합니다.');
    expect(html).toContain('메일 보내기');
    expect(html).not.toContain('마감 알림 보내기');
    expect(html).not.toContain('/notifications');
  });

  it('renders separate regular-mail and deadline-digest popup triggers', () => {
    const html = renderToStaticMarkup(
      <ProgramDeadlineControl
        id="program-deadline-notification"
        enabled
        programId="program-1"
        onEnabledChange={() => undefined}
      />,
    );

    expect(html).toContain('메일 보내기');
    expect(html).toContain('마감 알림 보내기');
    expect(html).toContain('lucide-mail');
    expect(html).toContain('lucide-bell-ring');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('/notifications');
  });

  it('keeps the creation toggle free of the mail action', () => {
    const html = renderToStaticMarkup(
      <ProgramDeadlineControl
        id="authoring-deadline-notification"
        enabled
        onEnabledChange={() => undefined}
      />,
    );

    expect(html).toContain('제출 마감 알림');
    expect(html).not.toContain('메일 보내기');
    expect(html).not.toContain('마감 알림 보내기');
  });
});
