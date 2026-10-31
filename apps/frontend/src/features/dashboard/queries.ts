import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { featureKey } from '@/lib/query-keys';
import {
  fetchStudentDashboard,
  fetchStudentFeedback,
  fetchUnreadApplicationDecisionNotices,
  markApplicationDecisionNoticeRead,
} from './api';
import {
  fetchUnreadTeamDeletionNotices,
  markTeamDeletionNoticeRead,
} from './team-deletion-notices-api';

export function useStudentDashboardQuery() {
  return useQuery({
    queryKey: featureKey('student-dashboard'),
    queryFn: fetchStudentDashboard,
  });
}

export function useStudentFeedbackQuery() {
  return useQuery({
    queryKey: featureKey('student-dashboard', 'feedback'),
    queryFn: fetchStudentFeedback,
  });
}

export function useApplicationDecisionNoticesQuery() {
  return useQuery({
    queryKey: featureKey('application-decision-notices'),
    queryFn: fetchUnreadApplicationDecisionNotices,
  });
}

export function useReadApplicationDecisionNoticesMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (ids: readonly string[]) =>
      Promise.allSettled(
        ids.map((id) => markApplicationDecisionNoticeRead(id)),
      ),
    onSuccess: async (results) => {
      if (results.some((result) => result.status === 'fulfilled'))
        await client.invalidateQueries({
          queryKey: featureKey('application-decision-notices'),
        });
    },
  });
}

export function useTeamDeletionNoticesQuery() {
  return useQuery({
    queryKey: featureKey('team-deletion-notices'),
    queryFn: fetchUnreadTeamDeletionNotices,
  });
}

export function useReadTeamDeletionNoticeMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => markTeamDeletionNoticeRead(id),
    onSuccess: async (_, id) => {
      client.setQueryData<
        Awaited<ReturnType<typeof fetchUnreadTeamDeletionNotices>>
      >(featureKey('team-deletion-notices'), (notices) =>
        notices?.filter((notice) => notice.id !== id),
      );
      await client.invalidateQueries({
        queryKey: featureKey('team-deletion-notices'),
      });
    },
  });
}
