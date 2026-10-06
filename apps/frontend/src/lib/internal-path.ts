const PROBE_ORIGIN = 'https://internal.invalid';

export function isInternalPath(value: unknown): value is string {
  if (typeof value !== 'string' || !value.startsWith('/')) {
    return false;
  }

  if (value.startsWith('//') || value.includes('\\')) {
    return false;
  }

  try {
    return new URL(value, PROBE_ORIGIN).origin === PROBE_ORIGIN;
  } catch {
    return false;
  }
}

export function toInternalPath(value: unknown, fallback: string): string {
  return isInternalPath(value) ? value : fallback;
}
