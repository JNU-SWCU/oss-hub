import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRevealOnce } from './components/landing-reveal';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

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

function Stories() {
  const reveal = useRevealOnce();
  return (
    <>
      <section ref={reveal} id="first">
        첫 번째 이야기
      </section>
      <section ref={reveal} id="second">
        두 번째 이야기
      </section>
    </>
  );
}

describe('useRevealOnce', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    FakeIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function section(id: string): HTMLElement {
    const element = container.querySelector<HTMLElement>(`#${id}`);
    if (element === null) throw new Error(`#${id} 섹션을 찾지 못했습니다`);
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
    entries: readonly { target: Element; isIntersecting: boolean }[],
  ): void {
    const instance = observer();
    act(() => {
      instance.callback(
        entries as IntersectionObserverEntry[],
        instance as unknown as IntersectionObserver,
      );
    });
  }

  it('arms every registered section after mount and observes it at threshold 0.15', () => {
    act(() => root.render(<Stories />));

    expect(section('first').getAttribute('data-reveal')).toBe('armed');
    expect(section('second').getAttribute('data-reveal')).toBe('armed');
    expect(FakeIntersectionObserver.instances).toHaveLength(1);
    expect(observer().options).toEqual({ threshold: 0.15 });
    expect(observer().observe).toHaveBeenCalledTimes(2);
    expect(observer().observe).toHaveBeenCalledWith(section('first'));
    expect(observer().observe).toHaveBeenCalledWith(section('second'));
  });

  it('shows a section once the observer reports it intersecting and stops observing it', () => {
    act(() => root.render(<Stories />));

    report([{ target: section('first'), isIntersecting: true }]);

    expect(section('first').getAttribute('data-reveal')).toBe('shown');
    expect(section('second').getAttribute('data-reveal')).toBe('armed');
    expect(observer().unobserve).toHaveBeenCalledTimes(1);
    expect(observer().unobserve).toHaveBeenCalledWith(section('first'));
  });

  it('keeps a section armed while the observer reports it outside the viewport', () => {
    act(() => root.render(<Stories />));

    report([{ target: section('second'), isIntersecting: false }]);

    expect(section('second').getAttribute('data-reveal')).toBe('armed');
    expect(observer().unobserve).not.toHaveBeenCalled();
  });

  it('disconnects the observer when the sections unmount', () => {
    act(() => root.render(<Stories />));
    const instance = observer();

    act(() => root.render(<p>본문</p>));

    expect(instance.disconnect).toHaveBeenCalledTimes(1);
  });
});
