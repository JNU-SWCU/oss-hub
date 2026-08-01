'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api-client';
import {
  createResubmission,
  getSubmissionChecklist,
  uploadSubmissionFile,
} from './api';
import {
  applyResubmission,
  type ResubmissionPhase,
  resubmissionFailure,
  submitResubmissionRevision,
} from './submission-checklist';
import {
  getSubmissionFileErrorMessage,
  SubmissionFileUploadCache,
  type SubmissionFormErrors,
  type SubmissionFormInput,
  validateSubmissionContent,
} from './submission-form';
import {
  ChecklistLoadFailure,
  ChecklistSkeleton,
  SubmissionChecklistView,
} from './components/submission-checklist-view';
import type { SubmissionChecklist } from './types';

type ChecklistPageState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'ready'; readonly data: SubmissionChecklist };

const EMPTY_INPUT: SubmissionFormInput = {
  file: null,
  text: '',
  releaseUrl: '',
};

const STALE_NOTICE =
  '다른 곳에서 제출 상태가 바뀌어 최신 상태를 다시 불러왔습니다. 내용을 확인한 후 다시 시도해 주세요.';

const FILE_SUBMISSION_UNAVAILABLE_CODE = 'SUB_010';

export function SubmissionChecklistPage({
  programId,
  milestoneId,
}: {
  readonly programId: string;
  readonly milestoneId: string | null;
}) {
  const [state, setState] = useState<ChecklistPageState>({ kind: 'loading' });
  const [input, setInput] = useState<SubmissionFormInput>(EMPTY_INPUT);
  const [comment, setComment] = useState('');
  const [errors, setErrors] = useState<SubmissionFormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [staleNotice, setStaleNotice] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submissionPhase, setSubmissionPhase] =
    useState<ResubmissionPhase | null>(null);
  const uploadedFile = useRef(new SubmissionFileUploadCache());
  const resubmitInFlight = useRef(false);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      setState({
        kind: 'ready',
        data: await getSubmissionChecklist(programId),
      });
    } catch (error: unknown) {
      setState({
        kind: 'failed',
        message:
          error instanceof ApiError
            ? error.problem.detail
            : '체크리스트를 불러오지 못했습니다.',
      });
    }
  }, [programId]);

  useEffect(() => {
    void load();
  }, [load]);

  // 선택 마일스톤(?milestoneId=)이 바뀌면 폼 입력·오류를 초기화한다.
  useEffect(() => {
    setInput(EMPTY_INPUT);
    setComment('');
    setErrors({});
    setFileError(null);
    setServerError(null);
    setSubmissionPhase(null);
    uploadedFile.current.discard();
  }, [milestoneId]);

  const resubmit = async (checklist: SubmissionChecklist) => {
    if (resubmitInFlight.current) return;
    const item = checklist.items.find(
      (candidate) => candidate.milestoneId === milestoneId,
    );
    const submission = item?.submission;
    if (!item || !submission || submission.status !== 'CHANGES_REQUESTED') {
      return;
    }

    const nextErrors = validateSubmissionContent(item.submissionType, input);
    setErrors(nextErrors);
    setFileError(nextErrors.file ?? null);
    setServerError(null);
    setToastMessage(null);
    if (Object.keys(nextErrors).length > 0) return;

    resubmitInFlight.current = true;
    setSubmitting(true);
    try {
      const result = await submitResubmissionRevision({
        applicationId: checklist.applicationId,
        milestoneId: item.milestoneId,
        submission,
        submissionType: item.submissionType,
        input,
        comment,
        cache: uploadedFile.current,
        uploadSubmissionFile,
        createResubmission,
        onPhaseChange: setSubmissionPhase,
      });
      if (!result) return;
      setState({
        kind: 'ready',
        data: applyResubmission(checklist, item.milestoneId, result),
      });
      setStaleNotice(null);
      setFileError(null);
      uploadedFile.current.discard();
      setToastMessage(
        `revision ${result.revision}을 제출했습니다. 검토 대기 상태로 전환되었습니다.`,
      );
      setInput(EMPTY_INPUT);
      setComment('');
    } catch (error: unknown) {
      if (error instanceof ApiError) {
        const uploadMessage = getSubmissionFileErrorMessage(error.problem.code);
        if (uploadMessage) {
          if (error.problem.code === 'SUB_020') {
            setServerError(uploadMessage);
          } else {
            setFileError(uploadMessage);
          }
          return;
        }
        if (
          item.submissionType === 'FILE' &&
          error.problem.code === FILE_SUBMISSION_UNAVAILABLE_CODE
        ) {
          uploadedFile.current.discard();
        }
        const failure = resubmissionFailure(error.problem, item.submissionType);
        if (failure.kind === 'stale') {
          uploadedFile.current.discard();
          setInput(EMPTY_INPUT);
          setFileError(null);
          setStaleNotice(STALE_NOTICE);
          await load();
        } else if (failure.kind === 'field') {
          if (failure.field === 'file') {
            setFileError(failure.message);
          } else {
            setErrors({ [failure.field]: failure.message });
          }
        } else {
          setServerError(failure.message);
        }
      } else {
        setServerError('재제출하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      }
    } finally {
      setSubmissionPhase(null);
      setSubmitting(false);
      resubmitInFlight.current = false;
    }
  };

  if (state.kind === 'loading') return <ChecklistSkeleton />;
  if (state.kind === 'failed') {
    return (
      <ChecklistLoadFailure
        message={state.message}
        onRetry={() => void load()}
      />
    );
  }

  return (
    <SubmissionChecklistView
      programId={programId}
      checklist={state.data}
      selectedMilestoneId={milestoneId}
      now={new Date()}
      input={input}
      comment={comment}
      errors={errors}
      fileError={fileError}
      serverError={serverError}
      staleNotice={staleNotice}
      toastMessage={toastMessage}
      submitting={submitting}
      submissionPhase={submissionPhase}
      onTextChange={(text) => setInput((previous) => ({ ...previous, text }))}
      onReleaseUrlChange={(releaseUrl) =>
        setInput((previous) => ({ ...previous, releaseUrl }))
      }
      onFileChange={(file) => {
        setInput((previous) => ({ ...previous, file }));
        setFileError(null);
        uploadedFile.current.discardUnless(file);
      }}
      onCommentChange={setComment}
      onResubmit={() => void resubmit(state.data)}
    />
  );
}
