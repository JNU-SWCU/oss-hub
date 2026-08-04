'use client';

import { SettingsScreen } from '@/features/profile/settings/components/settings-screen';
import type { ProfileRole } from '@/features/profile/profile-requirements';
import { effectiveProfileRole } from '../_shell/onboarding-route';
import { SessionError } from '../_shell/session-error';
import { useSessionRole } from '../_shell/use-session-role';

/**
 * 세션 역할을 설정 화면으로 넘기는 얇은 경계.
 *
 * `features/profile`은 `features/auth`·`features/roles`에 직접 의존할 수 없으므로
 * (feature 경계 lint) 두 feature를 함께 쓰는 이 app 계층이 역할을 읽어 props로
 * 넘긴다. 역할에 따라 학번·학과 입력란의 표시 여부와 필수 여부가 달라진다.
 *
 * 배정된 역할만 보는 `useSession` 대신 역할 요청까지 아는 `useSessionRole`을 쓴다.
 * 설정이 승인 대기 교직원에게도 열린 뒤로(#581) 이 화면에는 세션의 `role`이 비어
 * 있는 사용자가 정상적으로 들어온다. 그를 역할 없음(=학생 기준)으로 읽으면 학번이
 * 필수가 되고, 학번 없이 가입한 교직원은 이름 한 글자를 고치려 해도 저장이 막힌다 —
 * 신고된 증상을 화면만 열어 두고 그대로 남기는 셈이다. 프로필 온보딩과 같은 근거
 * (`effectiveProfileRole`)로 읽어 백엔드 판정(`user-profile-policy.ts`)과 맞춘다.
 */
export function SettingsRoute() {
  const state = useSessionRole();

  // 무엇을 물을지 정해지기 전에는 폼을 그리지 않는다. 조회 중·실패를 그대로 흘리면
  // 세 근거가 모두 비어 있어 가장 엄격한 학생 기준으로 읽히고, 승인을 기다리는
  // 교직원에게 잠깐 학번 필수 폼이 떴다가 바뀐다.
  if (state.status === 'error') {
    return <SessionError onRetry={state.retry} />;
  }

  if (state.status === 'loading') {
    return (
      <p
        className="flex min-h-[50svh] items-center justify-center px-6 py-16 text-sm text-muted-foreground"
        role="status"
      >
        확인 중…
      </p>
    );
  }

  const role: ProfileRole | null = effectiveProfileRole(
    state.role,
    state.roleRequestStatus,
    state.selectedRole,
  );

  return <SettingsScreen role={role} />;
}
