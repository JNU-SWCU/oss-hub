'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api-client';
import {
  createSubmission,
  getSubmissionForm,
  uploadSubmissionFile,
} from './api';
import { SubmissionFormView } from './components/submission-form-view';
import {
  SubmissionLoadFailure,
  SubmissionLoading,
  SubmissionSuccess,
} from './components/submission-page-states';
import { resubmissionContent } from './submission-checklist';
import {
  focusSubmissionField,
  getSubmissionFileErrorMessage,
  isSubmissionArchiveErrorCode,
  type SubmissionFormErrors,
  type SubmissionFormInput,
  isStaleSubmissionFormErrorCode,
  validateSubmissionContent,
  validateSubmissionFile,
  SubmissionFileUploadCache,
} from './submission-form';
import type { CreatedSubmission, SubmissionFormData } from './types';

type SubmissionPageState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'ready'; readonly data: SubmissionFormData }
  | { readonly kind: 'success'; readonly submission: CreatedSubmission };

const EMPTY_INPUT: SubmissionFormInput = {
  file: null,
  text: '',
};

export function SubmissionPage({
  programId,
  milestoneId,
  onCancel,
  onSubmitted,
  onSubmittingChange,
}: {
  readonly programId: string;
  readonly milestoneId: string;
  readonly onCancel: () => void;
  readonly onSubmitted?: () => void;
  readonly onSubmittingChange?: (submitting: boolean) => void;
}) {
  const [state, setState] = useState<SubmissionPageState>({ kind: 'loading' });
  const [input, setInput] = useState<SubmissionFormInput>(EMPTY_INPUT);
  const [comment, setComment] = useState('');
  const [errors, setErrors] = useState<SubmissionFormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverErrorKind, setServerErrorKind] = useState<
    'program-ended' | 'storage-unavailable' | 'generic'
  >('generic');
  const [submitting, setSubmitting] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submissionPhase, setSubmissionPhase] = useState<
    'uploading' | 'creating' | null
  >(null);
  const uploadedFile = useRef(new SubmissionFileUploadCache());
  const submitInFlight = useRef(false);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      setState({
        kind: 'ready',
        data: await getSubmissionForm(programId, milestoneId),
      });
    } catch (error: unknown) {
      setState({
        kind: 'failed',
        message:
          error instanceof ApiError
            ? error.problem.detail
            : '제출 정보를 불러오지 못했습니다.',
      });
    }
  }, [milestoneId, programId]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (data: SubmissionFormData) => {
    if (submitInFlight.current) return;

    const nextErrors = validateSubmissionContent(
      data.milestone.submissionType,
      input,
    );
    const fileValidation =
      data.milestone.submissionType === 'FILE'
        ? validateSubmissionFile(file)
        : { ok: true as const };
    const nextFileError = fileValidation.ok ? null : fileValidation.message;
    setErrors(nextErrors);
    setFileError(nextFileError);
    setServerError(null);
    setServerErrorKind('generic');
    if (Object.keys(nextErrors).length > 0 || nextFileError) {
      // 제출 창은 세로로 스크롤된다 — 버튼은 바닥에 있고 오류 문구는 한참 위에 뜬다.
      // 초점을 옮겨 주지 않으면 화면이 그 자리에 그대로 있어, 눌러도 아무 일이
      // 일어나지 않은 것과 구분되지 않는다.
      focusSubmissionField(data.milestone.submissionType);
      return;
    }

    submitInFlight.current = true;
    setSubmitting(true);
    onSubmittingChange?.(true);
    try {
      let content = resubmissionContent(data.milestone.submissionType, input);
      if (data.milestone.submissionType === 'FILE' && file) {
        const fileId = await uploadedFile.current.resolve(file, async () => {
          setSubmissionPhase('uploading');
          return uploadSubmissionFile(
            data.applicationId,
            data.milestone.id,
            file,
          );
        });
        content = resubmissionContent('FILE', input, fileId);
      }
      if (!content) {
        // 예전에는 여기서 조용히 돌아섰다 — 요청도 안 나가고 화면도 그대로라
        // 사용자에게는 버튼이 죽은 것으로만 보인다. 막힌 이유를 말하고 끝낸다.
        setServerError(
          '제출 내용을 만들지 못했습니다. 파일을 다시 선택해 제출해 주세요.',
        );
        return;
      }

      setSubmissionPhase('creating');
      const submission = await createSubmission({
        applicationId: data.applicationId,
        milestoneId: data.milestone.id,
        content,
        comment,
      });
      setState({ kind: 'success', submission });
      onSubmitted?.();
    } catch (error: unknown) {
      if (
        error instanceof ApiError &&
        isStaleSubmissionFormErrorCode(error.problem.code)
      ) {
        if (data.milestone.submissionType === 'FILE') {
          uploadedFile.current.discard();
        }
        await load();
      } else if (
        error instanceof ApiError &&
        error.problem.code === 'SUB_011'
      ) {
        if (data.milestone.submissionType === 'TEXT') {
          setErrors({ text: error.problem.detail });
        }
        if (data.milestone.submissionType === 'FILE') {
          setFileError(error.problem.detail);
        }
      } else if (
        error instanceof ApiError &&
        isSubmissionArchiveErrorCode(error.problem.code)
      ) {
        /*
         * 압축 파일 안의 내용 때문에 막힌 경우다(#1108). 고칠 것이 파일이므로 화면 전체
         * 오류가 아니라 파일 입력 옆에 세운다. 갈래별 문장은 서버가 준 것을 그대로 쓴다 —
         * 화면이 여덟 문장을 다시 적으면 서버가 거절하며 하는 말과 갈라진다.
         */
        setFileError(error.problem.detail);
      } else if (
        error instanceof ApiError &&
        getSubmissionFileErrorMessage(error.problem.code)
      ) {
        const message = getSubmissionFileErrorMessage(error.problem.code);
        if (error.problem.code === 'SUB_021') {
          setServerErrorKind('program-ended');
          setServerError(message);
        } else if (error.problem.code === 'SUB_020') {
          setServerErrorKind('storage-unavailable');
          setServerError(message);
        } else {
          setFileError(message);
        }
      } else {
        setServerError(
          error instanceof ApiError
            ? error.problem.detail
            : '제출하지 못했습니다. 잠시 후 다시 시도해 주세요.',
        );
      }
    } finally {
      submitInFlight.current = false;
      setSubmissionPhase(null);
      setSubmitting(false);
      onSubmittingChange?.(false);
    }
  };

  if (state.kind === 'loading') return <SubmissionLoading />;
  if (state.kind === 'failed')
    return (
      <SubmissionLoadFailure
        message={state.message}
        onRetry={() => void load()}
      />
    );
  if (state.kind === 'success')
    return (
      <SubmissionSuccess onClose={onCancel} submission={state.submission} />
    );

  return (
    <SubmissionFormView
      data={state.data}
      input={input}
      comment={comment}
      errors={errors}
      serverError={serverError}
      serverErrorKind={serverErrorKind}
      submitting={submitting}
      file={file}
      fileError={fileError}
      submissionPhase={submissionPhase}
      onTextChange={(text) => setInput((previous) => ({ ...previous, text }))}
      onFileChange={(nextFile) => {
        setFile(nextFile);
        setInput((previous) => ({ ...previous, file: nextFile }));
        setFileError(null);
        uploadedFile.current.discardUnless(nextFile);
      }}
      onCommentChange={setComment}
      onSubmit={() => void submit(state.data)}
      onCancel={onCancel}
    />
  );
}

export { SubmissionLoading } from './components/submission-page-states';
