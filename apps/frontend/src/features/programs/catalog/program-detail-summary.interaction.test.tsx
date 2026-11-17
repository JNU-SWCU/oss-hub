import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { ProgramSummary } from './program-detail-summary';
import type { ProgramDetail } from './dto';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const program: ProgramDetail = {
  id: 'program-1',
  name: 'OSS 경진대회',
  organizers: ['운영기관'],
  trackType: 'EXTRACURRICULAR',

  applicationTemplateKey: 'oss-contest',
  description: '프로그램 설명',
  repositoryProvisioningEnabled: true,
  applicationPeriod: {
    startsAt: '2026-07-01T00:00:00+09:00',
    endsAt: '2026-08-31T23:59:59+09:00',
  },
  viewer: { role: 'STAFF', applicationStatus: null },
  milestones: [],
};

const FIVE_LINES = 120;
const TEN_LINES = 240;
const MEASURED = ['scrollHeight', 'clientHeight'] as const;
const nativeMeasures = MEASURED.map(
  (name) =>
    [
      name,
      Object.getOwnPropertyDescriptor(HTMLElement.prototype, name),
    ] as const,
);

function layOutGuide(contentHeight: number): void {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get: () => contentHeight,
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => Math.min(contentHeight, FIVE_LINES),
  });
}

const mountedRoots: Root[] = [];

function renderSummary(currentProgram: ProgramDetail) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mountedRoots.push(root);
  act(() => {
    root.render(<ProgramSummary program={currentProgram} overview={null} />);
  });
  return { container, root };
}

function toggleOf(container: HTMLElement): HTMLButtonElement | null {
  return container.querySelector('[data-slot="program-guide"] button');
}

function getGuide(container: HTMLElement) {
  const toggle = toggleOf(container);
  if (toggle === null) {
    throw new TypeError('프로그램 안내 펼침 버튼을 찾을 수 없습니다.');
  }
  const contentId = toggle.getAttribute('aria-controls');
  const content =
    contentId === null ? null : document.getElementById(contentId);
  if (!(content instanceof HTMLElement)) {
    throw new TypeError('aria-controls 대상 안내 본문을 찾을 수 없습니다.');
  }
  return { content, toggle };
}

afterEach(() => {
  for (const root of mountedRoots.splice(0)) {
    act(() => {
      root.unmount();
    });
  }
  document.body.replaceChildren();
  for (const [name, descriptor] of nativeMeasures) {
    if (descriptor === undefined) {
      Reflect.deleteProperty(HTMLElement.prototype, name);
    } else {
      Object.defineProperty(HTMLElement.prototype, name, descriptor);
    }
  }
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('ProgramSummary 안내 펼침', () => {
  it('다섯 줄을 넘는 안내는 접힌 채로 시작하고 본문과 연결된 버튼을 둔다', () => {
    layOutGuide(TEN_LINES);
    const { container } = renderSummary(program);

    const { content, toggle } = getGuide(container);

    expect(toggle.textContent).toBe('전체 보기');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(content.textContent).toBe('프로그램 설명');
    expect(content.classList).toContain('line-clamp-5');
  });

  it('다섯 줄 안에 드는 안내에는 버튼을 두지 않는다', () => {
    layOutGuide(FIVE_LINES);
    const { container } = renderSummary(program);

    expect(container.textContent).toContain('프로그램 설명');
    expect(toggleOf(container)).toBeNull();
  });

  it('전체 보기를 누르면 줄 제한을 풀고, 접기를 누르면 다시 건다', () => {
    layOutGuide(TEN_LINES);
    const { container } = renderSummary(program);
    const { content, toggle } = getGuide(container);

    act(() => {
      toggle.click();
    });

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toBe('접기');
    expect(content.classList).not.toContain('line-clamp-5');

    act(() => {
      toggle.click();
    });

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toBe('전체 보기');
    expect(content.classList).toContain('line-clamp-5');
  });

  it('펼친 사이 안내가 짧아지면 접을 때 다시 재서 버튼을 치운다', () => {
    layOutGuide(TEN_LINES);
    const { container, root } = renderSummary(program);
    act(() => {
      getGuide(container).toggle.click();
    });

    layOutGuide(FIVE_LINES);
    act(() => {
      root.render(
        <ProgramSummary
          program={{ ...program, description: '짧아진 설명' }}
          overview={null}
        />,
      );
    });
    expect(getGuide(container).toggle.textContent).toBe('접기');

    act(() => {
      getGuide(container).toggle.click();
    });

    expect(container.textContent).toContain('짧아진 설명');
    expect(toggleOf(container)).toBeNull();
  });

  it('펼친 상태에서 프로그램 ID가 바뀌면 접힌 상태로 초기화한다', () => {
    layOutGuide(TEN_LINES);
    const { container, root } = renderSummary(program);
    act(() => {
      getGuide(container).toggle.click();
    });

    act(() => {
      root.render(
        <ProgramSummary
          program={{
            ...program,
            id: 'program-2',
            description: '두 번째 프로그램 설명',
          }}
          overview={null}
        />,
      );
    });

    const next = getGuide(container);
    expect(next.toggle.getAttribute('aria-expanded')).toBe('false');
    expect(next.content.textContent).toBe('두 번째 프로그램 설명');
    expect(next.content.classList).toContain('line-clamp-5');
  });
});
