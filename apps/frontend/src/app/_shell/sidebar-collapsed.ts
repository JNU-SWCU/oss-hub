export const SIDEBAR_STORAGE_KEY = 'oss-hub-sidebar';
export const SIDEBAR_COLLAPSED_VALUE = 'shut';
export const SIDEBAR_OPEN_VALUE = 'open';

export function readStoredCollapsed(raw: string | null): boolean {
  return raw === SIDEBAR_COLLAPSED_VALUE;
}
