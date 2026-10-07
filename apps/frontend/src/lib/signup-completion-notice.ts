export const SIGNUP_COMPLETION_NOTICE_KEY = 'oss-hub-signup-completed';

export interface NoticeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function writeSignupCompletionNotice(
  storage: NoticeStorage,
  destination: string,
): void {
  storage.setItem(SIGNUP_COMPLETION_NOTICE_KEY, destination);
}

export function takeSignupCompletionNotice(
  storage: NoticeStorage,
  currentPath: string,
): boolean {
  const destination = storage.getItem(SIGNUP_COMPLETION_NOTICE_KEY);
  storage.removeItem(SIGNUP_COMPLETION_NOTICE_KEY);
  return destination !== null && destination === currentPath;
}

function browserNoticeStorage(): NoticeStorage | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function rememberSignupCompletion(destination: string): void {
  const storage = browserNoticeStorage();
  if (!storage) return;
  try {
    writeSignupCompletionNotice(storage, destination);
  } catch {}
}

export function consumeSignupCompletionNotice(): boolean {
  const storage = browserNoticeStorage();
  if (!storage) return false;
  try {
    return takeSignupCompletionNotice(storage, window.location.pathname);
  } catch {
    return false;
  }
}
