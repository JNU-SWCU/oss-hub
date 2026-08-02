'use client';

import { useSession } from '@/features/auth/use-session';
import { SettingsScreen } from '@/features/profile/settings/components/settings-screen';
import type { ProfileRole } from '@/features/profile/profile-requirements';

/**
 * 세션 역할을 설정 화면으로 넘기는 얇은 경계.
 *
 * `features/profile`은 `features/auth`에 직접 의존할 수 없으므로(feature 경계 lint)
 * 세션을 아는 app 계층이 역할을 읽어 props로 넘긴다. 역할에 따라 학번·학과 입력란의
 * 표시 여부와 필수 여부가 달라진다.
 */
export function SettingsRoute() {
  const session = useSession();
  const role: ProfileRole | null =
    session.status === 'authenticated' ? (session.user?.role ?? null) : null;

  return <SettingsScreen role={role} />;
}
