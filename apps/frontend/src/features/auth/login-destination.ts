import { isInternalPath } from '@/lib/internal-path';
import { readSearchParam, type SearchParamsInput } from './auth-error';

const KEY = 'oss-hub-login-destination';
export const RETURN_TO_PARAM = 'returnTo';
const MAX_AGE_MS = 10 * 60 * 1000;
const EXCLUDED = [
  '/signup',
  '/logout',
  '/consent',
  '/onboarding',
  '/api',
  '/auth',
  '/account-deactivated',
] as const;

const PROBE_ORIGIN = 'https://internal.invalid';

function decodedSegments(path: string): string[] | null {
  try {
    return path.split('/').map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
}

function isUnsafeSegment(segment: string): boolean {
  return (
    segment === '.' ||
    segment === '..' ||
    /[/\\]/.test(segment) ||
    [...segment].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  );
}

export function loginDestination(value: unknown): string | null {
  if (!isInternalPath(value) || /[?#\s]/.test(value)) return null;
  if (new URL(value, PROBE_ORIGIN).pathname !== value) return null;
  const segments = decodedSegments(value);
  if (!segments || segments.some(isUnsafeSegment)) return null;
  const path = segments.join('/').toLowerCase();
  if (
    EXCLUDED.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
  )
    return null;
  return value;
}

export function readReturnTo(searchParams: SearchParamsInput): string | null {
  return loginDestination(readSearchParam(searchParams, RETURN_TO_PARAM));
}

export function getLoginDestinationStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function rememberLoginDestination(
  storage: Storage | null,
  value: unknown,
  now = Date.now(),
): void {
  if (value === null || value === undefined) return;
  const destination = loginDestination(value);
  try {
    if (destination)
      storage?.setItem(
        KEY,
        JSON.stringify({ destination, expiresAt: now + MAX_AGE_MS }),
      );
    else storage?.removeItem(KEY);
  } catch {}
}

export function clearLoginDestination(storage: Storage | null): void {
  try {
    storage?.removeItem(KEY);
  } catch {}
}

export function takeLoginDestination(
  storage: Storage | null,
  now = Date.now(),
): string | null {
  try {
    const raw = storage?.getItem(KEY);
    storage?.removeItem(KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (
      typeof value !== 'object' ||
      value === null ||
      !('expiresAt' in value) ||
      typeof value.expiresAt !== 'number' ||
      !Number.isFinite(value.expiresAt) ||
      value.expiresAt <= now ||
      value.expiresAt > now + MAX_AGE_MS ||
      !('destination' in value)
    )
      return null;
    return loginDestination(value.destination);
  } catch {
    return null;
  }
}
