import type { AuthUser } from './auth-user';

/**
 * 온보딩 입구. 이미 끝난 단계는 이 화면이 건너뛰고 다음 단계로 전달하므로
 * 중단 지점이 어디든 이 경로 하나로 재개할 수 있다.
 */
const ONBOARDING_ENTRY_PATH = '/consent';

/**
 * 로그인 성공 후 사용자를 보낼 경로를 정한다.
 *
 * `role`을 온보딩 완주 여부의 대리 지표로 쓴다 — 역할 선택이 온보딩의 마지막
 * 단계이므로, `role`이 비어 있으면 동의·프로필·역할 중 어딘가에서 중단된
 * 상태다. 각 단계의 완료 여부를 여기서 개별 조회하지 않는 이유는 auth가 consent
 * 모듈을 직접 참조하지 않기 위해서다(ADR-003 모듈 경계).
 *
 * 이전 구현은 `isNew`(이번 로그인에서 계정이 처음 만들어졌는가)로 갈랐다.
 * 그래서 첫 로그인에서 온보딩을 끝내지 못한 사용자는 **두 번째 로그인부터
 * 랜딩으로 떨어졌고**, 가입을 이어갈 경로가 화면에 드러나지 않았다. 실제로
 * 역할이 비어 있는 계정이 관측돼 이 결함을 확인했다.
 */
export function loginLandingUrl(
  frontendUrl: string,
  user: Pick<AuthUser, 'role'>,
): string {
  return user.role === null
    ? `${frontendUrl}${ONBOARDING_ENTRY_PATH}`
    : frontendUrl;
}
