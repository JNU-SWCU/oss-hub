import { loadRuntimeConfig } from '../runtime-config/runtime-config';
import { CollectionAppConfigError } from './collection-app.config';
import { CollectionPublicTokenProvider } from './collection-public.token';

describe('CollectionPublicTokenProvider', () => {
  it('getToken()이 PAT 원문 문자열을 그대로 반환한다', async () => {
    // Given: 합성 PAT만 있는 런타임 설정.
    const runtimeConfig = loadRuntimeConfig({
      GITHUB_PUBLIC_READ_TOKEN: 'test-public-read-token',
    });
    const provider = new CollectionPublicTokenProvider(runtimeConfig);

    // When
    const token = await provider.getToken();

    // Then: Basic/base64 헤더로 조립하지 않고 원문 그대로 돌려준다 —
    // CollectionAppClient/CollectionDiscoveryClient의 `Bearer ${token}`
    // 하드코딩에 그대로 꽂힌다.
    expect(token).toBe('test-public-read-token');
  });

  it('두 번째 getToken() 호출도 같은 값을 반환한다(정적 자격증명이라 재계산하지 않아도 동일)', async () => {
    // Given
    const runtimeConfig = loadRuntimeConfig({
      GITHUB_PUBLIC_READ_TOKEN: 'test-public-read-token',
    });
    const provider = new CollectionPublicTokenProvider(runtimeConfig);

    // When
    const first = await provider.getToken();
    const second = await provider.getToken();

    // Then
    expect(second).toBe(first);
  });

  it('clear()는 호출해도 안전한 no-op이며 이후 getToken()에 영향을 주지 않는다', async () => {
    // Given
    const runtimeConfig = loadRuntimeConfig({
      GITHUB_PUBLIC_READ_TOKEN: 'test-public-read-token',
    });
    const provider = new CollectionPublicTokenProvider(runtimeConfig);
    const before = await provider.getToken();

    // When
    provider.clear();
    const after = await provider.getToken();

    // Then
    expect(after).toBe(before);
  });

  it('GITHUB_PUBLIC_READ_TOKEN이 없으면 getToken()이 fail-closed로 던진다', async () => {
    // Given: 외부 public 수집 자격증명이 설정되지 않은 런타임 설정.
    const runtimeConfig = loadRuntimeConfig({});
    const provider = new CollectionPublicTokenProvider(runtimeConfig);

    // When / Then
    await expect(provider.getToken()).rejects.toThrow(CollectionAppConfigError);
  });

  it('생성자는 자격증명이 없어도 던지지 않는다 — 실패는 getToken() 호출 시점에만 일어난다', () => {
    // Given / When / Then: 조직 collection이 이 키 없이도 모듈 부트스트랩에서
    // 계속 동작해야 하므로, construction 자체는 절대 실패하지 않는다.
    const runtimeConfig = loadRuntimeConfig({});
    expect(
      () => new CollectionPublicTokenProvider(runtimeConfig),
    ).not.toThrow();
  });
});
