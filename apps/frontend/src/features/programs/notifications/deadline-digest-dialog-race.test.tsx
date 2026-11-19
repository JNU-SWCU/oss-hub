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
  studentPreviews: [],
  staffPreview: null,
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

describe('DeadlineDigestDialog request sequencing', () => {
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
    document.body.append(trigger);
  });

  afterEach(async () => {
    await mounted?.unmount();
    mounted = undefined;
    trigger.remove();
    vi.useRealTimers();
  });

  it('uses the latest same-turn draft and dispatches only one preview request', async () => {
    let resolvePreview: (value: typeof preview) => void = () => undefined;
    previewProgramDeadlineMock.mockReturnValueOnce(
      new Promise<typeof preview>((resolve) => {
        resolvePreview = resolve;
      }),
    );
    mounted = await renderWithQuery(
      <DeadlineDigestDialog
        programId="program-1"
        returnFocusRef={{ current: trigger }}
        onClose={() => undefined}
      />,
    );
    await act(async () => {});
    const field = document.body.querySelector<HTMLTextAreaElement>(
      '#deadline-studentGuidance',
    );
    if (field === null) throw new TypeError('Missing student guidance');
    const previewButton = button('미리보기');
    await act(async () => {
      setValue(field, '최신 학생 안내');
      previewButton.click();
      previewButton.click();
      previewButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(previewProgramDeadlineMock).toHaveBeenCalledExactlyOnceWith(
      'program-1',
      { studentGuidance: '최신 학생 안내', staffGuidance: '' },
    );
    expect(button('미리보는 중…').disabled).toBe(true);
    await act(async () => resolvePreview(preview));
    expect(button('보내기').disabled).toBe(false);
  });

  it.each(['before-latest-request', 'old-first', 'latest-first'])(
    'sends only current guidance when previews resolve %s',
    async (order) => {
      let resolveOld: (value: typeof preview) => void = () => undefined;
      let resolveLatest: (value: typeof preview) => void = () => undefined;
      previewProgramDeadlineMock
        .mockReturnValueOnce(
          new Promise<typeof preview>((resolve) => {
            resolveOld = resolve;
          }),
        )
        .mockReturnValueOnce(
          new Promise<typeof preview>((resolve) => {
            resolveLatest = resolve;
          }),
        );
      mounted = await renderWithQuery(
        <DeadlineDigestDialog
          programId="program-1"
          returnFocusRef={{ current: trigger }}
          onClose={() => undefined}
        />,
      );
      const field = document.body.querySelector<HTMLTextAreaElement>(
        '#deadline-studentGuidance',
      );
      if (field === null) throw new TypeError('Missing student guidance');
      await act(async () => {
        button('미리보기').click();
        setValue(field, 'current guidance');
      });
      if (order === 'before-latest-request')
        await act(async () => resolveOld(preview));
      await act(async () => button('미리보기').click());
      if (order === 'old-first') await act(async () => resolveOld(preview));
      const latest = { ...preview, previewVersion: 'b'.repeat(64) };
      await act(async () => resolveLatest(latest));
      if (order === 'latest-first') await act(async () => resolveOld(preview));
      await act(async () => button('보내기').click());
      expect(sendProgramDeadlineMock).toHaveBeenCalledExactlyOnceWith(
        'program-1',
        {
          previewedAt: latest.previewedAt,
          previewVersion: latest.previewVersion,
          studentGuidance: 'current guidance',
          staffGuidance: '',
        },
      );
    },
  );
});
