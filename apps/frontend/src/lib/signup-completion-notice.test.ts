import { describe, expect, it } from 'vitest';

import {
  SIGNUP_COMPLETION_NOTICE_KEY,
  takeSignupCompletionNotice,
  writeSignupCompletionNotice,
  type NoticeStorage,
} from './signup-completion-notice';

function fakeStorage(initial: Record<string, string> = {}): NoticeStorage & {
  readonly entries: Map<string, string>;
} {
  const entries = new Map(Object.entries(initial));
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    },
  };
}

describe('가입 완료 안내 표시', () => {
  it('가입을 마치고 도착한 첫 화면에서 한 번 인정된다', () => {
    const storage = fakeStorage();

    writeSignupCompletionNotice(storage, '/dashboard');

    expect(takeSignupCompletionNotice(storage, '/dashboard')).toBe(true);
  });

  it('두 번째 방문에는 인정되지 않는다 — 읽는 즉시 표시를 지우기 때문이다', () => {
    const storage = fakeStorage();
    writeSignupCompletionNotice(storage, '/dashboard');
    takeSignupCompletionNotice(storage, '/dashboard');

    const second = takeSignupCompletionNotice(storage, '/dashboard');
    const third = takeSignupCompletionNotice(storage, '/dashboard');

    expect(second).toBe(false);
    expect(third).toBe(false);
    expect(storage.entries.has(SIGNUP_COMPLETION_NOTICE_KEY)).toBe(false);
  });

  it('표시를 남긴 적이 없으면(재접속·새 탭·이미 가입한 사용자) 인정되지 않는다', () => {
    const storage = fakeStorage();

    expect(takeSignupCompletionNotice(storage, '/dashboard')).toBe(false);
  });

  it('승인 대기로 간 교직원의 표시는 대시보드에서 인정되지 않고 그대로 버려진다', () => {
    const storage = fakeStorage();
    writeSignupCompletionNotice(storage, '/onboarding/pending');

    const shown = takeSignupCompletionNotice(storage, '/dashboard');

    expect(shown).toBe(false);
    expect(storage.entries.has(SIGNUP_COMPLETION_NOTICE_KEY)).toBe(false);
  });
});
