import type { ProfileRole } from '@/features/profile/profile-requirements';
import type { RoleRequestStatus } from '@/features/roles/types';

export type ProfileCheckStatus =
  'checking' | 'complete' | 'incomplete' | 'error';

type OnboardingPath =
  '/onboarding/profile' | '/onboarding/role' | '/onboarding/pending';

/**
 * 아직 역할이 확정되지 않은 사용자의 다음 온보딩 단계.
 *
 * 순서는 약관 동의 → **역할 선택** → 프로필 입력이다. 프로필을 먼저 받던 예전
 * 순서에서는 그 화면이 역할을 몰라 학생 기준(가장 엄격)으로 되돌아갔고, 학번이 필요
 * 없는 교직원·관리자가 가짜 학번을 지어내야 다음으로 넘어갈 수 있었다.
 *
 * 그래서 판단 순서도 뒤집었다.
 *
 * 1. 아직 아무것도 고르지 않았거나(요청 없음) 회수됐으면 → 역할 선택.
 * 2. 반려됐으면 → 승인 대기 화면. 반려 사유를 읽고 다시 고르는 자리다. 여기서
 *    프로필로 보내면 어느 역할 기준으로 물어야 할지 알 수 없다 — 교직원이 아니게
 *    됐지만 학생을 고른 것도 아니기 때문이다.
 * 3. 역할을 골랐는데(승인 대기·승인) 프로필이 비어 있으면 → 프로필 입력.
 * 4. 둘 다 끝났으면 → 승인 대기 화면.
 *
 * 모든 상태에 눈에 보이는 다음 단계가 하나씩 있다 — 역할만 고르고 멈춘 교직원은
 * 프로필로, 프로필까지 마친 교직원은 승인 대기로 간다.
 */
export function onboardingPathFor(
  requestStatus: RoleRequestStatus | null,
): '/onboarding/role' | '/onboarding/pending';
export function onboardingPathFor(
  requestStatus: RoleRequestStatus | null,
  profileStatus: ProfileCheckStatus,
): OnboardingPath | null;
export function onboardingPathFor(
  requestStatus: RoleRequestStatus | null,
  profileStatus: ProfileCheckStatus = 'complete',
): OnboardingPath | null {
  switch (requestStatus) {
    case null:
    case 'REVOKED':
      return '/onboarding/role';
    case 'REJECTED':
      return '/onboarding/pending';
    case 'PENDING':
    case 'APPROVED':
      break;
  }

  switch (profileStatus) {
    case 'checking':
    case 'error':
      return null;
    case 'incomplete':
      return '/onboarding/profile';
    case 'complete':
      return '/onboarding/pending';
  }
}

/**
 * 프로필 화면이 필수 항목을 판정할 때 쓸 역할.
 *
 * 세 근거를 이 순서로 본다 — 백엔드 `users/user-profile-policy.ts`의
 * `effectiveProfileRole`과 같은 규칙이다. 한쪽만 바꾸면 화면이 묻지 않은 항목을
 * 저장이 요구하거나 그 반대가 된다.
 *
 * 1. **배정된 역할** — 확정된 사실이라 언제나 답이다.
 * 2. **살아 있는 교직원 요청** — 교직원은 관리자가 승인해야 세션의 `role`에 STAFF가
 *    붙는다. 그전까지 학생 기준으로 되돌리면, 승인을 기다리는 동안 프로필을 고치는
 *    바로 그 사람이 학번을 요구받는다. 반려·회수는 인정하지 않는다 — 그 사용자는
 *    역할을 다시 고르는 자리로 돌아간다.
 * 3. **고른 역할** — 확정을 `가입 마치기`로 미룬 뒤 생긴 구간이다(#569). 프로필을
 *    처음 채우는 동안에는 1도 2도 없고, 이것이 유일한 근거다.
 */
export function effectiveProfileRole(
  role: ProfileRole | null,
  requestStatus: RoleRequestStatus | null,
  selectedRole: ProfileRole | null = null,
): ProfileRole | null {
  if (role !== null) {
    return role;
  }
  if (requestStatus === 'PENDING' || requestStatus === 'APPROVED') {
    return 'STAFF';
  }
  return selectedRole;
}
