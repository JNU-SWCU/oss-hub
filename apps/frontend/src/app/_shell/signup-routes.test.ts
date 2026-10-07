import { describe, expect, it } from 'vitest';
import {
  COSMOS_GROUND_PATHS,
  PRE_MEMBER_PATHS,
  SIGNUP_FLOW_PATHS,
} from './signup-routes';

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

  it('승인 대기 화면은 계정 표식 목록에만 있다', () => {
    expect(SIGNUP_FLOW_PATHS.has('/onboarding/pending')).toBe(true);
    expect(PRE_MEMBER_PATHS.has('/onboarding/pending')).toBe(false);
  });

  it('랜딩은 가입 절차 화면이 아니다', () => {
    expect(SIGNUP_FLOW_PATHS.has('/')).toBe(false);
  });

  it('로그아웃 주소는 가입 절차에 포함하지 않는다', () => {
    expect(SIGNUP_FLOW_PATHS.has('/logout')).toBe(false);
    expect(COSMOS_GROUND_PATHS.has('/logout')).toBe(false);
    expect(PRE_MEMBER_PATHS.has('/logout')).toBe(false);
  });
});
