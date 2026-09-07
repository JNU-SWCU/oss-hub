// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiPath } from '@/lib/api-client';
import { ProgramDeadlineControl } from './program-deadline-control';

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

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ProgramDeadlineControl', () => {
  let container: HTMLDivElement;
  let root: Root;
  const fetchMock = vi.fn();

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
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('renders the off authoring toggle without a global preview or send action', () => {
    const html = renderToStaticMarkup(
      <ProgramDeadlineControl
        enabled={false}
        onEnabledChange={() => undefined}
      />,
    );

    expect(html).toContain('제출 마감 알림');
    expect(html).toContain('24시간');
    expect(html).not.toContain('발송 대상 미리보기');
    expect(html).not.toContain('알림 보내기');
  });

  it('previews count-only exclusions and sends the exact preview version from a persisted Program', async () => {
    fetchMock.mockResolvedValueOnce(response(preview)).mockResolvedValueOnce(
      response({
        ...preview,
        sentAt: '2026-08-14T00:01:00.000Z',
        sentCount: 4,
        duplicateCount: 0,
        failedCount: 0,
      }),
    );
    await act(async () => {
      root.render(
        <ProgramDeadlineControl
          enabled
          persistedEnabled
          programId="program-1"
          onEnabledChange={() => undefined}
        />,
      );
    });

    await act(async () => button('발송 대상 미리보기').click());

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
    expect(container.textContent).toContain(
      '교직원 요약은 「안내 보내기」를 눌렀을 때만',
    );
    expect(container.textContent).not.toContain('student-');

    await act(async () => button('안내 보내기').click());

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
  });

  it('discards a stale preview and requires a new preview after a 409 response', async () => {
    fetchMock.mockResolvedValueOnce(response(preview)).mockResolvedValueOnce(
      response(
        {
          type: 'https://oss-hub.dev/problems/deadline-preview-stale',
          title: 'Deadline preview stale',
          status: 409,
          detail: 'Preview expired or eligibility changed.',
          code: 'NOT_005',
        },
        409,
      ),
    );
    await act(async () => {
      root.render(
        <ProgramDeadlineControl
          enabled
          persistedEnabled
          programId="program-1"
          onEnabledChange={() => undefined}
        />,
      );
    });
    await act(async () => button('발송 대상 미리보기').click());

    await act(async () => button('안내 보내기').click());

    expect(container.textContent).toContain(
      '발송 대상이 바뀌었거나 미리보기가 만료되었습니다. 다시 미리보세요.',
    );
    expect(button('안내 보내기').disabled).toBe(true);
    expect(
      container.querySelector('[aria-label="대상 마일스톤 2개"]'),
    ).toBeNull();
  });

  it('shows personalized rendered mail with actionable links without changing recipients', async () => {
    fetchMock.mockResolvedValueOnce(response(preview));
    await mount();
    await act(async () => button('발송 대상 미리보기').click());
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
    expect(button('안내 보내기').disabled).toBe(false);
  });

  it('preserves both guidance drafts across tabs and requires a refresh after editing', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(response(preview)));
    await mount();
    await changeGuidance('학생용 추가 안내', '학생 안내 초안');
    await changeGuidance('교직원용 추가 안내', '교직원 안내 초안');
    await act(async () => button('발송 대상 미리보기').click());
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      studentGuidance: '학생 안내 초안',
      staffGuidance: '교직원 안내 초안',
    });
    await act(async () => button('교직원용').click());
    await changeGuidance('학생용 추가 안내', '고친 학생 안내');
    expect(button('안내 보내기').disabled).toBe(true);
    expect(
      container.querySelector('textarea[aria-label="교직원용 추가 안내"]')
        ?.textContent,
    ).toBe('교직원 안내 초안');
    await act(async () => button('다시 미리보기').click());
    expect(button('안내 보내기').disabled).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('locks sending when the preview expires without another user action', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(response(preview)));
    await mount();
    await act(async () => button('발송 대상 미리보기').click());
    await act(async () => {
      vi.advanceTimersByTime(600_001);
    });
    expect(button('안내 보내기').disabled).toBe(true);
    expect(container.textContent).toContain('만료');
  });

  it('waits for an in-flight send result instead of replacing it with local expiry', async () => {
    let resolveSend: (response: Response) => void = () => undefined;
    fetchMock.mockResolvedValueOnce(response(preview)).mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveSend = resolve;
      }),
    );
    await mount();
    await act(async () => button('발송 대상 미리보기').click());
    await act(async () => {
      vi.advanceTimersByTime(599_999);
    });
    await act(async () => button('안내 보내기').click());
    await act(async () => {
      vi.advanceTimersByTime(2);
    });
    await act(async () =>
      resolveSend(
        response({
          ...preview,
          sentAt: '2026-08-14T00:10:00.001Z',
          sentCount: 4,
          duplicateCount: 0,
          failedCount: 0,
        }),
      ),
    );
    expect(container.textContent).toContain('4명에게 보냈습니다');
    expect(container.textContent).not.toContain('미리보기가 만료되었습니다');
  });

  it('ignores a late preview response when guidance changed during the request', async () => {
    let resolvePreview: (response: Response) => void = () => undefined;
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolvePreview = resolve;
      }),
    );
    await mount();
    await act(async () => button('발송 대상 미리보기').click());
    await changeGuidance('학생용 추가 안내', '더 새 안내');
    await act(async () => resolvePreview(response(preview)));
    expect(button('안내 보내기').disabled).toBe(true);
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('preserves both guidance drafts after a 409 and refreshes without sending automatically', async () => {
    fetchMock
      .mockImplementationOnce(() => Promise.resolve(response(preview)))
      .mockImplementationOnce(() =>
        Promise.resolve(
          response(
            {
              type: 'about:blank',
              title: 'Stale',
              status: 409,
              detail: 'stale',
              code: 'NOT_005',
            },
            409,
          ),
        ),
      )
      .mockImplementationOnce(() =>
        Promise.resolve(
          response({ ...preview, previewVersion: 'b'.repeat(64) }),
        ),
      );
    await mount();
    await changeGuidance('학생용 추가 안내', '학생 초안');
    await changeGuidance('교직원용 추가 안내', '교직원 초안');
    await act(async () => button('발송 대상 미리보기').click());
    await act(async () => button('안내 보내기').click());
    expect(button('안내 보내기').disabled).toBe(true);
    expect(
      container.querySelector<HTMLTextAreaElement>('#studentGuidance')?.value,
    ).toBe('학생 초안');
    expect(
      container.querySelector<HTMLTextAreaElement>('#staffGuidance')?.value,
    ).toBe('교직원 초안');
    await act(async () => button('다시 미리보기').click());
    expect(
      fetchMock.mock.calls.map((call) => String(call[0]).split('/').at(-1)),
    ).toEqual(['preview', 'send', 'preview']);
    expect(button('안내 보내기').disabled).toBe(false);
  });

  it('preserves malformed guidance after a server rejection and explains the limit', async () => {
    fetchMock.mockResolvedValueOnce(
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
    await act(async () => button('발송 대상 미리보기').click());
    expect(
      container.querySelector<HTMLTextAreaElement>('#studentGuidance')?.value,
    ).toBe('<script>평문 안내</script>');
    expect(container.textContent).toContain('각각 4,000자 이내의 평문');
    expect(button('안내 보내기').disabled).toBe(true);
  });

  it('shows exclusions and an explicit empty body when there are no recipients', async () => {
    fetchMock.mockResolvedValueOnce(
      response({
        ...preview,
        recipientCount: 0,
        staffRecipientCount: 0,
        studentPreviews: [],
        staffPreview: null,
      }),
    );
    await mount();
    await act(async () => button('발송 대상 미리보기').click());
    expect(container.textContent).toContain(
      '발송 대상이 없어 학생용 메일 본문이 없습니다.',
    );
    expect(
      container.querySelector('[aria-label="수신 거부 2명"]'),
    ).not.toBeNull();
    expect(button('안내 보내기').disabled).toBe(true);
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('enforces the guidance limit before preview and preserves all entered text', async () => {
    await mount();
    await changeGuidance('학생용 추가 안내', 'x'.repeat(4001));
    expect(button('발송 대상 미리보기').disabled).toBe(true);
    expect(
      container.querySelector<HTMLTextAreaElement>('#studentGuidance')?.value,
    ).toHaveLength(4001);
    expect(
      container.querySelector('#studentGuidance')?.getAttribute('aria-invalid'),
    ).toBe('true');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  async function mount() {
    await act(async () =>
      root.render(
        <ProgramDeadlineControl
          enabled
          persistedEnabled
          programId="program-1"
          onEnabledChange={() => undefined}
        />,
      ),
    );
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

  function button(name: string): HTMLButtonElement {
    const match = [...container.querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.trim() === name,
    );
    if (!(match instanceof HTMLButtonElement)) {
      throw new TypeError(`Missing button: ${name}`);
    }
    return match;
  }
});
