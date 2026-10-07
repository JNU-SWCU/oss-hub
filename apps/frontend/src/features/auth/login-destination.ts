import { isInternalPath } from '@/lib/internal-path';

const KEY = 'oss-hub-login-destination';
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

export function loginDestination(value: unknown): string | null {
  if (!isInternalPath(value) || /[?#\s%]/.test(value)) return null;
  if (
    [...value].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    return null;
  if (value.split('/').some((segment) => segment === '.' || segment === '..'))
    return null;
  const path = value.toLowerCase();
  if (
    EXCLUDED.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
  )
    return null;
  return value;
}

export function signupForDestination(value: unknown): string {
  const destination = loginDestination(value);
  return destination && destination !== '/'
    ? `/signup?${new URLSearchParams({ returnTo: destination })}`
    : '/signup';
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
