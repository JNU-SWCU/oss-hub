// @vitest-environment happy-dom

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
    await act(async () => root.render(<Probe selected={selected} />));
  }

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('늦게 온 판정은 새로 고른 파일에 붙지 않는다', async () => {
    // Given: 첫 파일의 판정이 돌아오기 전에 다른 파일을 골랐다.
    const first = new File(['PK'], 'first.zip');
    const second = new File(['PK'], 'second.zip');
    const firstVerdict = deferred();
    const secondVerdict = deferred();
    await render(first);
    await act(async () => latest.start(first, () => firstVerdict.promise));
    await render(second);
    await act(async () => latest.start(second, () => secondVerdict.promise));

    // When: 첫 파일의 거절이 늦게 도착한다.
    await act(async () => firstVerdict.resolve('첫 파일 거절'));

    // Then: 지금 파일은 여전히 판정을 기다린다.
    expect(latest).toMatchObject({ checking: true, message: null });

    // When: 지금 파일의 판정이 통과로 돌아온다.
    await act(async () => secondVerdict.resolve(null));

    // Then
    expect(latest).toMatchObject({ checking: false, message: null });
  });

  it('판정이 던지면 아무 말도 붙이지 않고 대기를 끝낸다', async () => {
    // Given
    const file = new File(['PK'], 'bundle.zip');
    await render(file);

    // When: 판정 요청 자체가 실패한다(세션 만료·네트워크).
    await act(async () =>
      latest.start(file, () => Promise.reject(new TypeError('network'))),
    );

    // Then
    expect(latest).toMatchObject({ checking: false, message: null });
  });
});
