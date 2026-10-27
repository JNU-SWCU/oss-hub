import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CosmosFocus } from './cosmos';
import {
  FOCUS_ROOT_MARGIN,
  isCosmosFocus,
  observeChapterFocus,
} from './components/landing-focus';

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

function section(): HTMLElement {
  const element = document.createElement('section');
  document.body.append(element);
  return element;
}

function observer(): FakeIntersectionObserver {
  const instance = FakeIntersectionObserver.instances.at(-1);
  if (instance === undefined) {
    throw new Error('IntersectionObserver가 만들어지지 않았습니다');
  }
  return instance;
}

function report(
  entries: readonly {
    target: Element;
    isIntersecting: boolean;
    intersectionRatio?: number;
  }[],
): void {
  const instance = observer();
  instance.callback(
    entries.map((entry) => ({
      intersectionRatio: entry.isIntersecting ? 0.2 : 0,
      ...entry,
    })) as IntersectionObserverEntry[],
    instance as unknown as IntersectionObserver,
  );
}

describe('observeChapterFocus', () => {
  let hero: HTMLElement;
  let programs: HTMLElement;
  let flow: HTMLElement;
  let targets: Map<Element, CosmosFocus>;
  const onChange = vi.fn<(focus: CosmosFocus) => void>();

  beforeEach(() => {
    FakeIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    hero = section();
    programs = section();
    flow = section();
    targets = new Map<Element, CosmosFocus>([
      [hero, 'hero'],
      [programs, 'programs'],
      [flow, 'flow'],
    ]);
    onChange.mockClear();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('observes every chapter inside the centre band of the viewport', () => {
    observeChapterFocus(targets, onChange);

    expect(FakeIntersectionObserver.instances).toHaveLength(1);
    expect(observer().options).toEqual({
      rootMargin: FOCUS_ROOT_MARGIN,
      threshold: 0,
    });
    expect(observer().observe).toHaveBeenCalledTimes(3);
    expect(observer().observe).toHaveBeenCalledWith(flow);
  });

  it('switches the focus to the chapter that enters the band and ignores the one leaving it', () => {
    observeChapterFocus(targets, onChange);

    report([
      { target: hero, isIntersecting: false },
      { target: programs, isIntersecting: true },
    ]);
    expect(onChange).toHaveBeenLastCalledWith('programs');

    report([{ target: programs, isIntersecting: false }]);
    expect(onChange).toHaveBeenCalledTimes(1);

    report([{ target: flow, isIntersecting: true }]);
    expect(onChange).toHaveBeenLastCalledWith('flow');
  });

  it('prefers the chapter covering more of the band when several intersect at once', () => {
    observeChapterFocus(targets, onChange);

    report([
      { target: hero, isIntersecting: true, intersectionRatio: 0.4 },
      { target: programs, isIntersecting: true, intersectionRatio: 0.1 },
    ]);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('hero');
  });

  it('disconnects the observer when stopped', () => {
    const stop = observeChapterFocus(targets, onChange);

    stop();

    expect(observer().disconnect).toHaveBeenCalledTimes(1);
  });
});

describe('isCosmosFocus', () => {
  it('accepts only the four chapter focus modes', () => {
    expect(isCosmosFocus('hero')).toBe(true);
    expect(isCosmosFocus('activity')).toBe(true);
    expect(isCosmosFocus('stars')).toBe(false);
    expect(isCosmosFocus(undefined)).toBe(false);
  });
});
