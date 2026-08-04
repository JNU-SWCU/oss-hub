import { describe, expect, it } from 'vitest';
import {
  LOGOUT_COMPLETE_PATH,
  logoutCompletePath,
} from '@/features/auth/logout-notice';
import {
  COSMOS_GROUND_PATHS,
  PRE_MEMBER_PATHS,
  SIGNUP_FLOW_PATHS,
} from './signup-routes';

/**
 * 같은 "가입 화면"을 세 목록이 조금씩 다른 목적으로 들고 있다 — 셸 분기,
 * 어두운 바탕, 계정 표식. 새 가입 단계를 추가하면서 한 목록만 고치면 화면이
 * 서로 다른 판단을 하게 되고, 그 어긋남은 사용자에게 "여기서만 헤더가 이상하다"로
 * 나타난다. 목록끼리의 포함 관계를 못으로 박아 그 순간에 검사가 먼저 깨지게 한다.
 */
describe('가입 화면 목록의 포함 관계', () => {
  it('어두운 바탕 화면은 모두 가입 절차 화면이다', () => {
    for (const path of COSMOS_GROUND_PATHS) {
      expect(SIGNUP_FLOW_PATHS.has(path)).toBe(true);
    }
  });

  it('랜딩을 뺀 가입 전 화면은 모두 가입 절차 화면이다', () => {
    for (const path of PRE_MEMBER_PATHS) {
      if (path === '/') continue;
      expect(SIGNUP_FLOW_PATHS.has(path)).toBe(true);
    }
  });

  // 승인 대기 화면은 정의상 회원 경로에 가깝지만, 반려된 요청을 들고 그 화면에
  // 서는 사람은 회원이 아니라 계정 메뉴가 필요하다.
  it('승인 대기 화면은 계정 표식 목록에만 있다', () => {
    expect(SIGNUP_FLOW_PATHS.has('/onboarding/pending')).toBe(true);
    expect(PRE_MEMBER_PATHS.has('/onboarding/pending')).toBe(false);
  });

  // 랜딩은 누구에게나 열린 공개 화면이다. 여기까지 계정 표식을 열면 "가입 화면
  // 밖에서는 회원처럼 보이지 않게 한다"가 통째로 무너진다.
  it('랜딩은 가입 절차 화면이 아니다', () => {
    expect(SIGNUP_FLOW_PATHS.has('/')).toBe(false);
  });

  /**
   * 로그아웃 복귀 주소도 이 목록을 알아야 한다 — 방금 세션을 버린 사람을 약관 동의나
   * 역할 선택 화면에 되돌려 놓으면, 그는 자기가 어디까지 했는지 알 수 없는 절차
   * 한가운데 서게 된다.
   *
   * 그런데 그 판단은 `features/auth/logout-notice.ts`가 자기 목록으로 내린다. 의존
   * 방향이 app → features 단방향이라(docs/rules/frontend.md) 저쪽에서 이 목록을 읽을
   * 수 없기 때문이다. 두 목록을 함께 볼 수 있는 자리는 app 계층인 여기뿐이므로, 새 가입
   * 단계를 추가하고 저쪽을 잊는 순간 이 검사가 먼저 깨지게 한다.
   */
  it('가입 절차 화면은 로그아웃 복귀 주소가 되지 않는다', () => {
    for (const path of SIGNUP_FLOW_PATHS) {
      expect(logoutCompletePath(path)).toBe(LOGOUT_COMPLETE_PATH);
    }
  });
});
