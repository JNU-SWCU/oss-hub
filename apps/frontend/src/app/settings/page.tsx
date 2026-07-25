import { SettingsScreen } from '@/features/profile/settings/components/settings-screen';
import { AuthGate } from '../_shell/auth-gate';

// #156 공통 설정 — 로그인 사용자만 프로필·알림 수신 설정을 수정한다.
export default function SettingsPage() {
  return (
    <AuthGate>
      <SettingsScreen />
    </AuthGate>
  );
}
