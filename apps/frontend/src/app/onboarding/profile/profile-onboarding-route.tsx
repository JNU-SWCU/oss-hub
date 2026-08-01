'use client';

import { ProfileOnboardingScreen } from '@/features/profile/components/profile-onboarding-screen';
import {
  effectiveProfileRole,
  onboardingPathFor,
} from '../../_shell/onboarding-route';
import { roleHomePath } from '../../_shell/role';
import { useSessionRole } from '../../_shell/use-session-role';

/**
 * 세션 역할을 프로필 화면으로 넘기는 얇은 경계.
 *
 * `features/profile`은 `features/auth`·`features/roles`에 직접 의존할 수 없으므로
 * (feature 경계 lint) 두 feature를 함께 쓰는 이 app 계층이 조합을 담당한다.
 *
 * 순서를 약관 → 역할 → 프로필로 바꾼 뒤로 이 화면에서는 역할이 이미 정해져 있다.
 * 다만 교직원은 승인 전까지 세션의 `role`이 비어 있으므로, 살아 있는 교직원 요청을
 * 역할로 인정해야 학번을 요구하지 않는다(`effectiveProfileRole`). 그래서 배정된
 * 역할만 보는 `useSession` 대신 역할 요청까지 아는 `useSessionRole`을 쓴다.
 *
 * 저장 뒤 목적지도 여기서 정한다 — 역할이 확정된 사용자는 자기 역할 홈으로, 승인을
 * 기다리는 교직원은 `onboardingPathFor`가 가리키는 승인 대기 화면으로 간다.
 */
export function ProfileOnboardingRoute() {
  const { role, roleRequestStatus } = useSessionRole();
  const profileRole = effectiveProfileRole(role, roleRequestStatus);
  const nextPath = role
    ? roleHomePath(role)
    : onboardingPathFor(roleRequestStatus);

  return <ProfileOnboardingScreen role={profileRole} nextPath={nextPath} />;
}
