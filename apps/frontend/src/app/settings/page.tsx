'use client';

import { RoleGate } from '../_shell/role-gate';
import {
  isSettingsOpenForStaffAwaitingRole,
  SETTINGS_ALLOWED_SURFACES,
} from './settings-access';
import { SettingsOnboardingNotice } from './settings-onboarding-notice';
import { SettingsRoute } from './settings-route';

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
