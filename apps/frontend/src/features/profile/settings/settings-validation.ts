import type { ProfileMemberKind } from '../profile-requirements';
import { validateSettingsForm } from './settings-state';
import type { SettingsFormErrors, SettingsFormValues } from './types';

export function settingsFormErrors(
  values: SettingsFormValues | null,
  notificationReady: boolean,
  memberKind: ProfileMemberKind | null,
): SettingsFormErrors {
  return values
    ? validateSettingsForm(values, notificationReady, memberKind)
    : {
        name: null,
        studentId: null,
        department: null,
        notificationEmail: null,
      };
}
