const SAFE_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export function isSafePathSegment(value: string): boolean {
  return value !== '.' && value !== '..' && SAFE_PATH_SEGMENT.test(value);
}
