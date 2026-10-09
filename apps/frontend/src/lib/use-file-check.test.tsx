import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useFileCheck } from './use-file-check';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

function deferred() {
  let resolve: (message: string | null) => void = () => undefined;
  const promise = new Promise<string | null>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe('useFileCheck', () => {
  let container: HTMLDivElement;
  let root: Root;
  let latest: ReturnType<typeof useFileCheck>;

  function Probe({ selected }: { readonly selected: File | null }) {
    latest = useFileCheck(selected);
    return null;
  }

  async function render(selected: File | null) {
    await act(() =>
      Promise.resolve(root.render(<Probe selected={selected} />)),
    );
  }

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(() => Promise.resolve(root.unmount()));
    container.remove();
  });

  it('늦게 온 판정은 새로 고른 파일에 붙지 않는다', async () => {
    const first = new File(['PK'], 'first.zip');
    const second = new File(['PK'], 'second.zip');
    const firstVerdict = deferred();
    const secondVerdict = deferred();
    await render(first);
    await act(() =>
      Promise.resolve(latest.start(first, () => firstVerdict.promise)),
    );
    await render(second);
    await act(() =>
      Promise.resolve(latest.start(second, () => secondVerdict.promise)),
    );

    await act(() => Promise.resolve(firstVerdict.resolve('첫 파일 거절')));

    expect(latest).toMatchObject({ checking: true, message: null });

    await act(() => Promise.resolve(secondVerdict.resolve(null)));

    expect(latest).toMatchObject({ checking: false, message: null });
  });

  it('판정이 던지면 아무 말도 붙이지 않고 대기를 끝낸다', async () => {
    const file = new File(['PK'], 'bundle.zip');
    await render(file);

    await act(() =>
      Promise.resolve(
        latest.start(file, () => Promise.reject(new TypeError('network'))),
      ),
    );

    expect(latest).toMatchObject({ checking: false, message: null });
  });
});
