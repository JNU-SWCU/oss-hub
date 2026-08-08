// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MilestoneDocumentSection } from './milestone-document-list';
import type { MilestoneDocument } from './milestone-document-api';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const milestoneDocument: MilestoneDocument = {
  id: 'document-1',
  milestoneId: 'milestone-1',
  name: '기획서',
  required: true,
  sortOrder: 0,
  submissionType: 'FILE',
  hasTemplateFile: false,
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('MilestoneDocumentSection response recovery', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('200/null을 실패 화면으로 바꾸고 사용자가 다시 불러올 수 있게 한다', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(null))
      .mockResolvedValueOnce(jsonResponse([milestoneDocument]));
    vi.stubGlobal('fetch', fetchMock);

    await act(async () => {
      root.render(
        <MilestoneDocumentSection
          milestoneId="milestone-1"
          viewerRole="STAFF"
          closed={false}
        />,
      );
    });
    await vi.waitFor(() => {
      expect(container.textContent).toContain(
        '제출 서류를 불러오지 못했습니다.',
      );
    });

    const retry = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === '다시 시도',
    );
    if (!(retry instanceof HTMLButtonElement)) {
      throw new TypeError('다시 시도 버튼을 찾지 못했습니다.');
    }
    await act(async () => retry.click());
    await vi.waitFor(() => {
      expect(container.textContent).toContain('기획서');
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
