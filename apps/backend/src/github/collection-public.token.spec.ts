import { loadRuntimeConfig } from '../runtime-config/runtime-config';
import { CollectionAppConfigError } from './collection-app.config';
import { CollectionPublicTokenProvider } from './collection-public.token';

describe('CollectionPublicTokenProvider', () => {
  it('getToken()이 PAT 원문 문자열을 그대로 반환한다', async () => {
    const runtimeConfig = loadRuntimeConfig({
      GITHUB_PUBLIC_READ_TOKEN: 'test-public-read-token',
    });
    const provider = new CollectionPublicTokenProvider(runtimeConfig);

    const token = await provider.getToken();

    expect(token).toBe('test-public-read-token');
  });

  it('두 번째 getToken() 호출도 같은 값을 반환한다(정적 자격증명이라 재계산하지 않아도 동일)', async () => {
    const runtimeConfig = loadRuntimeConfig({
      GITHUB_PUBLIC_READ_TOKEN: 'test-public-read-token',
    });
    const provider = new CollectionPublicTokenProvider(runtimeConfig);

    const first = await provider.getToken();
    const second = await provider.getToken();

    expect(second).toBe(first);
  });

  it('clear()는 호출해도 안전한 no-op이며 이후 getToken()에 영향을 주지 않는다', async () => {
    const runtimeConfig = loadRuntimeConfig({
      GITHUB_PUBLIC_READ_TOKEN: 'test-public-read-token',
    });
    const provider = new CollectionPublicTokenProvider(runtimeConfig);
    const before = await provider.getToken();

    provider.clear();
    const after = await provider.getToken();

    expect(after).toBe(before);
  });

  it('GITHUB_PUBLIC_READ_TOKEN이 없으면 getToken()이 fail-closed로 던진다', async () => {
    const runtimeConfig = loadRuntimeConfig({});
    const provider = new CollectionPublicTokenProvider(runtimeConfig);

    await expect(provider.getToken()).rejects.toThrow(CollectionAppConfigError);
  });

  it('생성자는 자격증명이 없어도 던지지 않는다 — 실패는 getToken() 호출 시점에만 일어난다', () => {
    const runtimeConfig = loadRuntimeConfig({});
    expect(
      () => new CollectionPublicTokenProvider(runtimeConfig),
    ).not.toThrow();
  });
});
