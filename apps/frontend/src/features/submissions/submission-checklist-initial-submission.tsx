'use client';

import { type ReactNode, useCallback, useRef, useState } from 'react';
import { SubmissionPage } from './submission-page';

interface UseSubmissionChecklistInitialSubmissionFlowOptions {
  readonly milestoneId: string | null;
  readonly onCloseSelected?: () => void;
  readonly programId: string;
  readonly refresh: () => void;
  readonly resubmitting: boolean;
}

export function useSubmissionChecklistInitialSubmissionFlow({
  milestoneId,
  onCloseSelected,
  programId,
  refresh,
  resubmitting,
}: UseSubmissionChecklistInitialSubmissionFlowOptions) {
  const [initialSubmitting, setInitialSubmitting] = useState(false);
  const refreshAfterClose = useRef(false);
  const selectedMilestoneId = useRef(milestoneId);
  selectedMilestoneId.current = milestoneId;
  const resetInitialSubmission = useCallback(
    () => setInitialSubmitting(false),
    [],
  );

  const consumePendingRefresh = useCallback(() => {
    if (!refreshAfterClose.current) return;
    refreshAfterClose.current = false;
    refresh();
  }, [refresh]);

  const closeSelected = () => {
    if (resubmitting || initialSubmitting) return;
    selectedMilestoneId.current = null;
    onCloseSelected?.();
    consumePendingRefresh();
  };

  const renderInitialSubmission = (isAvailable: boolean): ReactNode => {
    if (!isAvailable || !milestoneId) return undefined;

    return (
      <SubmissionPage
        milestoneId={milestoneId}
        onCancel={closeSelected}
        onSubmitted={() => {
          if (selectedMilestoneId.current === null) {
            refresh();
            return;
          }
          refreshAfterClose.current = true;
        }}
        onSubmittingChange={setInitialSubmitting}
        programId={programId}
      />
    );
  };

  return {
    closeSelected,
    consumePendingRefresh,
    render: renderInitialSubmission,
    reset: resetInitialSubmission,
    submitting: initialSubmitting,
  };
}
