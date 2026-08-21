'use client';

import { RoleGate } from '../_shell/role-gate';
import {
  isSettingsOpenForStaffAwaitingRole,
  SETTINGS_ALLOWED_SURFACES,
} from './settings-access';
import { SettingsOnboardingNotice } from './settings-onboarding-notice';
import { SettingsRoute } from './settings-route';

// #156 공통 설정 — 프로필·알림 수신 설정을 수정한다.
//
// 역할이 도착하기를 기다리는 교직원에게만 역할 없이도 연다(#581). 그들에게 되돌아갈
// 곳을 알려 주려던 `unassignedNotice`가 실제로는 되돌리는 처리에 가려 읽히지도 않았고,
// 오타 난 이름 하나를 고칠 방법이 없었다. 이제 안내는 화면 위에 남고 폼은 그대로 쓸 수
// 있다 — 역할이 필요한 것은 업무 화면이지 자기 프로필이 아니다.
//
// 누구에게 열지는 `isSettingsOpenForStaffAwaitingRole`이 정하고, 안내는 그 판단이 끝난
// 뒤 얹히는 표시다. 둘을 한 prop에 묶었다가 "안내를 준 화면"이 곧 "모든 미배정 사용자에게
// 열린 화면"이 됐던 것이 이 화면의 직전 결함이다.
//
// 클라이언트 컴포넌트인 이유는 규칙을 함수로 넘기기 때문이다 — 서버 컴포넌트는
// 클라이언트 컴포넌트에 함수 prop을 넘길 수 없다.
export default function SettingsPage() {
  return (
    <RoleGate
      allow={SETTINGS_ALLOWED_SURFACES}
      unassignedAccess={isSettingsOpenForStaffAwaitingRole}
      unassignedNotice={<SettingsOnboardingNotice />}
    >
      <SettingsRoute />
    </RoleGate>
  );
}
