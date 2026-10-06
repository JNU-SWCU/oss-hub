import { AuthGate } from '../_shell/auth-gate';
import { SignupStage } from '../_shell/signup-stage';
import { ConsentFlow } from '@/features/consents/components/consent-flow';

export default function ConsentPage() {
  return (
    <AuthGate>
      <SignupStage step={1} contentClassName="min-[1280px]:max-w-none">
        <ConsentFlow />
      </SignupStage>
    </AuthGate>
  );
}
