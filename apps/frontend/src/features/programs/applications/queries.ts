import { useMutation, useQueryClient } from '@tanstack/react-query';
import { featureKey, programFeatureKey } from '@/lib/query-keys';
import { decideApplication } from './api';
import type { ApplicationDecisionInput } from './dto';

export function useApplicationDecisionMutation(programId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      teamId,
      input,
    }: {
      readonly teamId: string;
      readonly input: ApplicationDecisionInput;
    }) => decideApplication(teamId, input),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({
          queryKey: programFeatureKey(programId, 'overview'),
        }),
        client.invalidateQueries({ queryKey: featureKey('student-dashboard') }),
        client.invalidateQueries({ queryKey: featureKey('staff-dashboard') }),
      ]);
    },
  });
}
