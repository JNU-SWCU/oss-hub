import { AuthGate } from '../../_shell/auth-gate';
import { SignupStage } from '../../_shell/signup-stage';
import { ProfileOnboardingRoute } from './profile-onboarding-route';

export default function OnboardingProfilePage() {
  return (
    <AuthGate>
      <SignupStage step={3}>
        <ProfileOnboardingRoute />
      </SignupStage>
    </AuthGate>
  );
}
