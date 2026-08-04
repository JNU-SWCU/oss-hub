import { RoleGate } from '../_shell/role-gate';
import { SETTINGS_ALLOWED_ROLES } from './settings-access';
import { SettingsOnboardingNotice } from './settings-onboarding-notice';
import { SettingsRoute } from './settings-route';

// #156 공통 설정 — 프로필·알림 수신 설정을 수정한다.
//
// 가입을 마치지 않은(역할이 배정되지 않은) 사용자도 연다(#581). 이들에게 되돌아갈
// 곳을 알려 주려던 `unassignedNotice`가 실제로는 되돌리는 처리에 가려 읽히지도 않았고,
// 승인을 기다리는 교직원은 오타 난 이름 하나를 고칠 방법이 없었다. 이제 안내는 화면
// 위에 남고 폼은 그대로 쓸 수 있다 — 역할이 필요한 것은 업무 화면이지 자기 프로필이
// 아니다.
export default function SettingsPage() {
  return (
    <RoleGate
      allow={SETTINGS_ALLOWED_ROLES}
      unassignedNotice={<SettingsOnboardingNotice />}
    >
      <SettingsRoute />
    </RoleGate>
  );
}
