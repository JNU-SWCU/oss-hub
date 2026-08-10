// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CollectionStreamRepository } from '../types';
import { CollectionStreamsTable } from './collection-streams-table';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

// 정상(healthy) 저장소 — PULL_REQUEST stream이 아예 없다(3종 중 2종만 존재하는 경우).
const beta: CollectionStreamRepository = {
  repositoryName: 'jnu-oss/beta',
  streams: [
    {
      streamType: 'COMMIT',
      bucket: 'READY',
      lastSuccessAt: '2026-08-10T09:00:00.000Z',
      lastErrorCode: null,
      lastErrorAt: null,
    },
    {
      streamType: 'RELEASE',
      bucket: 'READY',
      lastSuccessAt: '2026-08-10T08:00:00.000Z',
      lastErrorCode: null,
      lastErrorAt: null,
    },
  ],
};

// 알려진 오류 코드로 재시도 대기 중인 저장소.
const alpha: CollectionStreamRepository = {
  repositoryName: 'jnu-oss/alpha',
  streams: [
    {
      streamType: 'COMMIT',
      bucket: 'READY',
      lastSuccessAt: '2026-08-10T09:00:00.000Z',
      lastErrorCode: null,
      lastErrorAt: null,
    },
    {
      streamType: 'PULL_REQUEST',
      bucket: 'RETRY_PENDING',
      lastSuccessAt: '2026-08-09T09:00:00.000Z',
      lastErrorCode: 'PROVIDER_RATE_LIMITED',
      lastErrorAt: '2026-08-10T08:30:00.000Z',
    },
    {
      streamType: 'RELEASE',
      bucket: 'READY',
      lastSuccessAt: '2026-08-10T09:00:00.000Z',
      lastErrorCode: null,
      lastErrorAt: null,
    },
  ],
};

// bucket은 READY로 회복했지만 알 수 없는(매핑되지 않은) 오류 코드가 남아 있는 저장소.
const gamma: CollectionStreamRepository = {
  repositoryName: 'jnu-oss/gamma',
  streams: [
    {
      streamType: 'COMMIT',
      bucket: 'READY',
      lastSuccessAt: '2026-08-10T09:00:00.000Z',
      lastErrorCode: 'PROVIDER_UNMAPPED_KIND',
      lastErrorAt: '2026-08-10T07:00:00.000Z',
    },
  ],
};

// PARTIAL bucket이지만 오류 기록은 없는 저장소.
const delta: CollectionStreamRepository = {
  repositoryName: 'jnu-oss/delta',
  streams: [
    {
      streamType: 'COMMIT',
      bucket: 'PARTIAL',
      lastSuccessAt: null,
      lastErrorCode: null,
      lastErrorAt: null,
    },
  ],
};

describe('CollectionStreamsTable', () => {
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
  });

  async function renderTable(
    repositories: readonly CollectionStreamRepository[],
  ): Promise<void> {
    await act(async () => {
      root.render(<CollectionStreamsTable repositories={repositories} />);
    });
  }

  function tableText(): string {
    return container.textContent ?? '';
  }

  function repositoryRows(): string[] {
    return [...container.querySelectorAll('tbody tr')].map(
      (row) => row.querySelector('td')?.textContent ?? '',
    );
  }

  function toggleButton(): HTMLButtonElement {
    const button = [...container.querySelectorAll('button')].find((el) =>
      el.textContent?.includes('문제만 보기'),
    );
    if (!button) throw new Error('토글 버튼을 찾지 못했다');
    return button as HTMLButtonElement;
  }

  it('저장소 한 줄에 커밋·PR·릴리즈·문제 열을 표시한다', async () => {
    await renderTable([beta]);
    expect(tableText()).toContain('jnu-oss/beta');
    expect(tableText()).toContain('저장소');
    expect(tableText()).toContain('커밋');
    expect(tableText()).toContain('PR');
    expect(tableText()).toContain('릴리즈');
    expect(tableText()).toContain('문제');
    // PULL_REQUEST stream이 없는 저장소는 em-dash로 표시한다.
    expect(tableText()).toContain('—');
  });

  it('문제(비-READY 버킷 또는 오류)가 있는 저장소를 먼저, 그다음 이름순으로 정렬한다', async () => {
    // 알파벳순이면 alpha, beta, delta, gamma지만 문제 저장소(alpha, delta, gamma)가
    // 먼저 오고, 정상인 beta는 맨 뒤로 밀려야 한다.
    await renderTable([beta, gamma, delta, alpha]);
    expect(repositoryRows()).toEqual([
      'jnu-oss/alpha',
      'jnu-oss/delta',
      'jnu-oss/gamma',
      'jnu-oss/beta',
    ]);
  });

  it('알려진 오류 코드는 한국어 설명으로, 알 수 없는 코드는 원문을 monospace로 보여준다', async () => {
    await renderTable([alpha, gamma]);
    expect(tableText()).toContain('GitHub 호출 한도 초과');
    expect(tableText()).not.toContain('PROVIDER_RATE_LIMITED');
    const code = container.querySelector('code');
    expect(code?.textContent).toBe('PROVIDER_UNMAPPED_KIND');
  });

  it('오류가 없는 저장소의 문제 열은 em-dash를 표시한다', async () => {
    await renderTable([beta]);
    const problemCell = container.querySelectorAll('tbody td')[4];
    expect(problemCell?.textContent).toBe('—');
  });

  it('버킷별 배지 라벨을 표시한다', async () => {
    await renderTable([alpha, delta]);
    expect(tableText()).toContain('완료');
    expect(tableText()).toContain('재시도 대기');
    expect(tableText()).toContain('부분');
  });

  it('「문제만 보기」 토글은 문제 저장소만 남기고 카운트를 함께 보여준다', async () => {
    await renderTable([beta, gamma, delta, alpha]);
    const button = toggleButton();
    expect(button.textContent).toContain('문제 3 / 전체 4');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(tableText()).toContain('jnu-oss/beta');

    await act(async () => {
      button.click();
    });

    expect(toggleButton().getAttribute('aria-pressed')).toBe('true');
    expect(repositoryRows()).toEqual([
      'jnu-oss/alpha',
      'jnu-oss/delta',
      'jnu-oss/gamma',
    ]);
    expect(tableText()).not.toContain('jnu-oss/beta');

    await act(async () => {
      toggleButton().click();
    });

    expect(toggleButton().getAttribute('aria-pressed')).toBe('false');
    expect(tableText()).toContain('jnu-oss/beta');
  });

  it('모두 정상이면 표는 그대로 보이고 토글은 「문제 0」을 표시한다', async () => {
    await renderTable([beta]);
    expect(toggleButton().textContent).toContain('문제 0 / 전체 1');
    expect(tableText()).toContain('jnu-oss/beta');
  });

  it('저장소가 없으면 빈 상태 문구를 보여준다', async () => {
    await renderTable([]);
    expect(tableText()).toContain('문제가 있는 저장소가 없습니다.');
  });
});
