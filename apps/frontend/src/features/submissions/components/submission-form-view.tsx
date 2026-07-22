import Link from 'next/link';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type {
  SubmissionFormErrors,
  SubmissionFormInput,
} from '../submission-form';
import type {
  SubmissionBlockedReason,
  SubmissionFormData,
  SubmissionType,
} from '../types';

const TYPE_LABELS = {
  FILE: '파일',
  TEXT: '텍스트',
  REPOSITORY_RELEASE: '저장소 태그·릴리스',
} as const satisfies Readonly<Record<SubmissionType, string>>;

const BLOCKED_MESSAGES = {
  SUBMISSION_ALREADY_EXISTS: '이미 최초 제출을 완료했습니다.',
  MILESTONE_CLOSED: '마감된 마일스톤입니다.',
  REPOSITORY_NOT_READY: '저장소 생성 중입니다. 잠시 후 새로고침해 주세요.',
  FILE_UPLOAD_UNAVAILABLE:
    '파일 제출은 비공개 저장소 준비가 끝난 뒤 제공됩니다.',
} as const satisfies Readonly<Record<SubmissionBlockedReason, string>>;

export interface SubmissionFormViewProps {
  readonly programId: string;
  readonly data: SubmissionFormData;
  readonly input: SubmissionFormInput;
  readonly comment: string;
  readonly errors: SubmissionFormErrors;
  readonly serverError: string | null;
  readonly submitting: boolean;
  readonly onTextChange: (value: string) => void;
  readonly onReleaseUrlChange: (value: string) => void;
  readonly onCommentChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onReload: () => void;
}

function formatDeadline(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Asia/Seoul',
  }).format(new Date(value));
}

function SubmissionInput({
  data,
  input,
  errors,
  onTextChange,
  onReleaseUrlChange,
}: Pick<
  SubmissionFormViewProps,
  'data' | 'input' | 'errors' | 'onTextChange' | 'onReleaseUrlChange'
>) {
  switch (data.milestone.submissionType) {
    case 'TEXT':
      return (
        <Field data-invalid={Boolean(errors.text)}>
          <FieldLabel htmlFor="submission-text">제출 내용 *</FieldLabel>
          <textarea
            id="submission-text"
            value={input.text}
            aria-invalid={Boolean(errors.text)}
            aria-describedby={errors.text ? 'submission-text-error' : undefined}
            onChange={(event) => onTextChange(event.target.value)}
            className="min-h-48 rounded-lg border border-input bg-transparent p-3 text-sm leading-6"
          />
          <FieldError id="submission-text-error">{errors.text}</FieldError>
        </Field>
      );
    case 'REPOSITORY_RELEASE':
      return (
        <Field data-invalid={Boolean(errors.releaseUrl)}>
          <FieldLabel htmlFor="release-url">태그 또는 릴리스 URL *</FieldLabel>
          <Input
            id="release-url"
            type="url"
            value={input.releaseUrl}
            placeholder={`${data.repository?.url ?? 'https://github.com/owner/repository'}/releases/tag/v1.0.0`}
            aria-invalid={Boolean(errors.releaseUrl)}
            aria-describedby={
              errors.releaseUrl
                ? 'release-url-error'
                : 'release-url-description'
            }
            onChange={(event) => onReleaseUrlChange(event.target.value)}
          />
          <FieldDescription id="release-url-description">
            연결 저장소 아래의 태그 또는 릴리스 URL만 제출할 수 있습니다.
          </FieldDescription>
          <FieldError id="release-url-error">{errors.releaseUrl}</FieldError>
        </Field>
      );
    case 'FILE':
      return null;
    default: {
      const exhaustiveType: never = data.milestone.submissionType;
      return exhaustiveType;
    }
  }
}

export function SubmissionFormView(props: SubmissionFormViewProps) {
  const { data } = props;
  if (!data.canSubmit && data.blockedReason) {
    return (
      <main className="mx-auto grid max-w-3xl gap-6 px-4 py-8">
        <SubmissionSummary data={data} />
        <Alert>
          <AlertTitle>지금은 제출할 수 없습니다</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{BLOCKED_MESSAGES[data.blockedReason]}</p>
            <div className="flex flex-wrap gap-2">
              {data.existingSubmission ? (
                <Button asChild>
                  <Link href={data.existingSubmission.checklistUrl}>
                    제출 내용 확인
                  </Link>
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={props.onReload}
                >
                  새로고침
                </Button>
              )}
              <Button asChild variant="outline">
                <Link href={`/programs/${props.programId}`}>프로그램으로</Link>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </main>
    );
  }

  return (
    <main className="mx-auto grid max-w-3xl gap-6 px-4 py-8">
      <SubmissionSummary data={data} />
      {props.serverError ? (
        <Alert variant="destructive">
          <AlertTitle>제출 실패</AlertTitle>
          <AlertDescription>{props.serverError}</AlertDescription>
        </Alert>
      ) : null}
      <form
        className="grid gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          props.onSubmit();
        }}
      >
        <Card>
          <CardHeader>
            <CardTitle>제출 내용</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5">
            <SubmissionInput {...props} />
            <Field>
              <FieldLabel htmlFor="submission-comment">제출 코멘트</FieldLabel>
              <textarea
                id="submission-comment"
                value={props.comment}
                maxLength={2000}
                onChange={(event) => props.onCommentChange(event.target.value)}
                className="min-h-28 rounded-lg border border-input bg-transparent p-3 text-sm leading-6"
              />
              <FieldDescription>선택 입력 · 최대 2,000자</FieldDescription>
            </Field>
          </CardContent>
        </Card>
        <div className="flex flex-wrap justify-between gap-3">
          <Button asChild variant="outline">
            <Link href={`/programs/${props.programId}`}>취소</Link>
          </Button>
          <Button type="submit" disabled={props.submitting}>
            {props.submitting ? '제출 중…' : '제출하기'}
          </Button>
        </div>
      </form>
    </main>
  );
}

function SubmissionSummary({ data }: { readonly data: SubmissionFormData }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-xl">{data.milestone.name}</CardTitle>
          <span className="rounded-full bg-muted px-3 py-1 text-sm font-medium">
            {data.milestone.deadlineLabel}
          </span>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 break-keep">
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-medium">마감</dt>
            <dd className="text-muted-foreground">
              {formatDeadline(data.milestone.dueAt)}
            </dd>
          </div>
          <div>
            <dt className="font-medium">제출 유형</dt>
            <dd className="text-muted-foreground">
              {TYPE_LABELS[data.milestone.submissionType]}
            </dd>
          </div>
        </dl>
        {data.milestone.instructions ? (
          <p className="whitespace-pre-wrap text-sm leading-6">
            {data.milestone.instructions}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
