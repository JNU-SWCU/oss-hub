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
      cookies[name] = value;
    }
  }
  return cookies;
}

export interface CookieAttributes {
  maxAgeSeconds: number;
  secure: boolean;
}

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

export function serializeClearedSessionCookie(secure: boolean): string {
  return serializeCookie(sessionCookieName(secure), '', {
    maxAgeSeconds: 0,
    secure,
  });
}

export function flowCookieName(secure: boolean): string {
  return secure ? '__Host-oss_oauth_flow' : 'oss_oauth_flow_dev';
}

export function sessionCookieName(secure: boolean): string {
  return secure ? '__Host-oss_session' : 'oss_session_dev';
}
