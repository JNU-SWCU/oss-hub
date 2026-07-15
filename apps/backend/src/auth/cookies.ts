/** 의존성 없이 필요한 만큼만 구현한 쿠키 유틸 — auth 모듈 전용. */

export function parseCookies(
  header: string | undefined,
): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) {
    return cookies;
  }
  for (const part of header.split(';')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex < 0) {
      continue;
    }
    const name = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (name && !(name in cookies)) {
      // 중복 쿠키는 첫 값만 사용 (브라우저가 더 구체적인 쿠키를 앞에 보낸다)
      cookies[name] = value;
    }
  }
  return cookies;
}

export interface CookieAttributes {
  maxAgeSeconds: number;
  secure: boolean;
}

/**
 * 세션·flow 쿠키 직렬화. Domain은 절대 설정하지 않는다(host-only).
 * 운영(secure)에서는 __Host- 접두사 요건(Secure + Path=/ + Domain 없음)을 그대로 충족한다.
 */
export function serializeCookie(
  name: string,
  value: string,
  attributes: CookieAttributes,
): string {
  const parts = [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${attributes.maxAgeSeconds}`,
  ];
  if (attributes.secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function flowCookieName(secure: boolean): string {
  // __Host-는 HTTPS 전용이라 개발 HTTP에서는 별도 이름을 쓴다.
  return secure ? '__Host-oss_oauth_flow' : 'oss_oauth_flow_dev';
}

export function sessionCookieName(secure: boolean): string {
  return secure ? '__Host-oss_session' : 'oss_session_dev';
}
