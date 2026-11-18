import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProgramDeadlineControl } from './program-deadline-control';

describe('ProgramDeadlineControl', () => {
  it('renders the off toggle and keeps mail available for an existing program', () => {
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
    expect(html).toContain('자동 알림을 사용하지 않습니다.');
    expect(html).toContain('메일 보내기');
    expect(html).not.toContain('/notifications');
  });

  it('renders the popup trigger instead of a notifications page link', () => {
    const html = renderToStaticMarkup(
      <ProgramDeadlineControl
        id="program-deadline-notification"
        enabled
        programId="program-1"
        onEnabledChange={() => undefined}
      />,
    );

    expect(html).toContain('메일 보내기');
    expect(html).toContain('lucide-mail');
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
  });
});
