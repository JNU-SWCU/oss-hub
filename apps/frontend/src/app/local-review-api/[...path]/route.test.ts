import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

// 목적지 경로를 글자로 박지 않는다. 이 테스트가 잠그는 것은 "어디로 보내는가"가
// 아니라 "**진입 host를 바꾸지 않는가**"다. 목적지는 온보딩 순서가 바뀔 때마다
// 달라지므로(브랜치에 따라 `/consent`이기도 `/onboarding/role`이기도 하다) 여기
// 적어 두면 정작 지켜야 할 계약과 무관한 이유로 깨진다.

function request(path: string, host: string, fixture = 'anonymous') {
  // NextRequest의 절대 URL은 dev 서버가 정규화한 주소를 흉내 낸다 — 진입 host는 Host
  // 헤더에만 남는다. 이 둘이 갈라지는 상황이 바로 Location이 origin을 갈아치우던 조건이다.
  const nextRequest = new NextRequest(
    `http://localhost:3000/local-review-api/${path}`,
    {
      headers: {
        host,
        cookie: `oss_hub_local_review_fixture=${fixture}`,
      },
    },
  );
  return GET(nextRequest, {
    params: Promise.resolve({ path: path.split('/') }),
  });
}

describe('local review fixture API route', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('OSS_HUB_LOCAL_REVIEW_FIXTURES', '1');
    vi.stubEnv('BACKEND_ORIGIN', 'http://localhost:4000');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('진입 host가 달라도 redirect Location이 똑같다', async () => {
    // Given / When — 로그인 링크는 fetch가 아니라 브라우저 전체 이동이라
    // 여기서 받은 Location이 곧 다음 요청의 origin이 된다.
    const [viaLocalhost, viaLoopback] = await Promise.all([
      request('auth/github', 'localhost:3000'),
      request('auth/github', '127.0.0.1:3000'),
    ]);

    // Then — 절대 URL로 답하면 127.0.0.1로 들어온 검토자가 localhost로 튕기고,
    // host-only인 픽스처 쿠키가 다음 요청에 실리지 않아 세션이 끊긴다.
    // 두 응답이 글자 그대로 같다는 것이 곧 "origin을 심지 않았다"는 뜻이다.
    expect(viaLocalhost.status).toBe(303);
    expect(viaLoopback.status).toBe(303);
    expect(viaLoopback.headers.get('location')).toBe(
      viaLocalhost.headers.get('location'),
    );
  });

  it('redirect Location은 절대 URL이 아니라 앱 내부 경로다', async () => {
    // Given / When
    const response = await request('auth/github', '127.0.0.1:3000');

    // Then — origin이 붙는 순간 진입 host가 무엇이었는지는 사라진다.
    const location = response.headers.get('location') ?? '';
    expect(location.startsWith('/')).toBe(true);
    expect(location).not.toMatch(/^https?:\/\//);
    expect(location).not.toContain('localhost');
  });

  it('redirect도 픽스처 응답의 헤더 규약을 그대로 지킨다', async () => {
    // Given / When — 직접 Response를 만들면서 이 헤더들이 빠지기 쉽다.
    const response = await request('auth/github', '127.0.0.1:3000');

    // Then
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-oss-hub-local-fixture')).toBe('anonymous');
  });
});
