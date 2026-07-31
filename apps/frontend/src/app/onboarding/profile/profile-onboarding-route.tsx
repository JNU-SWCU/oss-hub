'use client';

import { useSession } from '@/features/auth/use-session';
import { ProfileOnboardingScreen } from '@/features/profile/components/profile-onboarding-screen';
import type { ProfileRole } from '@/features/profile/profile-requirements';

/**
 * 세션 역할을 프로필 화면으로 넘기는 얇은 경계.
 *
 * `features/profile`은 `features/auth`에 직접 의존할 수 없으므로(feature 경계 lint)
 * 세션을 아는 app 계층이 역할을 읽어 props로 넘긴다. 역할 요청 상태까지 필요한
 * 게이트와 달리 여기서는 배정된 역할만 있으면 되므로 `useSessionRole` 대신
 * 공유 세션 저장소를 쓴다 — 추가 조회가 없다.
 *
 * 온보딩 순서상 이 화면에서는 대개 역할이 아직 없다(`null` → 학생 기준).
 */
export function ProfileOnboardingRoute() {
  const session = useSession();
  const role: ProfileRole | null =
    session.status === 'authenticated' ? (session.user?.role ?? null) : null;

  return <ProfileOnboardingScreen role={role} />;
}
