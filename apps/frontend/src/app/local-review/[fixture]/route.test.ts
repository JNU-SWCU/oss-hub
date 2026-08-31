import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

function activate(
  fixture: string,
  host: string,
  target = '/dashboard/audit-logs',
) {
  // NextRequest의 절대 URL은 dev 서버가 정규화한 주소를 흉내 낸다 — 진입 host는 Host
  // 헤더에만 남아 있고, 이 둘이 갈라지는 상황이 바로 cookie 유실을 만들던 조건이다.
  const request = new NextRequest(
    `http://localhost:3000/local-review/${fixture}?to=${target}`,
    { headers: { host } },
  );
  return GET(request, { params: Promise.resolve({ fixture }) });
}

function fixtureCookie(response: Response): string | undefined {
  return response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith('oss_hub_local_review_fixture='));
}

describe('local review activation route', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('OSS_HUB_LOCAL_REVIEW_FIXTURES', '1');
    vi.stubEnv('BACKEND_ORIGIN', 'http://localhost:4000');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(['localhost:3000', '127.0.0.1:3000'])(
    '%s로 진입해도 redirect가 host를 바꾸지 않아 fixture cookie가 살아남는다',
    async (host) => {
      // Given / When
      const response = await activate('admin', host);

      // Then — 절대 URL이면 host가 바뀌어 host-only cookie가 유실된다.
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('/dashboard/audit-logs');
      expect(fixtureCookie(response)).toContain(
        'oss_hub_local_review_fixture=admin',
      );
      expect(fixtureCookie(response)).not.toContain('Domain=');
    },
  );

  it('rewrite가 매치할 수 없는 host는 진입 자체를 막는다', async () => {
    // Given / When — IPv6 loopback과 원격 host 모두 지원 범위 밖이다.
    const ipv6 = await activate('admin', '[::1]:3000');
    const remote = await activate('admin', 'review.example.com');

    // Then
    expect(ipv6.status).toBe(404);
    expect(remote.status).toBe(404);
  });

  it('off로 진입하면 같은 host에서 fixture cookie를 지운다', async () => {
    // Given / When
    const response = await activate('off', '127.0.0.1:3000', '/');

    // Then
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/');
    expect(fixtureCookie(response)).toContain('oss_hub_local_review_fixture=;');
  });

  it('한글이 붙은 허용 경로도 Location 헤더에 안전하게 인코딩한다', async () => {
    const response = await activate(
      'staff',
      '127.0.0.1:3000',
      '/programs/new에서',
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      '/programs/new%EC%97%90%EC%84%9C',
    );
  });

  it('경로 정규화 뒤 프로토콜 상대 주소가 되는 대상은 루트로 돌린다', async () => {
    const response = await activate(
      'staff',
      '127.0.0.1:3000',
      '/programs/..//evil.example',
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/');
  });

  it('flag가 꺼져 있으면 loopback host라도 404다', async () => {
    // Given
    vi.stubEnv('OSS_HUB_LOCAL_REVIEW_FIXTURES', undefined);

    // When
    const response = await activate('admin', 'localhost:3000');

    // Then
    expect(response.status).toBe(404);
  });
});
