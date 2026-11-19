import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithQuery } from '../../../../test-support/render-with-query';

const previewProgramDeadlineMock = vi.hoisted(() => vi.fn());
const sendProgramDeadlineMock = vi.hoisted(() => vi.fn());

vi.mock('./program-deadline-api', () => ({
  previewProgramDeadline: previewProgramDeadlineMock,
  sendProgramDeadline: sendProgramDeadlineMock,
}));

import { DeadlineDigestDialog } from './deadline-digest-dialog';

const preview = {
  applicationCount: 3,
  milestoneCount: 2,
  recipientCount: 4,
  inactiveCount: 1,
  optedOutCount: 2,
  noEmailCount: 1,
  staffRecipientCount: 2,
  previewedAt: '2026-11-19T00:00:00.000Z',
  expiresAt: '2026-11-19T00:10:00.000Z',
  previewVersion: 'a'.repeat(64),
  studentPreviews: [
    {
      displayName: '학생 하나',
      subject: '학생 마감 알림',
      text: '학생 본문',
      html: '<p>학생 본문</p>',
    },
  ],
  staffPreview: {
    subject: '교직원 요약',
    text: '교직원 본문',
    html: '<p>교직원 본문</p>',
  },
};

function button(name: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (found === undefined) throw new TypeError(`Missing button: ${name}`);
  return found;
}

function setValue(field: HTMLTextAreaElement, value: string): void {
  Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value',
  )?.set?.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

async function flush(): Promise<void> {
  await act(async () => {});
}

describe('DeadlineDigestDialog', () => {
  let mounted: Awaited<ReturnType<typeof renderWithQuery>> | undefined;
  let trigger: HTMLButtonElement;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date('2026-11-19T00:00:00.000Z'));
    previewProgramDeadlineMock.mockReset().mockResolvedValue(preview);
    sendProgramDeadlineMock.mockReset().mockResolvedValue({
      ...preview,
      sentCount: 4,
      duplicateCount: 0,
      failedCount: 0,
    });
    trigger = document.createElement('button');
    trigger.textContent = '마감 알림 보내기';
    document.body.append(trigger);
  });

  afterEach(async () => {
    await mounted?.unmount();
    mounted = undefined;
    trigger.remove();
    vi.useRealTimers();
  });

  it('previews students and staff, sends the confirmed version, and includes both guidance fields', async () => {
    mounted = await renderWithQuery(
      <DeadlineDigestDialog
        programId="program-1"
        returnFocusRef={{ current: trigger }}
        onClose={() => undefined}
      />,
    );
    await flush();

    expect(previewProgramDeadlineMock).not.toHaveBeenCalled();
    const studentGuidance = document.body.querySelector<HTMLTextAreaElement>(
      '#deadline-studentGuidance',
    );
    const staffGuidance = document.body.querySelector<HTMLTextAreaElement>(
      '#deadline-staffGuidance',
    );
    if (studentGuidance === null || staffGuidance === null)
      throw new TypeError('Missing guidance fields');
    expect(document.activeElement).toBe(studentGuidance);

    await act(async () => {
      setValue(studentGuidance, '학생 추가 안내');
      setValue(staffGuidance, '교직원 추가 안내');
    });
    await act(async () => button('미리보기').click());
    await flush();

    expect(previewProgramDeadlineMock).toHaveBeenLastCalledWith('program-1', {
      studentGuidance: '학생 추가 안내',
      staffGuidance: '교직원 추가 안내',
    });
    expect(document.body.textContent).not.toContain(
      '학생 마감 알림과 교직원 요약을 함께 보냅니다.',
    );
    expect(document.body.textContent).toContain('학생 발송 가능');
    expect(document.body.textContent).toContain('교직원 요약 수신 2명');
    expect(document.body.textContent).toContain(
      '학생 4명 · 교직원 2명 · 발송 후 취소 불가',
    );
    expect(document.activeElement).toBe(button('수정'));
    const confirmation = document.body.querySelector<HTMLElement>(
      '[data-slot="dialog-shell-footer"] [role="status"]',
    );
    expect(confirmation?.textContent).toContain(
      '학생 4명 · 교직원 2명 · 발송 후 취소 불가',
    );
    expect(confirmation?.compareDocumentPosition(button('수정')) ?? 0).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(document.body.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();

    await act(async () => button('보내기').click());
    await flush();

    expect(sendProgramDeadlineMock).toHaveBeenCalledWith('program-1', {
      previewedAt: preview.previewedAt,
      previewVersion: preview.previewVersion,
      studentGuidance: '학생 추가 안내',
      staffGuidance: '교직원 추가 안내',
    });
    expect(sendProgramDeadlineMock).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain('학생 4명에게 보냈습니다.');
    expect(document.body.textContent).toContain('교직원 요약 수신 2명');
  });

  it('exposes keyboard-operable student and staff preview tabs', async () => {
    mounted = await renderWithQuery(
      <DeadlineDigestDialog
        programId="program-1"
        returnFocusRef={{ current: trigger }}
        onClose={() => undefined}
      />,
    );
    await flush();
    await act(async () => button('미리보기').click());
    await flush();

    const tabs = [
      ...document.body.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ];
    expect(tabs).toHaveLength(2);
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    expect(tabs[1]?.getAttribute('aria-selected')).toBe('false');

    await act(async () => {
      tabs[0]?.focus();
      tabs[0]?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      );
    });

    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[1]?.getAttribute('aria-selected')).toBe('true');
    expect(
      document.body.querySelector('iframe[title="교직원용 메일 본문"]'),
    ).not.toBeNull();
  });

  it('expires the preview after ten minutes and focuses the editable guidance', async () => {
    mounted = await renderWithQuery(
      <DeadlineDigestDialog
        programId="program-1"
        returnFocusRef={{ current: trigger }}
        onClose={() => undefined}
      />,
    );
    await flush();
    await act(async () => button('미리보기').click());
    await flush();

    await act(async () => {
      vi.advanceTimersByTime(10 * 60 * 1000);
    });

    expect(document.body.textContent).toContain(
      '미리보기가 만료되었습니다. 다시 미리보세요.',
    );
    expect(document.activeElement?.id).toBe('deadline-studentGuidance');
    expect(sendProgramDeadlineMock).not.toHaveBeenCalled();
  });
});
