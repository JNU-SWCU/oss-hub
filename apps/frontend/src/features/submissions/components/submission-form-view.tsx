import Link from 'next/link';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import type {
  SubmissionFormErrors,
  SubmissionFormInput,
} from '../submission-form';
import type {
  SubmissionBlockedReason,
  SubmissionFormData,
  SubmissionType,
} from '../types';
import { SubmissionInput } from './submission-input';

export const TYPE_LABELS = {
  FILE: '파일',
  TEXT: '텍스트',
  REPOSITORY_RELEASE: '저장소 태그·릴리스',
} as const satisfies Readonly<Record<SubmissionType, string>>;

const BLOCKED_MESSAGES = {
  SUBMISSION_ALREADY_EXISTS: '이미 최초 제출을 완료했습니다.',
  MILESTONE_CLOSED: '마감된 마일스톤입니다.',
  REPOSITORY_NOT_READY: '저장소 생성 중입니다. 잠시 후 새로고침해 주세요.',
  FILE_UPLOAD_UNAVAILABLE: '파일 제출은 현재 지원하지 않습니다.',
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

export function formatDeadline(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Asia/Seoul',
  }).format(new Date(value));
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
              ) : data.blockedReason === 'REPOSITORY_NOT_READY' ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={props.onReload}
                >
                  새로고침
                </Button>
              ) : null}
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
            <CardTitle>
              <h2>제출 내용</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5">
            <SubmissionInput
              submissionType={data.milestone.submissionType}
              repositoryUrl={data.repository?.url ?? null}
              input={props.input}
              errors={props.errors}
              onTextChange={props.onTextChange}
              onReleaseUrlChange={props.onReleaseUrlChange}
            />
            <Field>
              <FieldLabel htmlFor="submission-comment">제출 코멘트</FieldLabel>
              <textarea
                id="submission-comment"
                value={props.comment}
                maxLength={2000}
                aria-describedby="submission-comment-description"
                onChange={(event) => props.onCommentChange(event.target.value)}
                className="min-h-28 w-full resize-y rounded-lg border border-input bg-transparent p-3 text-sm leading-6 transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
              <FieldDescription id="submission-comment-description">
                선택 입력 · 최대 2,000자
              </FieldDescription>
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
          <CardTitle className="text-xl">
            <h1>{data.milestone.name}</h1>
          </CardTitle>
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
