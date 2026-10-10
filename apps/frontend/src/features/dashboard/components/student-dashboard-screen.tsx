'use client';

import { useCallback, useEffect, useState } from 'react';

import { consumeSignupCompletionNotice } from '@/lib/signup-completion-notice';
import { loadStudentDashboard } from '../load-student-dashboard';
import {
  fetchStudentFeedback,
  fetchUnreadApplicationDecisionNotices,
  markApplicationDecisionNoticeRead,
} from '../api';
import type {
  ApplicationDecisionNotice,
  StudentDashboard,
  StudentDashboardStatus,
  StudentFeedbackState,
} from '../types';
import { StudentDashboardView } from './student-dashboard-view';

export function StudentDashboardScreen() {
  const [data, setData] = useState<StudentDashboard | null>(null);
  const [status, setStatus] = useState<StudentDashboardStatus>('loading');
  const [requestKey, setRequestKey] = useState(0);
  const [signupCompleted, setSignupCompleted] = useState(false);
  const [applicationDecisionNotices, setApplicationDecisionNotices] = useState<
    readonly ApplicationDecisionNotice[]
  >([]);

  const [feedback, setFeedback] = useState<StudentFeedbackState>({
    status: 'loading',
  });
  const [feedbackRequestKey, setFeedbackRequestKey] = useState(0);

  const retry = useCallback(() => setRequestKey((key) => key + 1), []);
  const retryFeedback = useCallback(
    () => setFeedbackRequestKey((key) => key + 1),
    [],
  );

  useEffect(() => {
    if (consumeSignupCompletionNotice()) {
      setSignupCompleted(true);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void fetchUnreadApplicationDecisionNotices()
      .then((notices) => {
        if (!active) return;
        setApplicationDecisionNotices(notices);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (applicationDecisionNotices.length === 0) return;

    void Promise.allSettled(
      applicationDecisionNotices.map((notice) =>
        markApplicationDecisionNoticeRead(notice.id),
      ),
    );
  }, [applicationDecisionNotices]);

  useEffect(() => {
    let active = true;
    setData(null);
    setStatus('loading');

    void loadStudentDashboard().then((result) => {
      if (!active) return;
      if (result.status === 'success') {
        setData(result.data);
        setStatus('success');
        return;
      }
      setStatus('error');
    });

    return () => {
      active = false;
    };
  }, [requestKey]);

  useEffect(() => {
    let active = true;
    setFeedback({ status: 'loading' });

    void fetchStudentFeedback().then(
      (items) => {
        if (active) setFeedback({ status: 'success', items });
      },
      () => {
        if (active) setFeedback({ status: 'error' });
      },
    );

    return () => {
      active = false;
    };
  }, [feedbackRequestKey]);

  return (
    <StudentDashboardView
      data={data}
      status={status}
      showSignupCompleteNotice={signupCompleted}
      applicationDecisionNotices={applicationDecisionNotices}
      feedback={feedback}
      onRetry={retry}
      onRetryFeedback={retryFeedback}
    />
  );
}
