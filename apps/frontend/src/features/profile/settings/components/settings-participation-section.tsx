import { FormSection, UserParticipationList } from '@/components';
import type { UserParticipation } from '@/lib/user-participation';

export function SettingsParticipationSection({
  participations,
}: {
  readonly participations: readonly UserParticipation[];
}) {
  return (
    <FormSection title="참여 프로그램">
      <UserParticipationList participations={participations} />
    </FormSection>
  );
}
