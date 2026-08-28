// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { ProgramSummary } from './program-detail-summary';
import type { ProgramDetail } from './types';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const program: ProgramDetail = {
  id: 'program-1',
  name: 'OSS 경진대회',
  organizer: '운영기관',
  category: 'OSS_CONTEST',
  description: '프로그램 설명',
  repositoryProvisioningEnabled: true,
  applicationPeriod: {
    startsAt: '2026-07-01T00:00:00+09:00',
    endsAt: '2026-08-31T23:59:59+09:00',
  },
  viewer: { role: 'STAFF', applicationStatus: null },
  milestones: [],
};

const mountedRoots: Root[] = [];

function renderSummary(currentProgram: ProgramDetail) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mountedRoots.push(root);
  act(() => {
    root.render(<ProgramSummary program={currentProgram} />);
  });
  return { container, root };
}

function getDisclosure(container: HTMLElement) {
  const trigger = container.querySelector('button');
  if (!(trigger instanceof HTMLButtonElement)) {
    throw new TypeError('프로그램 안내 트리거를 찾을 수 없습니다.');
  }
  const contentId = trigger.getAttribute('aria-controls');
  if (contentId === null) {
    throw new TypeError('프로그램 안내 트리거에 aria-controls가 없습니다.');
  }
  const content = document.getElementById(contentId);
  if (!(content instanceof HTMLElement)) {
    throw new TypeError('aria-controls 대상 설명 영역을 찾을 수 없습니다.');
  }
  return { content, contentId, trigger };
}

afterEach(() => {
  for (const root of mountedRoots.splice(0)) {
    act(() => {
      root.unmount();
    });
  }
  document.body.replaceChildren();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('ProgramSummary disclosure', () => {
  it('설명이 있으면 안정적인 연결을 유지한 채 닫힌 상태로 시작한다', () => {
    // Given
    const { container } = renderSummary(program);

    // When
    const { content, contentId, trigger } = getDisclosure(container);

    // Then
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(content.id).toBe(contentId);
    expect(content.getAttribute('data-state')).toBe('closed');
    expect(content.classList).toContain('data-[state=closed]:hidden');
    expect(content.textContent).toContain('프로그램 설명');
  });

  it('닫힌 안내 트리거를 클릭하면 설명을 연다', () => {
    // Given
    const { container } = renderSummary(program);
    const { content, trigger } = getDisclosure(container);

    // When
    act(() => {
      trigger.click();
    });

    // Then
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(content.getAttribute('data-state')).toBe('open');
  });

  it('열린 안내 트리거를 클릭하면 설명을 다시 닫는다', () => {
    // Given
    const { container } = renderSummary(program);
    const { content, trigger } = getDisclosure(container);
    act(() => {
      trigger.click();
    });

    // When
    act(() => {
      trigger.click();
    });

    // Then
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(content.getAttribute('data-state')).toBe('closed');
  });

  it('열린 상태에서 프로그램 ID가 바뀌면 닫힌 상태로 초기화한다', () => {
    // Given
    const { container, root } = renderSummary(program);
    const { trigger } = getDisclosure(container);
    act(() => {
      trigger.click();
    });

    // When
    act(() => {
      root.render(
        <ProgramSummary
          program={{
            ...program,
            id: 'program-2',
            description: '두 번째 프로그램 설명',
          }}
        />,
      );
    });

    // Then
    const nextDisclosure = getDisclosure(container);
    expect(nextDisclosure.trigger.getAttribute('aria-expanded')).toBe('false');
    expect(nextDisclosure.content.getAttribute('data-state')).toBe('closed');
    expect(nextDisclosure.content.textContent).toContain(
      '두 번째 프로그램 설명',
    );
  });
});
