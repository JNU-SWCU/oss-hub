import { act, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryRoot as createRoot } from '../../../../test-support/render-with-query';
import { apiPath } from '@/lib/api-client';
import type { EditableProgram } from '../authoring/dto';

type Root = ReturnType<typeof createRoot>;

const getEditableProgramMock = vi.hoisted(() => vi.fn());

vi.mock('../authoring/api', () => ({
  getEditableProgram: getEditableProgramMock,
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
  }: {
    readonly href: string;
    readonly children: ReactNode;
  }) => <a href={href}>{children}</a>,
}));

import { ProgramNotificationsPage } from './program-notifications-page';

const program: EditableProgram = {
  id: 'program-1',
  name: '마감 알림 프로그램',
  organizers: ['합성 주관기관'],
  trackType: 'EXTRACURRICULAR',
  applicationTemplateKey: 'oss-contest',
  applicationTemplateVersion: 1,
  applicationCount: 3,
  applicationStartAt: '2026-08-01T00:00:00.000Z',
  applicationEndAt: '2026-08-10T00:00:00.000Z',
  startAt: '2026-08-11T00:00:00.000Z',
  endAt: '2026-09-30T00:00:00.000Z',
  repositoryProvisioningEnabled: false,
  notifyOnDeadline: true,
  description: '합성 프로그램',
  teamMinSize: 1,
  teamMaxSize: 1,
  milestones: [],
};

const preview = {
  applicationCount: 3,
  milestoneCount: 2,
  recipientCount: 4,
  inactiveCount: 1,
  optedOutCount: 2,
  noEmailCount: 1,
  staffRecipientCount: 2,
  previewedAt: '2026-08-14T00:00:00.000Z',
  expiresAt: '2026-08-14T00:10:00.000Z',
  previewVersion: 'a'.repeat(64),
  studentPreviews: [
    {
      displayName: '참여자A',
      subject: '학생 안내 A',
      text: '학생 본문 A',
      html: '<a href="https://example.test/programs/a/submissions" target="_blank" rel="noopener noreferrer">제출하러 가기</a>',
    },
    {
      displayName: '참여자B',
      subject: '학생 안내 B',
      text: '학생 본문 B',
      html: '<p>학생 본문 B</p>',
    },
  ],
  staffPreview: {
    subject: '교직원 요약',
    text: '교직원 본문',
    html: '<a href="https://example.test/dashboard" target="_blank" rel="noopener noreferrer">서류 현황 보기</a>',
  },
};

const emptyPreview = {
  ...preview,
  recipientCount: 0,
  staffRecipientCount: 0,
  studentPreviews: [],
  staffPreview: null,
};

const sent = {
  ...preview,
  sentAt: '2026-08-14T00:01:00.000Z',
  sentCount: 4,
  duplicateCount: 0,
  failedCount: 0,
};

const staleProblem = {
  type: 'https://oss-hub.dev/problems/deadline-preview-stale',
  title: 'Deadline preview stale',
  status: 409,
  detail: 'Preview expired or eligibility changed.',
  code: 'NOT_005',
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ProgramNotificationsPage', () => {
  let container: HTMLDivElement;
  let root: Root;
  const fetchMock =
    vi.fn<
      (
        input: string,
        init?: Omit<RequestInit, 'body'> & { body?: string },
      ) => Promise<Response>
    >();

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date('2026-08-14T00:00:00.000Z'));
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
      value: true,
      configurable: true,
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    fetchMock.mockReset();
    getEditableProgramMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('shows the off state with a link to the operations settings and no send controls', async () => {
    await mount({ ...program, notifyOnDeadline: false });

    expect(container.textContent).toContain('제출 마감 알림이 꺼져 있습니다');
    const link = [...container.querySelectorAll('a')].find(
      (candidate) => candidate.textContent?.trim() === '운영 설정 열기',
    );
    expect(link?.getAttribute('href')).toBe(
      '/programs/program-1/edit#operations',
    );
    expect(container.querySelector('textarea')).toBeNull();
    expect(
      [...container.querySelectorAll('button')].some((candidate) =>
        candidate.textContent?.includes('보내기'),
      ),
    ).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('previews count-only exclusions and sends the exact preview version from a persisted Program', async () => {
    fetchMock
      .mockResolvedValueOnce(response(preview))
      .mockResolvedValueOnce(response(sent));
    await mount();

    expect(
      container.querySelector('[aria-label="발송 가능 4명"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[aria-label="수신 거부 2명"]'),
    ).not.toBeNull();
    expect(container.querySelector('[aria-label="비활성 1명"]')).not.toBeNull();
    expect(
      container.querySelector('[aria-label="이메일 없음 1명"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[aria-label="미제출 신청 3건"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[aria-label="대상 마일스톤 2개"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[aria-label="교직원 요약 수신 2명"]'),
    ).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain('student-');
    expect(sendButton().textContent?.trim()).toBe('6명에게 보내기');

    await act(async () => sendButton().click());
    await act(async () => dialogButton('보내기').click());

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      apiPath('programs/program-1/deadline-digest/preview'),
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      apiPath('programs/program-1/deadline-digest/send'),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      previewedAt: preview.previewedAt,
      previewVersion: preview.previewVersion,
      studentGuidance: '',
      staffGuidance: '',
    });
    expect(container.textContent).toContain('4명에게 보냈습니다');
    expect(dialog()).toBeNull();
  });

  it('discards a stale preview and requires a new preview after a 409 response', async () => {
    fetchMock
      .mockResolvedValueOnce(response(preview))
      .mockResolvedValueOnce(response(staleProblem, 409));
    await mount();

    await act(async () => sendButton().click());
    await act(async () => dialogButton('보내기').click());

    expect(container.textContent).toContain(
      '발송 대상이 바뀌었거나 미리보기가 만료되었습니다. 다시 미리보세요.',
    );
    expect(sendButton().disabled).toBe(true);
    expect(
      container.querySelector('[aria-label="대상 마일스톤 2개"]'),
    ).toBeNull();
    expect(dialog()).toBeNull();
  });

  it('shows personalized rendered mail with actionable links without changing recipients', async () => {
    fetchMock.mockResolvedValueOnce(response(preview));
    await mount();

    const frame = container.querySelector('iframe[title="학생용 메일 본문"]');
    expect(frame?.getAttribute('srcdoc')).toContain(
      'https://example.test/programs/a/submissions',
    );
    expect(frame?.getAttribute('sandbox')).toBe(
      'allow-popups allow-popups-to-escape-sandbox',
    );
    const select = container.querySelector('select');
    if (!(select instanceof HTMLSelectElement))
      throw new TypeError('Missing recipient selector');
    await act(async () => {
      select.value = '1';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.textContent).toContain('학생 안내 B');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sendButton().disabled).toBe(false);
  });

  it('preserves both guidance drafts across tabs and requires a refresh after editing', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(response(preview)));
    await mount();

    await changeGuidance('학생용 추가 안내', '학생 안내 초안');
    await changeGuidance('교직원용 추가 안내', '교직원 안내 초안');
    expect(sendButton().disabled).toBe(true);
    await act(async () => button('미리보기 새로고침').click());
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      studentGuidance: '학생 안내 초안',
      staffGuidance: '교직원 안내 초안',
    });
    expect(sendButton().disabled).toBe(false);

    await act(async () => button('교직원용').click());
    await changeGuidance('학생용 추가 안내', '고친 학생 안내');
    expect(sendButton().disabled).toBe(true);
    expect(
      container.querySelector('textarea[aria-label="교직원용 추가 안내"]')
        ?.textContent,
    ).toBe('교직원 안내 초안');
    await act(async () => button('미리보기 새로고침').click());
    expect(sendButton().disabled).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      studentGuidance: '고친 학생 안내',
      staffGuidance: '교직원 안내 초안',
    });
  });

  it('locks sending when the preview expires without another user action', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(response(preview)));
    await mount();

    await act(async () => {
      vi.advanceTimersByTime(600_001);
    });
    expect(sendButton().disabled).toBe(true);
    expect(container.textContent).toContain('만료');
  });

  it('closes the confirmation on expiry and keeps it closed after the next refresh', async () => {
    fetchMock.mockResolvedValueOnce(response(preview)).mockResolvedValueOnce(
      response({
        ...preview,
        previewedAt: '2026-08-14T00:10:00.001Z',
        expiresAt: '2026-08-14T00:20:00.001Z',
      }),
    );
    await mount();

    await act(async () => sendButton().click());
    await act(async () => dialogButton('취소').click());
    await act(async () => sendButton().click());
    expect(dialog()).not.toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(600_001);
    });
    expect(dialog()).toBeNull();
    expect(container.textContent).toContain('만료');

    await act(async () => button('미리보기 새로고침').click());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sendButton().disabled).toBe(false);
    expect(dialog()).toBeNull();

    await act(async () => sendButton().click());
    expect(dialog()?.textContent).toContain('학생 4명, 교직원 2명');
  });

  it('waits for an in-flight send result instead of replacing it with local expiry', async () => {
    let resolveSend: (response: Response) => void = () => undefined;
    fetchMock.mockResolvedValueOnce(response(preview)).mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveSend = resolve;
      }),
    );
    await mount();

    await act(async () => {
      vi.advanceTimersByTime(599_999);
    });
    await act(async () => sendButton().click());
    await act(async () => dialogButton('보내기').click());
    await act(async () => {
      vi.advanceTimersByTime(2);
    });
    expect(dialogButton('보내는 중…').disabled).toBe(true);
    await act(async () =>
      resolveSend(response({ ...sent, sentAt: '2026-08-14T00:10:00.001Z' })),
    );
    expect(container.textContent).toContain('4명에게 보냈습니다');
    expect(container.textContent).not.toContain('미리보기가 만료되었습니다');
    expect(dialog()).toBeNull();
  });

  it('ignores a late preview response when guidance changed during the request', async () => {
    let resolvePreview: (response: Response) => void = () => undefined;
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolvePreview = resolve;
      }),
    );
    await mount(program, { settled: false });

    await changeGuidance('학생용 추가 안내', '더 새 안내');
    await act(async () => resolvePreview(response(preview)));
    expect(sendButton().disabled).toBe(true);
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('preserves both guidance drafts after a 409 and refreshes without sending automatically', async () => {
    fetchMock
      .mockImplementationOnce(() => Promise.resolve(response(preview)))
      .mockImplementationOnce(() => Promise.resolve(response(preview)))
      .mockImplementationOnce(() =>
        Promise.resolve(response(staleProblem, 409)),
      )
      .mockImplementationOnce(() =>
        Promise.resolve(
          response({ ...preview, previewVersion: 'b'.repeat(64) }),
        ),
      );
    await mount();

    await changeGuidance('학생용 추가 안내', '학생 초안');
    await changeGuidance('교직원용 추가 안내', '교직원 초안');
    await act(async () => button('미리보기 새로고침').click());
    await act(async () => sendButton().click());
    await act(async () => dialogButton('보내기').click());
    expect(sendButton().disabled).toBe(true);
    expect(
      container.querySelector<HTMLTextAreaElement>('#studentGuidance')?.value,
    ).toBe('학생 초안');
    expect(
      container.querySelector<HTMLTextAreaElement>('#staffGuidance')?.value,
    ).toBe('교직원 초안');
    await act(async () => button('미리보기 새로고침').click());
    expect(
      fetchMock.mock.calls.map((call) => String(call[0]).split('/').at(-1)),
    ).toEqual(['preview', 'preview', 'send', 'preview']);
    expect(sendButton().disabled).toBe(false);
  });

  it('preserves malformed guidance after a server rejection and explains the limit', async () => {
    fetchMock.mockResolvedValueOnce(response(preview)).mockResolvedValueOnce(
      response(
        {
          type: 'about:blank',
          title: 'Bad draft',
          status: 400,
          detail: 'invalid',
          code: 'VAL_001',
        },
        400,
      ),
    );
    await mount();

    await changeGuidance('학생용 추가 안내', '<script>평문 안내</script>');
    await act(async () => button('미리보기 새로고침').click());
    expect(
      container.querySelector<HTMLTextAreaElement>('#studentGuidance')?.value,
    ).toBe('<script>평문 안내</script>');
    expect(container.textContent).toContain('각각 4,000자 이내의 평문');
    expect(sendButton().disabled).toBe(true);
  });

  it('shows exclusions and an explicit empty body when there are no recipients', async () => {
    fetchMock.mockResolvedValueOnce(response(emptyPreview));
    await mount();

    expect(container.textContent).toContain(
      '발송 대상이 없어 학생용 메일 본문이 없습니다.',
    );
    expect(
      container.querySelector('[aria-label="수신 거부 2명"]'),
    ).not.toBeNull();
    expect(sendButton().disabled).toBe(true);
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('enforces the guidance limit before preview and preserves all entered text', async () => {
    fetchMock.mockResolvedValueOnce(response(preview));
    await mount();

    await changeGuidance('학생용 추가 안내', 'x'.repeat(4001));
    expect(button('미리보기 새로고침').disabled).toBe(true);
    expect(sendButton().disabled).toBe(true);
    expect(
      container.querySelector<HTMLTextAreaElement>('#studentGuidance')?.value,
    ).toHaveLength(4001);
    expect(
      container.querySelector('#studentGuidance')?.getAttribute('aria-invalid'),
    ).toBe('true');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('disables sending at zero recipients and counts staff into the send label', async () => {
    fetchMock.mockResolvedValueOnce(response(emptyPreview));
    await mount();

    expect(sendButton().textContent?.trim()).toBe('0명에게 보내기');
    expect(sendButton().disabled).toBe(true);
    expect(dialog()).toBeNull();

    fetchMock.mockResolvedValueOnce(
      response({ ...emptyPreview, staffRecipientCount: 2 }),
    );
    await act(async () => button('미리보기 새로고침').click());
    expect(sendButton().textContent?.trim()).toBe('2명에게 보내기');
    expect(sendButton().disabled).toBe(false);
    await act(async () => sendButton().click());
    expect(dialog()?.textContent).toContain(
      '학생 0명, 교직원 2명에게 마감 알림을 보냅니다.',
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sends only after the confirmation dialog is confirmed and never on cancel', async () => {
    fetchMock
      .mockResolvedValueOnce(response(preview))
      .mockResolvedValueOnce(response(sent));
    await mount();

    await act(async () => sendButton().click());
    expect(dialog()?.textContent).toContain(
      '학생 4명, 교직원 2명에게 마감 알림을 보냅니다. 보낸 메일은 취소할 수 없습니다.',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => dialogButton('취소').click());
    expect(dialog()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sendButton().disabled).toBe(false);
    expect(container.textContent).not.toContain('보냈습니다');

    await act(async () => sendButton().click());
    await act(async () => dialogButton('보내기').click());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      apiPath('programs/program-1/deadline-digest/send'),
    );
    expect(dialog()).toBeNull();
    expect(container.textContent).toContain('4명에게 보냈습니다');
    expect(sendButton().disabled).toBe(true);
  });

  it('sends once when the confirmation is clicked repeatedly before and during the in-flight send', async () => {
    let resolveSend: (response: Response) => void = () => undefined;
    fetchMock.mockResolvedValueOnce(response(preview)).mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveSend = resolve;
      }),
    );
    await mount();

    await act(async () => sendButton().click());
    await act(async () => {
      const confirm = dialogButton('보내기');
      confirm.click();
      confirm.click();
      confirm.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const confirm = dialogButton('보내는 중…');
    expect(confirm.disabled).toBe(true);
    await act(async () => {
      confirm.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(dialog()).not.toBeNull();

    await act(async () => resolveSend(response(sent)));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(dialog()).toBeNull();
    expect(container.textContent).toContain('4명에게 보냈습니다');
  });

  async function mount(
    current: EditableProgram = program,
    { settled = true }: { readonly settled?: boolean } = {},
  ) {
    getEditableProgramMock.mockResolvedValue(current);
    await act(async () =>
      root.render(<ProgramNotificationsPage programId={current.id} />),
    );
    await waitFor(() => container.textContent?.includes(current.name) === true);
    if (!current.notifyOnDeadline) return;
    await waitFor(() => fetchMock.mock.calls.length > 0);
    if (settled) {
      await waitFor(
        () => container.textContent?.includes('발송 대상 계산 중') === false,
      );
    }
  }

  async function waitFor(predicate: () => boolean) {
    for (let round = 0; round < 50; round += 1) {
      if (predicate()) return;
      await act(async () => {
        await Promise.resolve();
      });
    }
    throw new Error('Condition was not reached within the microtask budget');
  }

  async function changeGuidance(label: string, value: string) {
    const textarea = container.querySelector(`textarea[aria-label="${label}"]`);
    if (!(textarea instanceof HTMLTextAreaElement))
      throw new TypeError(`Missing ${label}`);
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set?.call(textarea, value);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  function findButton(scope: ParentNode, name: string): HTMLButtonElement {
    const match = [...scope.querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.trim() === name,
    );
    if (!(match instanceof HTMLButtonElement)) {
      throw new TypeError(`Missing button: ${name}`);
    }
    return match;
  }

  function button(name: string): HTMLButtonElement {
    return findButton(container, name);
  }

  function sendButton(): HTMLButtonElement {
    const match = [...container.querySelectorAll('button')].find((candidate) =>
      /^(\d+명에게 )?보내기$/u.test(candidate.textContent?.trim() ?? ''),
    );
    if (!(match instanceof HTMLButtonElement)) {
      throw new TypeError('Missing send button');
    }
    return match;
  }

  function dialog(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[role="alertdialog"]');
  }

  function dialogButton(name: string): HTMLButtonElement {
    const open = dialog();
    if (open === null) throw new TypeError('Confirmation dialog is not open');
    return findButton(open, name);
  }
});
