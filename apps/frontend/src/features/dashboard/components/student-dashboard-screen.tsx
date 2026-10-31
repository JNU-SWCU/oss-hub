'use client';

import { useEffect, useState } from 'react';
import { useStudentDashboardUrlState } from '../student-dashboard-url-state';
import { consumeSignupCompletionNotice } from '@/lib/signup-completion-notice';
import type { ApplicationDecisionNotice, StudentFeedbackState } from '../types';
import {
  useStudentDashboardQuery,
  useStudentFeedbackQuery,
  useApplicationDecisionNoticesQuery,
  useReadApplicationDecisionNoticesMutation,
  useTeamDeletionNoticesQuery,
  useReadTeamDeletionNoticeMutation,
} from '../queries';
import { StudentDashboardView } from './student-dashboard-view';

export function StudentDashboardScreen() {
  const {
    state: { status: filter },
    navigate,
  } = useStudentDashboardUrlState();
  const dashboard = useStudentDashboardQuery();
  const feedbackQuery = useStudentFeedbackQuery();
  const decisions = useApplicationDecisionNoticesQuery();
  const { mutate: readDecisions } = useReadApplicationDecisionNoticesMutation();
  const deletions = useTeamDeletionNoticesQuery();
  const readDeletion = useReadTeamDeletionNoticeMutation();
  const [signupCompleted, setSignupCompleted] = useState(false);
  const [applicationDecisionNotices, setApplicationDecisionNotices] = useState<
    readonly ApplicationDecisionNotice[]
  >([]);

  useEffect(() => {
    if (consumeSignupCompletionNotice()) setSignupCompleted(true);
  }, []);

  useEffect(() => {
    if (decisions.data?.length) setApplicationDecisionNotices(decisions.data);
  }, [decisions.data]);

  useEffect(() => {
    if (applicationDecisionNotices.length)
      readDecisions(applicationDecisionNotices.map((notice) => notice.id));
  }, [applicationDecisionNotices, readDecisions]);

  const feedback: StudentFeedbackState =
    feedbackQuery.data !== undefined
      ? { status: 'success', items: feedbackQuery.data }
      : feedbackQuery.isError
        ? { status: 'error' }
        : { status: 'loading' };

  return (
    <StudentDashboardView
      filter={filter}
      onFilterChange={(next) => navigate({ status: next })}
      data={dashboard.data ?? null}
      status={
        dashboard.data !== undefined
          ? 'success'
          : dashboard.isError
            ? 'error'
            : 'loading'
      }
      showSignupCompleteNotice={signupCompleted}
      applicationDecisionNotices={applicationDecisionNotices}
      teamDeletionNotices={deletions.data ?? []}
      teamDeletionFailed={deletions.isError || readDeletion.isError}
      onReadTeamDeletion={(id) => readDeletion.mutate(id)}
      onRetryTeamDeletions={() => {
        readDeletion.reset();
        void deletions.refetch();
      }}
      feedback={feedback}
      onRetry={() => void dashboard.refetch()}
      onRetryFeedback={() => void feedbackQuery.refetch()}
    />
  );
}
