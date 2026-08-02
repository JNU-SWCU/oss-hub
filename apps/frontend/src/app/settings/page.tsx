import { RoleGate } from '../_shell/role-gate';
import { SETTINGS_ALLOWED_ROLES } from './settings-access';
import { SettingsOnboardingNotice } from './settings-onboarding-notice';
import { SettingsRoute } from './settings-route';

// #156 공통 설정 — 가입을 마친(역할이 배정된) 사용자만 프로필·알림 수신 설정을
// 수정한다. 미배정 사용자는 대시보드와 같은 규칙으로 온보딩으로 되돌린다.
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
