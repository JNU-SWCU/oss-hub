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
  previewedAt: '2026-08-14T00:00:00.000Z',
  expiresAt: '2026-08-14T00:10:00.000Z',
  previewVersion: 'a'.repeat(64),
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
  });

  it('renders the default-off authoring toggle without a global preview or send action', () => {
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
    expect(container.textContent).not.toContain('student-');

    await act(async () => button('알림 보내기').click());

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      apiPath('programs/program-1/deadline-digest/preview'),
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      apiPath('programs/program-1/deadline-digest/send'),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      previewedAt: preview.previewedAt,
      previewVersion: preview.previewVersion,
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

    await act(async () => button('알림 보내기').click());

    expect(container.textContent).toContain(
      '발송 대상이 바뀌었거나 미리보기가 만료되었습니다. 다시 미리보세요.',
    );
    expect(button('알림 보내기').disabled).toBe(true);
    expect(
      container.querySelector('[aria-label="대상 마일스톤 2개"]'),
    ).toBeNull();
  });

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
