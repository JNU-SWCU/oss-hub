import { describe, expect, it } from 'vitest';
import {
  isSignupComplete,
  shouldShowAccountSlot,
  type SignupCompletionState,
} from './signup-completion';
import { SIGNUP_FLOW_PATHS } from './signup-routes';

/** 가입 화면 밖 — 회원처럼 보이면 안 되는 자리의 대표. */
const OUTSIDE = '/programs';
/** 가입 절차 안 — 표식이 "진행 중"이라는 뜻으로 읽히는 자리. */
const INSIDE = '/consent';

function state(
  overrides: Partial<SignupCompletionState> = {},
): SignupCompletionState {
  return {
    status: 'unassigned',
    roleRequestStatus: null,
    isProfileComplete: false,
    ...overrides,
  };
}

describe('isSignupComplete', () => {
  // 이 검사가 이 파일에서 가장 중요하다. 교직원은 프로필까지 마쳐도 관리자가
  // 승인하기 전에는 세션 역할이 비어 있다(`unassigned` + `PENDING`). 그를 "가입
  // 미완료"로 묶으면, 승인을 기다리는 동안 제품 안에서 회원이 아닌 사람이 된다.
  it('승인 대기 교직원은 역할이 없어도 회원이다', () => {
    expect(
      isSignupComplete(
        state({ status: 'unassigned', roleRequestStatus: 'PENDING' }),
      ),
    ).toBe(true);
  });

  // 같은 사람이 가입 화면 밖에 서 있어도 계정 표식을 잃지 않아야 한다.
  it('승인 대기 교직원은 가입 화면 밖에서도 계정 표식을 유지한다', () => {
    expect(
      shouldShowAccountSlot(
        state({ status: 'unassigned', roleRequestStatus: 'PENDING' }),
        OUTSIDE,
      ),
    ).toBe(true);
  });

  it('승인된 요청을 든 미배정 사용자도 회원으로 본다', () => {
    expect(
      isSignupComplete(
        state({ status: 'unassigned', roleRequestStatus: 'APPROVED' }),
      ),
    ).toBe(true);
  });

  // GitHub 로그인만 한 사람 / 약관까지만 동의한 사람. 세션 모양이 같다 —
  // 역할 요청이 없다.
  it('로그인·약관 동의만 한 사람은 회원이 아니다', () => {
    expect(isSignupComplete(state({ roleRequestStatus: null }))).toBe(false);
  });

  // 반려·회수는 살아 있는 요청이 아니다. 그 사람은 역할을 다시 고르러 간다.
  it.each(['REJECTED', 'REVOKED'] as const)(
    '%s 요청은 가입을 마친 것으로 보지 않는다',
    (roleRequestStatus) => {
      expect(isSignupComplete(state({ roleRequestStatus }))).toBe(false);
    },
  );

  // 학생은 역할을 고르는 즉시 배정되므로, 프로필 단계에서 창을 닫으면 역할만 있고
  // 프로필은 비어 있는 상태로 남는다. 가입은 아직 끝나지 않았다.
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

  // 모르는 동안 회원이라고 말하지 않는다 — 조회가 끝나기 전에 계정을 그렸다가
  // 지우면 화면이 깜빡이고, 그 깜빡임이 곧 "회원인가?"에 대한 두 번의 대답이 된다.
  it.each(['loading', 'error', 'anonymous'] as const)(
    '%s 상태는 회원으로 보지 않는다',
    (status) => {
      expect(isSignupComplete(state({ status }))).toBe(false);
    },
  );
});

describe('shouldShowAccountSlot', () => {
  // 이 개선의 본체. 가입을 마치지 않은 사람은 가입 화면 밖에서 회원처럼 보이지
  // 않는다.
  it('가입을 마치지 않은 사람은 가입 화면 밖에서 계정 표식을 내지 않는다', () => {
    expect(shouldShowAccountSlot(state(), OUTSIDE)).toBe(false);
  });

  // 같은 사람이라도 가입 화면 안에서는 표식이 "이 절차가 이어지고 있다"는 뜻이다.
  it('가입을 마치지 않은 사람도 가입 화면 안에서는 계정 표식을 본다', () => {
    expect(shouldShowAccountSlot(state(), INSIDE)).toBe(true);
  });

  it.each([...SIGNUP_FLOW_PATHS])(
    '가입 절차 화면 %s에서는 계정 표식을 낸다',
    (pathname) => {
      expect(shouldShowAccountSlot(state(), pathname)).toBe(true);
    },
  );

  // 역할만 고르고 프로필에서 멈춘 학생이 이 개선 전에는 계정 표식까지 달고 있었다.
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

  // 이 슬롯은 비로그인에게 로그인 버튼을 내는 자리이기도 하다. 여기서 접으면
  // 로그인할 곳이 제품에서 사라진다 — 계정 메뉴를 숨기려다 로그인을 숨기지 않는다.
  it('비로그인 방문자의 슬롯은 그대로 둔다', () => {
    expect(shouldShowAccountSlot(state({ status: 'anonymous' }), OUTSIDE)).toBe(
      true,
    );
  });

  // 랜딩은 가입 절차가 아니다 — "다른 화면으로 이동해도 계정이 보인다"의 그 화면.
  it('랜딩은 가입 절차 화면이 아니다', () => {
    expect(shouldShowAccountSlot(state(), '/')).toBe(false);
  });
});
