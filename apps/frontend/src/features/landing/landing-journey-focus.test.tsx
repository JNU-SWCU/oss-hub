import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FOCUS_ROOT_MARGIN } from './components/landing-focus';
import * as cosmos from './cosmos';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
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
          starPrograms={[]}
          stats={{ items: [], note: null }}
          primaryAction={<a href="/login">GitHub으로 로그인</a>}
        />,
      ),
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
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
      `section[data-focus="${focus}"], section [data-focus="${focus}"]`,
    );
    if (element === null) throw new Error(`${focus} 챕터를 찾지 못했습니다`);
    return element;
  }

  function skyFocus(): string | null {
    const sky = container.querySelector('[aria-hidden="true"][data-focus]');
    return sky?.getAttribute('data-focus') ?? null;
  }

  function report(focus: string, isIntersecting: boolean): void {
    const instance = focusObserver();
    act(() => {
      instance.callback(
        [
          {
            target: chapter(focus),
            isIntersecting,
            intersectionRatio: isIntersecting ? 0.2 : 0,
          },
        ] as unknown as IntersectionObserverEntry[],
        instance as unknown as IntersectionObserver,
      );
    });
  }

  const enter = (focus: string): void => report(focus, true);
  const leave = (focus: string): void => report(focus, false);

  it('observes the hero, both chapters and the steps block nested in the programs chapter, starting on the hero focus', () => {
    expect(focusObserver().observe).toHaveBeenCalledTimes(4);
    expect(focusObserver().observe).toHaveBeenCalledWith(chapter('hero'));
    expect(focusObserver().observe).toHaveBeenCalledWith(chapter('flow'));
    expect(focusObserver().observe).toHaveBeenCalledWith(chapter('activity'));
    expect(chapter('programs').contains(chapter('flow'))).toBe(true);
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

  it('returns the graph focus to the programs chapter when the steps block leaves the band', () => {
    enter('programs');
    enter('flow');
    expect(skyFocus()).toBe('flow');

    leave('flow');

    expect(skyFocus()).toBe('programs');
  });

  it('disconnects the focus observer on unmount', () => {
    const instance = focusObserver();

    act(() => root.render(<p>본문</p>));

    expect(instance.disconnect).toHaveBeenCalledTimes(1);
  });

  it('creates the canvas without an entrance when visibility arrives late', () => {
    vi.spyOn(performance, 'now').mockReturnValue(1300);
    const createRenderer = vi
      .spyOn(cosmos, 'createCosmosRenderer')
      .mockReturnValue({
        render: vi.fn(),
        pick: () => null,
        dispose: vi.fn(),
      });
    const visibility = FakeIntersectionObserver.instances.find(
      (observer) => observer.options === undefined,
    );
    const sky = container.querySelector('[aria-hidden="true"][data-focus]');
    if (!visibility || !sky)
      throw new Error('Sky visibility observer is required');
    expect(createRenderer).not.toHaveBeenCalled();

    act(() => {
      visibility.callback(
        [
          {
            target: sky,
            isIntersecting: true,
            intersectionRatio: 1,
            boundingClientRect: new DOMRect(),
            intersectionRect: new DOMRect(),
            rootBounds: null,
            time: 1300,
          },
        ],
        new IntersectionObserver(() => undefined),
      );
      const callback = vi.mocked(requestAnimationFrame).mock.calls.at(-1)?.[0];
      callback?.(1300);
    });

    expect(createRenderer).toHaveBeenCalledWith(
      expect.objectContaining({ entranceMs: 0 }),
    );
  });
});
