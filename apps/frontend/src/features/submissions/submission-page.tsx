'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api-client';
import { createSubmission, getSubmissionForm } from './api';
import { SubmissionFormView } from './components/submission-form-view';
import {
  type SubmissionFormErrors,
  type SubmissionFormInput,
  validateSubmissionContent,
} from './submission-form';
import type {
  CreatedSubmission,
  CreateSubmissionContent,
  SubmissionFormData,
} from './types';

type SubmissionPageState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'ready'; readonly data: SubmissionFormData }
  | { readonly kind: 'success'; readonly submission: CreatedSubmission };

const EMPTY_INPUT: SubmissionFormInput = { text: '', releaseUrl: '' };

export function SubmissionPage({
  programId,
  milestoneId,
}: {
  readonly programId: string;
  readonly milestoneId: string;
}) {
  const [state, setState] = useState<SubmissionPageState>({ kind: 'loading' });
  const [input, setInput] = useState<SubmissionFormInput>(EMPTY_INPUT);
  const [comment, setComment] = useState('');
  const [errors, setErrors] = useState<SubmissionFormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
    const nextErrors = validateSubmissionContent(
      data.milestone.submissionType,
      input,
    );
    setErrors(nextErrors);
    setServerError(null);
    if (Object.keys(nextErrors).length > 0) return;

    const content = submissionContent(data, input);
    if (!content) return;
    setSubmitting(true);
    try {
      setState({
        kind: 'success',
        submission: await createSubmission({
          applicationId: data.applicationId,
          milestoneId: data.milestone.id,
          content,
          comment,
        }),
      });
    } catch (error: unknown) {
      if (error instanceof ApiError && error.problem.code === 'SUB_009') {
        setErrors({ releaseUrl: error.problem.detail });
      } else if (
        error instanceof ApiError &&
        error.problem.code === 'SUB_011'
      ) {
        setErrors(
          data.milestone.submissionType === 'TEXT'
            ? { text: error.problem.detail }
            : { releaseUrl: error.problem.detail },
        );
      } else {
        setServerError(
          error instanceof ApiError
            ? error.problem.detail
            : '제출하지 못했습니다. 잠시 후 다시 시도해 주세요.',
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (state.kind === 'loading') return <SubmissionLoading />;
  if (state.kind === 'failed') {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <Alert variant="destructive">
          <AlertTitle>제출 정보 불러오기 실패</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{state.message}</p>
            <Button type="button" onClick={() => void load()}>
              다시 시도
            </Button>
          </AlertDescription>
        </Alert>
      </main>
    );
  }
  if (state.kind === 'success') {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <Card role="status" aria-live="polite">
          <CardHeader>
            <CardTitle>제출을 완료했습니다</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              제출 시각{' '}
              {new Date(state.submission.submittedAt).toLocaleString('ko-KR')}
            </p>
            <Button asChild>
              <Link href={`/programs/${programId}`}>프로그램으로 돌아가기</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <SubmissionFormView
      programId={programId}
      data={state.data}
      input={input}
      comment={comment}
      errors={errors}
      serverError={serverError}
      submitting={submitting}
      onTextChange={(text) => setInput((previous) => ({ ...previous, text }))}
      onReleaseUrlChange={(releaseUrl) =>
        setInput((previous) => ({ ...previous, releaseUrl }))
      }
      onCommentChange={setComment}
      onSubmit={() => void submit(state.data)}
      onReload={() => void load()}
    />
  );
}

function submissionContent(
  data: SubmissionFormData,
  input: SubmissionFormInput,
): CreateSubmissionContent | null {
  switch (data.milestone.submissionType) {
    case 'TEXT':
      return { type: 'TEXT', text: input.text.trim() };
    case 'REPOSITORY_RELEASE':
      return {
        type: 'REPOSITORY_RELEASE',
        releaseUrl: input.releaseUrl.trim(),
      };
    case 'FILE':
      return null;
    default: {
      const exhaustiveType: never = data.milestone.submissionType;
      return exhaustiveType;
    }
  }
}

function SubmissionLoading() {
  return (
    <main
      className="mx-auto grid max-w-3xl gap-6 px-4 py-8"
      aria-label="제출 정보 불러오는 중"
    >
      <div className="h-44 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      <div className="h-80 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
    </main>
  );
}
