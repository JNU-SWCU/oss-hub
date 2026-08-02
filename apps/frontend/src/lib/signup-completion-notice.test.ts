import { describe, expect, it } from 'vitest';

import {
  SIGNUP_COMPLETION_NOTICE_KEY,
  takeSignupCompletionNotice,
  writeSignupCompletionNotice,
  type NoticeStorage,
} from './signup-completion-notice';

/** 탭 하나의 sessionStorage를 대신한다 — 이 모듈이 쓰는 세 가지 동작만 있으면 된다. */
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
    // Given: 가입을 마치고 대시보드에 도착해 안내를 이미 본 상태
    const storage = fakeStorage();
    writeSignupCompletionNotice(storage, '/dashboard');
    takeSignupCompletionNotice(storage, '/dashboard');

    // When: 새로고침·뒤로가기·재방문으로 같은 화면을 다시 연다
    const second = takeSignupCompletionNotice(storage, '/dashboard');
    const third = takeSignupCompletionNotice(storage, '/dashboard');

    // Then
    expect(second).toBe(false);
    expect(third).toBe(false);
    expect(storage.entries.has(SIGNUP_COMPLETION_NOTICE_KEY)).toBe(false);
  });

  it('표시를 남긴 적이 없으면(재접속·새 탭·이미 가입한 사용자) 인정되지 않는다', () => {
    const storage = fakeStorage();

    expect(takeSignupCompletionNotice(storage, '/dashboard')).toBe(false);
  });

  it('승인 대기로 간 교직원의 표시는 대시보드에서 인정되지 않고 그대로 버려진다', () => {
    // Given: 프로필은 마쳤지만 목적지가 승인 대기 화면이었던 사용자
    const storage = fakeStorage();
    writeSignupCompletionNotice(storage, '/onboarding/pending');

    // When: 같은 탭에서 나중에 대시보드가 열린다
    const shown = takeSignupCompletionNotice(storage, '/dashboard');

    // Then: 뜨지 않고, 표시도 남지 않아 이후에 되살아날 수 없다
    expect(shown).toBe(false);
    expect(storage.entries.has(SIGNUP_COMPLETION_NOTICE_KEY)).toBe(false);
  });
});
