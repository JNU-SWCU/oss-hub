import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithQuery } from '../../../../test-support/render-with-query';
import { ApiError } from '@/lib/api-client';

const previewProgramDeadlineMock = vi.hoisted(() => vi.fn());
const sendProgramDeadlineMock = vi.hoisted(() => vi.fn());

vi.mock('./program-deadline-api', () => ({
  previewProgramDeadline: previewProgramDeadlineMock,
  sendProgramDeadline: sendProgramDeadlineMock,
}));

import { DeadlineDigestDialog } from './deadline-digest-dialog';

const studentMail = {
  displayName: '학생 하나',
  subject: '학생 마감 알림',
  text: '학생 본문',
  html: '<p>학생 본문</p>',
};

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
  studentPreviews: [studentMail],
  staffPreview: {
    subject: '교직원 요약',
    text: '교직원 본문',
    html: '<p>교직원 본문</p>',
  },
};

const personalizedPreview = {
  ...preview,
  studentPreviews: [
    studentMail,
    {
      displayName: '학생 둘',
      subject: '두 번째 학생 마감 알림',
      text: '두 번째 학생 본문',
      html: '<a href="https://example.test/programs/program-1/submissions">제출하러 가기</a>',
    },
  ],
};

const emptyPreview = {
  ...preview,
  recipientCount: 0,
  staffRecipientCount: 0,
  studentPreviews: [],
  staffPreview: null,
};

const staffOnlyPreview = {
  ...emptyPreview,
  staffRecipientCount: 2,
  staffPreview: preview.staffPreview,
};

const staleProblem = {
  type: 'https://oss-hub.dev/problems/deadline-preview-stale',
  title: 'Deadline preview stale',
  status: 409,
  detail: 'Preview expired or eligibility changed.',
  instance: '/programs/program-1/deadline-digest/send',
  code: 'NOT_005',
};

const invalidGuidanceProblem = {
  type: 'https://oss-hub.dev/problems/validation',
  title: 'Invalid guidance',
  status: 400,
  detail: 'Guidance is invalid.',
  instance: '/programs/program-1/deadline-digest/preview',
  code: 'VAL_001',
};

const serverProblem = {
  type: 'about:blank',
  title: 'Internal error',
  status: 500,
  detail: '미리보기를 만드는 중 오류가 발생했습니다.',
  instance: '/programs/program-1/deadline-digest/preview',
  code: 'SRV_001',
};

function queryButton(name: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === name,
  );
}

function button(name: string): HTMLButtonElement {
  const found = queryButton(name);
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

function counts(node: Element | null): number[] {
  return (node?.textContent?.match(/\d+/g) ?? []).map(Number);
}

function confirmationCounts(): number[] {
  return counts(
    document.querySelector('[data-slot="dialog-shell-footer"] [role="status"]'),
  );
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
    expect(document.querySelector('#deadline-studentGuidance')).toBeNull();
    expect(document.querySelector('[role="tabpanel"] iframe')).not.toBeNull();
    expect(
      document.querySelector('[role="tab"][aria-selected="false"]'),
    ).not.toBeNull();
    expect(confirmationCounts()).toEqual([4, 2]);
    expect(document.activeElement).toBe(button('수정'));
    const confirmation = document.body.querySelector<HTMLElement>(
      '[data-slot="dialog-shell-footer"] [role="status"]',
    );
    expect(confirmation).not.toBeNull();
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
    expect(
      counts(
        document.querySelector('[role="alert"] [data-slot="alert-title"]'),
      ),
    ).toEqual([4]);
    expect(
      counts(
        document.querySelector(
          '[role="alert"] [data-slot="alert-description"]',
        ),
      ),
    ).toEqual([0, 0, 2]);
  });

  it('ignores repeated send clicks in the same turn and while the request is in flight', async () => {
    let resolveSend: (value: unknown) => void = () => undefined;
    sendProgramDeadlineMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSend = resolve;
      }),
    );
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

    const sendButton = button('보내기');
    await act(async () => {
      sendButton.click();
      sendButton.click();
      sendButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(sendProgramDeadlineMock).toHaveBeenCalledTimes(1);
    expect(button('보내는 중…').disabled).toBe(true);
    await act(async () => {
      button('보내는 중…').dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    expect(sendProgramDeadlineMock).toHaveBeenCalledTimes(1);

    await act(async () =>
      resolveSend({
        ...preview,
        sentCount: 4,
        duplicateCount: 0,
        failedCount: 0,
      }),
    );
    expect(sendProgramDeadlineMock).toHaveBeenCalledTimes(1);
    expect(
      counts(
        document.querySelector('[role="alert"] [data-slot="alert-title"]'),
      ),
    ).toEqual([4]);
  });

  it('preserves guidance after a stale send response and requires a new preview before retry', async () => {
    sendProgramDeadlineMock.mockRejectedValueOnce(new ApiError(staleProblem));
    mounted = await renderWithQuery(
      <DeadlineDigestDialog
        programId="program-1"
        returnFocusRef={{ current: trigger }}
        onClose={() => undefined}
      />,
    );
    await flush();

    const studentGuidance = document.body.querySelector<HTMLTextAreaElement>(
      '#deadline-studentGuidance',
    );
    const staffGuidance = document.body.querySelector<HTMLTextAreaElement>(
      '#deadline-staffGuidance',
    );
    if (studentGuidance === null || staffGuidance === null)
      throw new TypeError('Missing guidance fields');
    await act(async () => {
      setValue(studentGuidance, '학생 초안');
      setValue(staffGuidance, '교직원 초안');
    });
    await act(async () => button('미리보기').click());
    await flush();
    await act(async () => button('보내기').click());
    await flush();

    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    expect(
      document.body.querySelector<HTMLTextAreaElement>(
        '#deadline-studentGuidance',
      )?.value,
    ).toBe('학생 초안');
    expect(
      document.body.querySelector<HTMLTextAreaElement>(
        '#deadline-staffGuidance',
      )?.value,
    ).toBe('교직원 초안');
    expect(sendProgramDeadlineMock).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('[role="status"]')).toBeNull();

    previewProgramDeadlineMock.mockResolvedValueOnce({
      ...preview,
      previewVersion: 'b'.repeat(64),
    });
    await act(async () => button('미리보기').click());
    await flush();

    expect(previewProgramDeadlineMock).toHaveBeenCalledTimes(2);
    expect(sendProgramDeadlineMock).toHaveBeenCalledTimes(1);
    expect(button('보내기').disabled).toBe(false);
    expect(confirmationCounts()).toEqual([4, 2]);
  });

  it('allows a staff-only digest when there are no student recipients', async () => {
    previewProgramDeadlineMock.mockResolvedValueOnce(staffOnlyPreview);
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

    expect(confirmationCounts()).toEqual([0, 2]);
    expect(button('보내기').disabled).toBe(false);
    await act(async () => button('보내기').click());
    await flush();

    expect(sendProgramDeadlineMock).toHaveBeenCalledTimes(1);
    expect(sendProgramDeadlineMock).toHaveBeenCalledWith(
      'program-1',
      expect.objectContaining({ previewVersion: preview.previewVersion }),
    );
  });

  it('disables sending when both student and staff recipient counts are zero', async () => {
    previewProgramDeadlineMock.mockResolvedValueOnce(emptyPreview);
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

    expect(confirmationCounts()).toEqual([0, 0]);
    expect(document.querySelector('[role="tabpanel"] iframe')).toBeNull();
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>('[role="tab"][aria-selected="false"]')
        ?.click(),
    );
    expect(document.querySelector('[role="tabpanel"] iframe')).toBeNull();
    expect(button('보내기').disabled).toBe(true);
    await act(async () => {
      button('보내기').dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    expect(sendProgramDeadlineMock).not.toHaveBeenCalled();
  });

  it('edits both drafts after preview, re-previews, and sends only the new version', async () => {
    mounted = await renderWithQuery(
      <DeadlineDigestDialog
        programId="program-1"
        returnFocusRef={{ current: trigger }}
        onClose={() => undefined}
      />,
    );
    await flush();

    const firstStudentGuidance =
      document.body.querySelector<HTMLTextAreaElement>(
        '#deadline-studentGuidance',
      );
    const firstStaffGuidance = document.body.querySelector<HTMLTextAreaElement>(
      '#deadline-staffGuidance',
    );
    if (firstStudentGuidance === null || firstStaffGuidance === null)
      throw new TypeError('Missing guidance fields');
    await act(async () => {
      setValue(firstStudentGuidance, '학생 초안');
      setValue(firstStaffGuidance, '교직원 초안');
    });
    await act(async () => button('미리보기').click());
    await flush();
    await act(async () => button('수정').click());

    const editedStudentGuidance =
      document.body.querySelector<HTMLTextAreaElement>(
        '#deadline-studentGuidance',
      );
    const editedStaffGuidance =
      document.body.querySelector<HTMLTextAreaElement>(
        '#deadline-staffGuidance',
      );
    if (editedStudentGuidance === null || editedStaffGuidance === null)
      throw new TypeError('Missing edited guidance fields');
    expect(editedStudentGuidance.value).toBe('학생 초안');
    expect(editedStaffGuidance.value).toBe('교직원 초안');
    expect(queryButton('보내기')).toBeUndefined();
    expect(sendProgramDeadlineMock).not.toHaveBeenCalled();

    await act(async () => {
      setValue(editedStudentGuidance, '고친 학생 안내');
      setValue(editedStaffGuidance, '고친 교직원 안내');
    });
    const newPreview = { ...preview, previewVersion: 'b'.repeat(64) };
    previewProgramDeadlineMock.mockResolvedValueOnce(newPreview);
    await act(async () => button('미리보기').click());
    await flush();
    await act(async () => button('보내기').click());
    await flush();

    expect(previewProgramDeadlineMock.mock.calls).toEqual([
      [
        'program-1',
        { studentGuidance: '학생 초안', staffGuidance: '교직원 초안' },
      ],
      [
        'program-1',
        {
          studentGuidance: '고친 학생 안내',
          staffGuidance: '고친 교직원 안내',
        },
      ],
    ]);
    expect(sendProgramDeadlineMock).toHaveBeenCalledTimes(1);
    expect(sendProgramDeadlineMock).toHaveBeenCalledWith('program-1', {
      previewedAt: newPreview.previewedAt,
      previewVersion: newPreview.previewVersion,
      studentGuidance: '고친 학생 안내',
      staffGuidance: '고친 교직원 안내',
    });
  });

  it('blocks preview beyond the guidance limit and preserves the invalid value', async () => {
    mounted = await renderWithQuery(
      <DeadlineDigestDialog
        programId="program-1"
        returnFocusRef={{ current: trigger }}
        onClose={() => undefined}
      />,
    );
    await flush();

    const studentGuidance = document.body.querySelector<HTMLTextAreaElement>(
      '#deadline-studentGuidance',
    );
    if (studentGuidance === null)
      throw new TypeError('Missing student guidance');
    await act(async () => setValue(studentGuidance, 'x'.repeat(4001)));

    expect(studentGuidance.maxLength).toBe(4000);
    expect(studentGuidance.value).toHaveLength(4001);
    expect(studentGuidance.getAttribute('aria-invalid')).toBe('true');
    expect(button('미리보기').disabled).toBe(true);
    expect(queryButton('보내기')).toBeUndefined();

    await act(async () => {
      button('미리보기').dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });

    expect(previewProgramDeadlineMock).not.toHaveBeenCalled();
    expect(sendProgramDeadlineMock).not.toHaveBeenCalled();
  });

  it('shows a guidance API error, preserves both drafts, and does not send', async () => {
    previewProgramDeadlineMock.mockRejectedValueOnce(
      new ApiError(invalidGuidanceProblem),
    );
    mounted = await renderWithQuery(
      <DeadlineDigestDialog
        programId="program-1"
        returnFocusRef={{ current: trigger }}
        onClose={() => undefined}
      />,
    );
    await flush();

    const studentGuidance = document.body.querySelector<HTMLTextAreaElement>(
      '#deadline-studentGuidance',
    );
    const staffGuidance = document.body.querySelector<HTMLTextAreaElement>(
      '#deadline-staffGuidance',
    );
    if (studentGuidance === null || staffGuidance === null)
      throw new TypeError('Missing guidance fields');
    await act(async () => {
      setValue(studentGuidance, '<script>학생 안내</script>');
      setValue(staffGuidance, '교직원 안내');
    });
    await act(async () => button('미리보기').click());
    await flush();

    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    expect(studentGuidance.value).toBe('<script>학생 안내</script>');
    expect(staffGuidance.value).toBe('교직원 안내');
    expect(queryButton('보내기')).toBeUndefined();
    expect(previewProgramDeadlineMock).toHaveBeenCalledTimes(1);
    expect(sendProgramDeadlineMock).not.toHaveBeenCalled();
  });

  it('surfaces the API error detail when the preview fails unexpectedly', async () => {
    previewProgramDeadlineMock.mockRejectedValueOnce(
      new ApiError(serverProblem),
    );
    mounted = await renderWithQuery(
      <DeadlineDigestDialog
        programId="program-1"
        returnFocusRef={{ current: trigger }}
        onClose={() => undefined}
      />,
    );
    await flush();

    const studentGuidance = document.body.querySelector<HTMLTextAreaElement>(
      '#deadline-studentGuidance',
    );
    if (studentGuidance === null)
      throw new TypeError('Missing student guidance');
    await act(async () => setValue(studentGuidance, '학생 초안'));
    await act(async () => button('미리보기').click());
    await flush();

    expect(
      document.querySelector('[role="alert"] [data-slot="alert-description"]'),
    ).not.toBeNull();
    expect(studentGuidance.value).toBe('학생 초안');
    expect(queryButton('보내기')).toBeUndefined();
    expect(button('미리보기').disabled).toBe(false);
    expect(sendProgramDeadlineMock).not.toHaveBeenCalled();
  });

  it('keeps an in-flight send authoritative when the preview expiry passes', async () => {
    let resolveSend: (value: unknown) => void = () => undefined;
    sendProgramDeadlineMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSend = resolve;
      }),
    );
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
    await act(async () => vi.advanceTimersByTime(599_999));
    await act(async () => button('보내기').click());
    await act(async () => vi.advanceTimersByTime(2));

    expect(button('보내는 중…').disabled).toBe(true);
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(
      queryButton('닫기') ? 1 : 0,
    );
    expect(sendProgramDeadlineMock).toHaveBeenCalledTimes(1);

    await act(async () =>
      resolveSend({
        ...preview,
        sentCount: 4,
        duplicateCount: 0,
        failedCount: 0,
      }),
    );

    expect(
      counts(
        document.querySelector('[role="alert"] [data-slot="alert-title"]'),
      ),
    ).toEqual([4]);
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(
      queryButton('닫기') ? 1 : 0,
    );
    expect(document.body.querySelector('#deadline-studentGuidance')).toBeNull();
    expect(queryButton('닫기')).toBeDefined();

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });

    expect(
      counts(
        document.querySelector('[role="alert"] [data-slot="alert-title"]'),
      ),
    ).toEqual([4]);
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(
      queryButton('닫기') ? 1 : 0,
    );
    expect(document.body.querySelector('#deadline-studentGuidance')).toBeNull();
    expect(sendProgramDeadlineMock).toHaveBeenCalledTimes(1);
  });

  it('changes the personalized student preview without changing recipients or the send payload', async () => {
    previewProgramDeadlineMock.mockResolvedValueOnce(personalizedPreview);
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

    const studentSelect = document.body.querySelector<HTMLSelectElement>(
      'select[id$="-student"]',
    );
    if (studentSelect === null)
      throw new TypeError('Missing student preview selector');
    expect([...studentSelect.options].map((option) => option.value)).toEqual([
      '0',
      '1',
    ]);

    await act(async () => {
      studentSelect.value = '1';
      studentSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(studentSelect.value).toBe('1');

    const studentFrame = document.body.querySelector<HTMLIFrameElement>(
      'iframe[title="학생용 메일 본문"]',
    );
    expect(studentFrame?.getAttribute('srcdoc')).not.toContain(
      '<p>학생 본문</p>',
    );
    expect(
      new DOMParser()
        .parseFromString(studentFrame?.srcdoc ?? '', 'text/html')
        .querySelector('a')
        ?.getAttribute('href'),
    ).toBe('https://example.test/programs/program-1/submissions');
    expect(studentFrame?.getAttribute('sandbox')).toBe(
      'allow-popups allow-popups-to-escape-sandbox',
    );
    expect(confirmationCounts()).toEqual([4, 2]);
    expect(previewProgramDeadlineMock).toHaveBeenCalledTimes(1);

    await act(async () => button('보내기').click());
    await flush();

    expect(sendProgramDeadlineMock).toHaveBeenCalledTimes(1);
    expect(sendProgramDeadlineMock).toHaveBeenCalledWith('program-1', {
      previewedAt: personalizedPreview.previewedAt,
      previewVersion: personalizedPreview.previewVersion,
      studentGuidance: '',
      staffGuidance: '',
    });
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

    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    expect(document.activeElement?.id).toBe('deadline-studentGuidance');
    expect(sendProgramDeadlineMock).not.toHaveBeenCalled();
  });
});
