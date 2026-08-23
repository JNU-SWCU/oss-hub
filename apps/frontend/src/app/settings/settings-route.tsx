'use client';

import { SettingsScreen } from '@/features/profile/settings/components/settings-screen';
import { useSharedSessionRole } from '../_shell/session-role-context';

/**
 * 세션 역할을 설정 화면으로 넘기는 얇은 경계.
 *
 * `features/profile`은 `features/auth`·`features/roles`에 직접 의존할 수 없으므로
 * (feature 경계 lint) 두 feature를 함께 쓰는 이 app 계층이 역할을 읽어 props로
 * 넘긴다. 역할에 따라 학번·학과 입력란의 표시 여부와 필수 여부가 달라진다.
 *
 * 배정된 역할만 보는 `useSession` 대신 역할 요청까지 아는 세션 스냅샷을 쓴다. 설정이
 * 승인 대기 교직원에게도 열린 뒤로(#581) 이 화면에는 세션의 `role`이 비어 있는
 * 사용자가 정상적으로 들어온다. 그를 역할 없음(=학생 기준)으로 읽으면 학번이 필수가
 * 되고, 학번 없이 가입한 교직원은 이름 한 글자를 고치려 해도 저장이 막힌다 — 신고된
 * 증상을 화면만 열어 두고 그대로 남기는 셈이다. 프로필 온보딩과 같은 근거
 * (`effectiveProfileRole`)로 읽어 백엔드 판정(`user-profile-policy.ts`)과 맞춘다.
 *
 * 그 스냅샷을 `useSessionRole()`로 직접 조회하지 않고 게이트에게서 물려받는다
 * (`useSharedSessionRole`). 따로 부르면 역할 요청 조회가 한 번 더 나가고, 게이트가
 * "승인 대기 교직원"으로 보고 열어 준 화면이 그와 다른 순간의 답으로 폼을 그릴 수
 * 있다 — 접근을 정한 근거와 무엇을 물을지 정하는 근거는 같은 값이어야 한다.
 *
 * 조회 중·실패 분기가 여기 없는 것도 같은 이유다. 게이트가 그 두 상태에서는 자식을
 * 아예 그리지 않으므로(`확인 중…`·`SessionError`) 여기 도달하는 스냅샷은 언제나
 * 판정이 끝난 값이고, 컨텍스트가 없으면 훅이 던진다.
 */
export function SettingsRoute() {
  const state = useSharedSessionRole();

  const memberKind =
    state.memberKind ??
    state.selectedRole ??
    (state.staffAccessRequestStatus === 'PENDING' ||
    state.staffAccessRequestStatus === 'APPROVED'
      ? 'STAFF'
      : null);

  return (
    <SettingsScreen
      memberKind={memberKind}
      hasAdminAccess={state.hasAdminAccess}
    />
  );
}
