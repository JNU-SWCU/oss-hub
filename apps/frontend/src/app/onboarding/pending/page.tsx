import { OnboardingGate } from '../../_shell/onboarding-gate';
import { StaffAccessRequestRoute } from './role-request-route';

export default function OnboardingPendingPage() {
  return (
    <OnboardingGate target="pending">
      <StaffAccessRequestRoute />
    </OnboardingGate>
  );
}
