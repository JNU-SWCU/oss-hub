import Link from 'next/link';
import {
  PageBody,
  PageHeader,
  SectionHeading,
  StatusBadge,
} from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { deadlineVariant } from '../submission-checklist';
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
  readonly serverErrorKind: 'program-ended' | 'storage-unavailable' | 'generic';
  readonly submitting: boolean;
  readonly file: File | null;
  readonly fileError: string | null;
  readonly submissionPhase: 'uploading' | 'creating' | null;
  readonly onTextChange: (value: string) => void;
  readonly onReleaseUrlChange: (value: string) => void;
  readonly onFileChange: (file: File | null) => void;
  readonly onCommentChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onReload: () => void;
  readonly embedded?: boolean;
  readonly onCancel?: () => void;
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
    const content = (
      <>
        <SubmissionSummary data={data} />
        <div className="grid gap-6">
          <Alert>
            <AlertTitle>지금은 제출할 수 없습니다</AlertTitle>
            <AlertDescription>
              {BLOCKED_MESSAGES[data.blockedReason]}
            </AlertDescription>
          </Alert>
          <div className="flex flex-wrap gap-3">
            {data.existingSubmission ? (
              <Button asChild>
                <Link href={data.existingSubmission.checklistUrl}>
                  제출 내용 확인
                </Link>
              </Button>
            ) : data.blockedReason === 'REPOSITORY_NOT_READY' ? (
              <Button type="button" onClick={props.onReload}>
                새로고침
              </Button>
            ) : null}
            {props.onCancel ? (
              <Button type="button" variant="outline" onClick={props.onCancel}>
                닫기
              </Button>
            ) : (
              <Button
                asChild
                variant={
                  data.existingSubmission ||
                  data.blockedReason === 'REPOSITORY_NOT_READY'
                    ? 'outline'
                    : 'default'
                }
              >
                <Link href={`/programs/${props.programId}`}>프로그램으로</Link>
              </Button>
            )}
          </div>
        </div>
      </>
    );
    return props.embedded ? (
      <div className="grid gap-5">{content}</div>
    ) : (
      <PageBody className="max-w-3xl">
        <SubmissionHeader data={data} />
        <div className="flex flex-col gap-16">{content}</div>
      </PageBody>
    );
  }

  const content = (
    <>
      {props.serverError ? (
        <Alert variant="destructive">
          <AlertTitle>
            {props.serverErrorKind === 'program-ended'
              ? '프로그램 종료 일시가 필요합니다'
              : props.serverErrorKind === 'storage-unavailable'
                ? '파일 저장소를 사용할 수 없습니다'
                : '제출 실패'}
          </AlertTitle>
          <AlertDescription>{props.serverError}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-col gap-16">
        <SubmissionSummary data={data} />
        <form
          className="grid min-w-0 gap-6"
          aria-labelledby="submission-content-title"
          onSubmit={(event) => {
            event.preventDefault();
            props.onSubmit();
          }}
        >
          <SectionHeading id="submission-content-title" title="제출 내용" />
          <Card className="min-w-0">
            <CardContent className="grid min-w-0 gap-5">
              <SubmissionInput
                submissionType={data.milestone.submissionType}
                repositoryUrl={data.repository?.url ?? null}
                input={props.input}
                errors={props.errors}
                file={props.file}
                fileError={props.fileError}
                disabled={props.submitting}
                onTextChange={props.onTextChange}
                onReleaseUrlChange={props.onReleaseUrlChange}
                onFileChange={props.onFileChange}
              />
              <Field>
                <FieldLabel htmlFor="submission-comment">
                  제출 코멘트
                </FieldLabel>
                <textarea
                  id="submission-comment"
                  value={props.comment}
                  maxLength={2000}
                  aria-describedby="submission-comment-description"
                  onChange={(event) =>
                    props.onCommentChange(event.target.value)
                  }
                  className="min-h-28 w-full resize-y rounded-control border border-input bg-transparent p-4 text-body leading-relaxed transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
                <FieldDescription id="submission-comment-description">
                  선택 입력 · 최대 2,000자
                </FieldDescription>
              </Field>
              {props.submissionPhase ? (
                <p role="status" aria-live="polite" className="text-small">
                  {props.submissionPhase === 'uploading'
                    ? '파일 업로드 중…'
                    : '제출 정보 저장 중…'}
                </p>
              ) : null}
            </CardContent>
          </Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            {props.onCancel ? (
              <Button type="button" variant="outline" onClick={props.onCancel}>
                취소
              </Button>
            ) : (
              <Button asChild variant="outline">
                <Link href={`/programs/${props.programId}`}>취소</Link>
              </Button>
            )}
            <Button type="submit" disabled={props.submitting}>
              {props.submitting
                ? props.submissionPhase === 'uploading'
                  ? '업로드 중…'
                  : '제출 중…'
                : '제출하기'}
            </Button>
          </div>
        </form>
      </div>
    </>
  );
  return props.embedded ? (
    <div className="grid min-w-0 gap-5">{content}</div>
  ) : (
    <PageBody className="max-w-3xl">
      <SubmissionHeader data={data} />
      {content}
    </PageBody>
  );
}

/**
 * 화면의 주인공은 마일스톤이다 — 이름은 카드 제목이 아니라 페이지 제목(40)
 * 자리에 두고, 남은 기간은 조작이 아니라 읽는 라벨이므로 상태 배지(26)로 준다.
 */
function SubmissionHeader({ data }: { readonly data: SubmissionFormData }) {
  return (
    <PageHeader
      title={data.milestone.name}
      description="제출 내용을 확인하고 마일스톤 산출물을 제출합니다."
      actions={
        <StatusBadge variant={deadlineVariant(data.milestone.dDay)}>
          {data.milestone.deadlineLabel}
        </StatusBadge>
      }
    />
  );
}

function SubmissionSummary({ data }: { readonly data: SubmissionFormData }) {
  return (
    <Card className="min-w-0">
      <CardContent className="grid min-w-0 gap-4 break-keep">
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-small">
          <span className="min-w-0 break-words">
            <strong>마감</strong> {formatDeadline(data.milestone.dueAt)}
          </span>
          <span className="min-w-0 break-words">
            <strong>제출 유형</strong>{' '}
            {TYPE_LABELS[data.milestone.submissionType]}
          </span>
        </div>
        {data.milestone.instructions ? (
          <p className="text-body leading-relaxed break-keep whitespace-pre-wrap [overflow-wrap:anywhere]">
            {data.milestone.instructions}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
