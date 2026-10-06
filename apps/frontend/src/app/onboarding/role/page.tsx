import { OnboardingGate } from '../../_shell/onboarding-gate';
import { SignupStage } from '../../_shell/signup-stage';
import { RoleSelectionRoute } from './role-selection-route';

export default function OnboardingRolePage() {
  return (
    <OnboardingGate target="role">
      <SignupStage step={2}>
        <RoleSelectionRoute />
      </SignupStage>
    </OnboardingGate>
  );
}
