import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProgramDeadlineControl } from './program-deadline-control';

const notificationsHref = '/programs/program-1/notifications';

describe('ProgramDeadlineControl', () => {
  it('renders the off toggle with the off-state text and no preview or send action', () => {
    const html = renderToStaticMarkup(
      <ProgramDeadlineControl
        id="authoring-deadline-notification"
        enabled={false}
        onEnabledChange={() => undefined}
      />,
    );

    expect(html).toContain('id="authoring-deadline-notification"');
    expect(html).toContain('제출 마감 알림');
    expect(html).toContain('24시간');
    expect(html).toContain('자동 알림을 사용하지 않습니다.');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('<textarea');
    expect(html).not.toContain('알림 페이지에서 보내기');
  });

  it('links to the notifications page once the enabled value is persisted', () => {
    const html = renderToStaticMarkup(
      <ProgramDeadlineControl
        id="program-deadline-notification"
        enabled
        persistedEnabled
        notificationsHref={notificationsHref}
        onEnabledChange={() => undefined}
      />,
    );

    expect(html).toContain(`href="${notificationsHref}"`);
    expect(html).toContain('알림 페이지에서 보내기');
    expect(html).not.toContain('저장하면 알림 페이지에서 발송할 수 있습니다.');
    expect(html).not.toContain('자동 알림을 사용하지 않습니다.');
  });

  it('asks to save first when enabled but not yet persisted', () => {
    const html = renderToStaticMarkup(
      <ProgramDeadlineControl
        id="program-deadline-notification"
        enabled
        persistedEnabled={false}
        notificationsHref={notificationsHref}
        onEnabledChange={() => undefined}
      />,
    );

    expect(html).toContain('저장하면 알림 페이지에서 발송할 수 있습니다.');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('알림 페이지에서 보내기');
  });

  it('keeps the creation toggle free of the notifications link and save hint', () => {
    const html = renderToStaticMarkup(
      <ProgramDeadlineControl
        id="authoring-deadline-notification"
        enabled
        onEnabledChange={() => undefined}
      />,
    );

    expect(html).toContain('제출 마감 알림');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('알림 페이지에서 보내기');
    expect(html).not.toContain('저장하면 알림 페이지에서 발송할 수 있습니다.');
  });
});
