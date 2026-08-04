/** 사이드바 접힘 상태 쿠키/저장 키. 서버 layout · 클라이언트 shell 이 공유. */
export const SIDEBAR_STORAGE_KEY = 'oss-hub-sidebar';
export const SIDEBAR_COLLAPSED_VALUE = 'shut';
export const SIDEBAR_OPEN_VALUE = 'open';

export function readStoredCollapsed(raw: string | null): boolean {
  return raw === SIDEBAR_COLLAPSED_VALUE;
}
