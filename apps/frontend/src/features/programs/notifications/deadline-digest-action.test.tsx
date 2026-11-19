import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithQuery } from '../../../../test-support/render-with-query';

const getEditableProgramMock = vi.hoisted(() => vi.fn());
const previewProgramDeadlineMock = vi.hoisted(() => vi.fn());

vi.mock('../authoring/api', () => ({
  getEditableProgram: getEditableProgramMock,
}));
vi.mock('./program-deadline-api', () => ({
  previewProgramDeadline: previewProgramDeadlineMock,
  sendProgramDeadline: vi.fn(),
}));

import { DeadlineDigestAction } from './deadline-digest-action';

const preview = {
  applicationCount: 1,
  milestoneCount: 1,
  recipientCount: 1,
  inactiveCount: 0,
  optedOutCount: 0,
  noEmailCount: 0,
  staffRecipientCount: 1,
  previewedAt: '2026-11-19T00:00:00.000Z',
  expiresAt: '2026-11-19T00:10:00.000Z',
  previewVersion: 'a'.repeat(64),
  studentPreviews: [
    {
      displayName: '학생 하나',
      subject: '학생 알림',
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

async function flush(): Promise<void> {
  await act(async () => {});
}

describe('DeadlineDigestAction', () => {
  let mounted: Awaited<ReturnType<typeof renderWithQuery>> | undefined;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-19T00:00:00.000Z'));
    getEditableProgramMock.mockReset();
    previewProgramDeadlineMock.mockReset().mockResolvedValue(preview);
  });

  afterEach(async () => {
    await mounted?.unmount();
    mounted = undefined;
    vi.useRealTimers();
  });

  it('shows one settings line instead of the send control when deadline notifications are off', async () => {
    mounted = await renderWithQuery(
      <DeadlineDigestAction programId="program-1" enabled={false} />,
    );

    expect(document.body.textContent).toContain(
      '제출 마감 알림을 켜야 합니다.',
    );
    expect(document.body.querySelector('button')).toBeNull();
    expect(getEditableProgramMock).not.toHaveBeenCalled();
  });

  it('loads the overview setting and replaces the action when deadline notifications are off', async () => {
    getEditableProgramMock.mockResolvedValue({ notifyOnDeadline: false });
    mounted = await renderWithQuery(
      <DeadlineDigestAction programId="program-1" />,
    );
    await flush();

    expect(getEditableProgramMock).toHaveBeenCalledWith('program-1');
    expect(document.body.textContent).toContain(
      '제출 마감 알림을 켜야 합니다.',
    );
    expect(document.body.querySelector('button')).toBeNull();
  });

  it('opens one accessible dialog and returns focus to its trigger on Escape', async () => {
    mounted = await renderWithQuery(
      <DeadlineDigestAction programId="program-1" enabled />,
    );
    const trigger = document.body.querySelector<HTMLButtonElement>('button');
    if (trigger === null) throw new TypeError('Missing deadline action');

    await act(async () => trigger.click());
    await flush();

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.getAttribute('aria-labelledby')).toBeTruthy();
    expect(document.body.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.activeElement?.id).toBe('deadline-studentGuidance');

    await act(async () => {
      dialog?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    await flush();

    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
