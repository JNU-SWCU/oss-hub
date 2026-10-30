import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FOCUS_ROOT_MARGIN } from './components/landing-focus';
import { LANDING_GRAPH_EXAMPLE } from './landing-graph';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('./components/use-landing-graph', () => ({
  useLandingGraph: () => ({
    graph: LANDING_GRAPH_EXAMPLE,
    completeness: 'complete',
    programs: [],
  }),
}));

import { LandingJourney } from './components/landing-journey';

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly observe = vi.fn();
  readonly unobserve = vi.fn();
  readonly disconnect = vi.fn();

  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {
    FakeIntersectionObserver.instances.push(this);
  }
}

describe('LandingJourney chapter focus', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    FakeIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() =>
      root.render(
        <LandingJourney
          primaryAction={<a href="/login">GitHub으로 로그인</a>}
        />,
      ),
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function focusObserver(): FakeIntersectionObserver {
    const instance = FakeIntersectionObserver.instances.find(
      (candidate) => candidate.options?.rootMargin === FOCUS_ROOT_MARGIN,
    );
    if (instance === undefined) {
      throw new Error(
        '챕터 포커스 IntersectionObserver가 만들어지지 않았습니다',
      );
    }
    return instance;
  }

  function chapter(focus: string): HTMLElement {
    const element = container.querySelector<HTMLElement>(
      `section[data-focus="${focus}"]`,
    );
    if (element === null) throw new Error(`${focus} 챕터를 찾지 못했습니다`);
    return element;
  }

  function skyFocus(): string | null {
    const sky = container.querySelector('[aria-hidden="true"][data-focus]');
    return sky?.getAttribute('data-focus') ?? null;
  }

  function enter(focus: string): void {
    const instance = focusObserver();
    act(() => {
      instance.callback(
        [
          {
            target: chapter(focus),
            isIntersecting: true,
            intersectionRatio: 0.2,
          },
        ] as unknown as IntersectionObserverEntry[],
        instance as unknown as IntersectionObserver,
      );
    });
  }

  it('observes the hero and the three chapters and starts on the hero focus', () => {
    expect(focusObserver().observe).toHaveBeenCalledTimes(4);
    expect(focusObserver().observe).toHaveBeenCalledWith(chapter('hero'));
    expect(focusObserver().observe).toHaveBeenCalledWith(chapter('activity'));
    expect(skyFocus()).toBe('hero');
  });

  it('moves the graph focus to the chapter the observer reports and back', () => {
    enter('flow');
    expect(skyFocus()).toBe('flow');

    enter('activity');
    expect(skyFocus()).toBe('activity');

    enter('programs');
    expect(skyFocus()).toBe('programs');
  });

  it('disconnects the focus observer on unmount', () => {
    const instance = focusObserver();

    act(() => root.render(<p>본문</p>));

    expect(instance.disconnect).toHaveBeenCalledTimes(1);
  });
});
