import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithQuery } from '../../../../test-support/render-with-query';

const getProgramMailRecipientsMock = vi.hoisted(() => vi.fn());
const previewProgramMailMock = vi.hoisted(() => vi.fn());
const sendProgramMailMock = vi.hoisted(() => vi.fn());
const getMailJob = vi.hoisted(() => vi.fn());
const getMailJobs = vi.hoisted(() => vi.fn());

vi.mock('./program-mail-api', () => ({
  getProgramMailRecipients: getProgramMailRecipientsMock,
  previewProgramMail: previewProgramMailMock,
  sendProgramMail: sendProgramMailMock,
  getMailJob,
  getMailJobs,
}));

import { ProgramMailDialog } from './program-mail-dialog';

const recipients = {
  programId: 'program-1',
  programName: '합성 프로그램',
  recipientLimit: 200,
  teams: [
    {
      id: 'team-1',
      name: '프론트 1팀',
      status: 'APPROVED' as const,
      deadlineEligible: true,
      applicants: [
        {
          id: 'student-1',
          displayName: '학생 하나',
          nickname: 'student-1',
          mailAvailable: true,
        },
      ],
    },
  ],
};

const preview = {
  subject: '프로그램 안내',
  body: '안내 본문',
  applicantIds: ['student-1'],
  programName: '합성 프로그램',
  senderName: '합성 교직원',
  recipientNames: ['학생 하나'],
  recipientCount: 1,
  renderedSubject: '[oss-hub] 프로그램 안내',
  footer: '이 메일은 oss-hub에서 발송했습니다.',
  previewedAt: '2026-11-18T00:00:00.000Z',
  expiresAt: '2026-11-18T00:10:00.000Z',
  previewVersion: 'a'.repeat(64),
};

function queryButton(name: string) {
  return [...document.body.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === name,
  );
}

function receiptCounts() {
  return Object.fromEntries(
    [...document.querySelectorAll<HTMLDataElement>('data[data-outcome]')].map(
      (item) => [item.dataset.outcome ?? '', Number(item.value)] as const,
    ),
  );
}

function button(name: string): HTMLButtonElement {
  const found = queryButton(name);
  if (found === undefined) throw new TypeError(`Missing button: ${name}`);
  return found;
}

async function flush(): Promise<void> {
  await act(async () => {});
}

function setFieldValue(
  field: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('ProgramMailDialog', () => {
  let mounted: Awaited<ReturnType<typeof renderWithQuery>> | undefined;
  let trigger: HTMLButtonElement | undefined;

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        'Date',
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
      ],
    });
    vi.setSystemTime(new Date(preview.previewedAt));
    getMailJob.mockReset();
    getMailJobs.mockReset();
    getProgramMailRecipientsMock.mockReset().mockResolvedValue(recipients);
    previewProgramMailMock.mockReset().mockResolvedValue(preview);
    sendProgramMailMock.mockReset().mockResolvedValue({
      status: 'COMPLETED',
      sentCount: 1,
      duplicateCount: 0,
      failedCount: 0,
      unknownCount: 2,
      previewVersion: preview.previewVersion,
    });
  });

  afterEach(async () => {
    await mounted?.unmount();
    mounted = undefined;
    trigger?.remove();
    trigger = undefined;
    vi.useRealTimers();
  });

  async function openPreview() {
    trigger = document.createElement('button');
    document.body.append(trigger);
    mounted = await renderWithQuery(
      <ProgramMailDialog
        programId="program-1"
        open
        returnFocusRef={{ current: trigger }}
        onClose={() => undefined}
      />,
    );
    await flush();

    expect(button('미리보기').disabled).toBe(true);
    await act(async () =>
      button('24시간 이내 필수 서류 미제출자 선택').click(),
    );
    const subject = document.body.querySelector<HTMLInputElement>(
      '#program-mail-subject',
    );
    const body =
      document.body.querySelector<HTMLTextAreaElement>('#program-mail-body');
    if (subject === null || body === null) {
      throw new TypeError('Missing mail fields');
    }
    await act(async () => {
      setFieldValue(subject, preview.subject);
      setFieldValue(body, preview.body);
    });
    await act(async () => button('미리보기').click());
    await flush();
  }

  it('sends from the preview step without opening a second confirmation dialog', async () => {
    await openPreview();
    const send = button('보내기');
    expect(send.disabled).toBe(false);
    const warningId = send.getAttribute('aria-describedby');
    expect(document.getElementById(warningId ?? '')).not.toBeNull();
    expect(previewProgramMailMock).toHaveBeenCalledWith('program-1', {
      subject: preview.subject,
      body: preview.body,
      applicantIds: ['student-1'],
    });
    expect(document.querySelector('#program-mail-subject')).toBeNull();
    expect(document.body.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).toBe(button('수정'));

    await act(async () => button('보내기').click());
    await flush();

    expect(sendProgramMailMock).toHaveBeenCalledWith('program-1', preview);
    expect(sendProgramMailMock).toHaveBeenCalledTimes(1);
    expect(receiptCounts()).toEqual({
      sentCount: 1,
      failedCount: 0,
      unknownCount: 2,
      duplicateCount: 0,
    });
    expect(button('닫기').disabled).toBe(false);
    expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it.each(['timer', 'click-before-timer'])(
    'requires a fresh preview at the server expiry (%s)',
    async (delivery) => {
      const expiresAt = '2026-11-18T00:00:07.000Z';
      previewProgramMailMock.mockResolvedValueOnce({ ...preview, expiresAt });
      await openPreview();
      await act(async () => vi.advanceTimersByTime(6999));
      const send = button('보내기');
      expect(send.disabled).toBe(false);
      if (delivery === 'timer') {
        await act(async () => vi.advanceTimersByTime(1));
      } else {
        vi.setSystemTime(new Date(expiresAt));
        await act(async () => send.click());
      }
      expect(queryButton('보내기')).toBeUndefined();
      expect(document.body.querySelector('[role="alert"]')).not.toBeNull();
      expect(sendProgramMailMock).not.toHaveBeenCalled();

      const fresh = { ...preview, previewVersion: 'b'.repeat(64) };
      previewProgramMailMock.mockResolvedValueOnce(fresh);
      await act(async () => button('미리보기').click());
      await act(async () => button('보내기').click());
      expect(sendProgramMailMock).toHaveBeenCalledExactlyOnceWith(
        'program-1',
        fresh,
      );
    },
  );

  it('follows the accepted ID, stops at terminal, and reopens it from server history without another POST', async () => {
    const receipt = { jobId: 'opaque-1', acceptedAt: preview.previewedAt };
    const completed = {
      ...receipt,
      status: 'COMPLETED',
      sentCount: 3,
      failedCount: 1,
      duplicateCount: 0,
      unknownCount: 2,
      finishedAt: preview.previewedAt,
    };
    sendProgramMailMock.mockResolvedValueOnce({
      ...receipt,
      status: 'IN_PROGRESS',
    });
    getMailJob
      .mockResolvedValueOnce({ ...receipt, status: 'IN_PROGRESS' })
      .mockResolvedValue(completed);
    getMailJobs.mockResolvedValue({ items: [receipt] });
    await openPreview();
    await act(async () => button('보내기').click());
    expect(getMailJob).toHaveBeenCalledExactlyOnceWith(
      'program-1',
      receipt.jobId,
      expect.any(AbortSignal),
    );
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    const counts = {
      sentCount: 3,
      failedCount: 1,
      unknownCount: 2,
      duplicateCount: 0,
    };
    expect(receiptCounts()).toEqual(counts);
    await act(async () => vi.advanceTimersByTimeAsync(20000));
    expect(getMailJob).toHaveBeenCalledTimes(2);
    await mounted?.unmount();
    mounted = await renderWithQuery(
      <ProgramMailDialog
        programId="program-1"
        open
        returnFocusRef={{ current: null }}
        onClose={() => undefined}
      />,
    );
    await act(async () => button('발송 기록').click());
    const entry = document.querySelector<HTMLButtonElement>(
      `button[value="${receipt.jobId}"]`,
    );
    expect(entry).not.toBeNull();
    await act(async () => entry?.click());
    expect(getMailJob).toHaveBeenCalledTimes(3);
    expect(receiptCounts()).toEqual(counts);
    expect(sendProgramMailMock).toHaveBeenCalledTimes(1);
  });
});
