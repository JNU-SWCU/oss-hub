import { describe, expect, it } from 'vitest';
import {
  isSignupComplete,
  shouldShowAccountSlot,
  type SignupCompletionState,
} from './signup-completion';
import { SIGNUP_FLOW_PATHS } from './signup-routes';

const OUTSIDE = '/programs';

const INSIDE = '/consent';

function state(
  overrides: Partial<SignupCompletionState> = {},
): SignupCompletionState {
  return {
    status: 'unassigned',
    staffAccessRequestStatus: null,
    isProfileComplete: false,
    ...overrides,
  };
}

describe('isSignupComplete', () => {
  it('승인 대기 교직원은 역할이 없어도 회원이다', () => {
    expect(
      isSignupComplete(
        state({ status: 'unassigned', staffAccessRequestStatus: 'PENDING' }),
      ),
    ).toBe(true);
  });

  it('승인 대기 교직원은 가입 화면 밖에서도 계정 표식을 유지한다', () => {
    expect(
      shouldShowAccountSlot(
        state({ status: 'unassigned', staffAccessRequestStatus: 'PENDING' }),
        OUTSIDE,
      ),
    ).toBe(true);
  });

  it('승인된 요청을 든 미배정 사용자도 회원으로 본다', () => {
    expect(
      isSignupComplete(
        state({ status: 'unassigned', staffAccessRequestStatus: 'APPROVED' }),
      ),
    ).toBe(true);
  });

  it('로그인·약관 동의만 한 사람은 회원이 아니다', () => {
    expect(isSignupComplete(state({ staffAccessRequestStatus: null }))).toBe(
      false,
    );
  });

  it.each(['REJECTED', 'REVOKED'] as const)(
    '%s 요청은 가입을 마친 것으로 보지 않는다',
    (staffAccessRequestStatus) => {
      expect(isSignupComplete(state({ staffAccessRequestStatus }))).toBe(false);
    },
  );

  it('역할만 배정되고 프로필이 비어 있으면 회원이 아니다', () => {
    expect(
      isSignupComplete(state({ status: 'assigned', isProfileComplete: false })),
    ).toBe(false);
  });

  it('역할과 프로필을 모두 마치면 회원이다', () => {
    expect(
      isSignupComplete(state({ status: 'assigned', isProfileComplete: true })),
    ).toBe(true);
  });

  it.each(['loading', 'error', 'anonymous'] as const)(
    '%s 상태는 회원으로 보지 않는다',
    (status) => {
      expect(isSignupComplete(state({ status }))).toBe(false);
    },
  );
});

describe('shouldShowAccountSlot', () => {
  it('가입을 마치지 않은 사람은 가입 화면 밖에서 계정 표식을 내지 않는다', () => {
    expect(shouldShowAccountSlot(state(), OUTSIDE)).toBe(false);
  });

  it('가입을 마치지 않은 사람도 가입 화면 안에서는 계정 표식을 본다', () => {
    expect(shouldShowAccountSlot(state(), INSIDE)).toBe(true);
  });

  it.each([...SIGNUP_FLOW_PATHS])(
    '가입 절차 화면 %s에서는 계정 표식을 낸다',
    (pathname) => {
      expect(shouldShowAccountSlot(state(), pathname)).toBe(true);
    },
  );

  it('프로필을 마치지 않은 배정 사용자도 가입 화면 밖에서는 표식을 잃는다', () => {
    expect(
      shouldShowAccountSlot(
        state({ status: 'assigned', isProfileComplete: false }),
        OUTSIDE,
      ),
    ).toBe(false);
  });

  it('가입을 마친 사용자는 어느 화면에서나 계정을 본다', () => {
    expect(
      shouldShowAccountSlot(
        state({ status: 'assigned', isProfileComplete: true }),
        OUTSIDE,
      ),
    ).toBe(true);
  });

  it('비로그인 방문자의 슬롯은 그대로 둔다', () => {
    expect(shouldShowAccountSlot(state({ status: 'anonymous' }), OUTSIDE)).toBe(
      true,
    );
  });

  it('랜딩은 가입 절차 화면이 아니다', () => {
    expect(shouldShowAccountSlot(state(), '/')).toBe(false);
  });
});
