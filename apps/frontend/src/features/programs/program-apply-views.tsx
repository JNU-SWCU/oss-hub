'use client';

import Link from 'next/link';
import { useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { EmptyState, PageHeader } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { ApplicationConfirmationDialog } from './application-confirmation-dialog';
import { FormRenderer } from './form-renderer';
import type {
  ProgramApplyFormErrors,
  ProgramApplyFormValues,
} from './program-apply-flow';
import { programHref } from './program-paths';
import type { ApplicationFormTemplate, ProgramDetail } from './types';

export type ApplicationFormMode = 'create' | 'edit';
export type ApplicationConfirmation = 'submit' | 'save' | 'cancel' | null;

export function ApplySkeleton() {
  return (
    <main
      className="mx-auto grid max-w-3xl gap-6 px-4 py-8"
      aria-label="신청 양식 불러오는 중"
    >
      <div className="h-20 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      <div className="h-72 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
    </main>
  );
}

export function BlockedView({
  reason,
  program,
}: {
  readonly reason: 'period-closed' | 'already-applied' | 'team-required';
  readonly program: ProgramDetail;
}) {
  const content =
    reason === 'period-closed'
      ? {
          title: '신청 기간이 아닙니다',
          description: '모집 기간에만 신청서를 수정하거나 제출할 수 있습니다.',
        }
      : reason === 'already-applied'
        ? {
            title: '수정할 수 없는 신청입니다',
            description:
              '승인 또는 반려된 신청서는 수정하거나 취소할 수 없습니다.',
          }
        : {
            title: '팀 구성이 필요합니다',
            description:
              '팀형 프로그램은 팀을 만든 뒤 신청할 수 있습니다. 팀 구성 화면에서 팀을 만들거나 참여 코드로 합류한 다음 다시 시도해 주세요.',
          };

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <EmptyState
        title={content.title}
        description={content.description}
        action={
          <Button asChild variant="outline">
            <Link href={programHref(program.id)}>프로그램 상세로</Link>
          </Button>
        }
      />
    </main>
  );
}

export function ProgramApplySuccessView({
  program,
  applicationId,
  mode = 'create',
}: {
  readonly program: ProgramDetail;
  readonly applicationId: string;
  readonly mode?: ApplicationFormMode;
}) {
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-12">
      <Alert>
        <AlertTitle>
          {mode === 'create'
            ? '신청이 접수되었습니다'
            : '신청서가 수정되었습니다'}
        </AlertTitle>
        <AlertDescription>
          신청 번호 {applicationId}의 내용을 저장했습니다. 승인 전까지 신청 기간
          내에서 다시 수정하거나 취소할 수 있습니다.
        </AlertDescription>
      </Alert>
      <Button asChild>
        <Link href="/dashboard">내 대시보드로</Link>
      </Button>
    </main>
  );
}

interface ProgramApplyFormViewProps {
  readonly program: ProgramDetail;
  readonly template: ApplicationFormTemplate;
  readonly applicantName: string;
  readonly values: ProgramApplyFormValues;
  readonly errors: ProgramApplyFormErrors;
  readonly serverError: string | null;
  readonly mode: ApplicationFormMode;
  readonly canCancel: boolean;
  readonly confirmation: ApplicationConfirmation;
  readonly submitting: boolean;
  readonly onChange: (key: keyof ProgramApplyFormValues, value: string) => void;
  readonly onTogglePublicationPlanned: (checked: boolean) => void;
  readonly onRequestSubmit: () => void;
  readonly onRequestCancel: () => void;
  readonly onCloseConfirmation: () => void;
  readonly onConfirm: () => void;
}

export function ProgramApplyFormView(props: ProgramApplyFormViewProps) {
  const submitButtonRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const {
    program,
    template,
    applicantName,
    values,
    errors,
    serverError,
    mode,
    canCancel,
    confirmation,
    submitting,
    onChange,
    onTogglePublicationPlanned,
    onRequestSubmit,
    onRequestCancel,
    onCloseConfirmation,
    onConfirm,
  } = props;
  const fieldValues = {
    applicantName,
    title: values.title,
    summary: values.summary,
  } as const;

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <PageHeader
        title={`${program.name} ${mode === 'create' ? '신청' : '신청서'}`}
        description={
          mode === 'create'
            ? '필수 항목을 작성한 뒤 제출해 주세요.'
            : '승인 전까지 신청서 내용을 수정할 수 있습니다.'
        }
      />
      <Alert>
        <AlertTriangle aria-hidden="true" />
        <AlertTitle>신청서 수정·취소 안내</AlertTitle>
        <AlertDescription className="[word-break:keep-all]">
          신청 기간 내 ‘승인 대기’ 상태에서는 신청서를 수정하거나 신청을 취소할
          수 있습니다. 승인된 이후에는 신청서 수정과 신청 취소가 불가능합니다.
        </AlertDescription>
      </Alert>
      <Card>
        <CardHeader>
          <CardTitle>신청서</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormRenderer
            template={template}
            mode="edit"
            values={fieldValues}
            onChange={(key, value) => {
              if (key === 'title' || key === 'summary') onChange(key, value);
            }}
          />
          {errors.title ? <FieldError>{errors.title}</FieldError> : null}
          {errors.summary ? <FieldError>{errors.summary}</FieldError> : null}
          <Field orientation="horizontal">
            <input
              id="repository-publication-planned"
              type="checkbox"
              checked={values.isRepositoryPublicationPlanned}
              disabled={mode === 'edit'}
              onChange={(event) =>
                onTogglePublicationPlanned(event.target.checked)
              }
            />
            <FieldLabel htmlFor="repository-publication-planned">
              {mode === 'edit'
                ? '제출 시 선택한 저장소 공개 예정 여부'
                : '선정 시 저장소를 공개할 예정입니다'}
            </FieldLabel>
          </Field>
          {serverError ? (
            <Alert variant="destructive">
              <AlertTitle>저장 실패</AlertTitle>
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              ref={submitButtonRef}
              type="button"
              disabled={submitting}
              onClick={onRequestSubmit}
            >
              {submitting
                ? '저장 중…'
                : mode === 'create'
                  ? '신청 제출'
                  : '수정 내용 저장'}
            </Button>
            <Button asChild variant="outline">
              <Link href={programHref(program.id)}>프로그램 상세</Link>
            </Button>
            {mode === 'edit' && canCancel ? (
              <Button
                ref={cancelButtonRef}
                type="button"
                variant="destructive"
                disabled={submitting}
                onClick={onRequestCancel}
              >
                신청 취소
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
      {confirmation ? (
        <ApplicationConfirmationDialog
          kind={confirmation}
          submitting={submitting}
          onClose={onCloseConfirmation}
          onConfirm={onConfirm}
          returnFocusRef={
            confirmation === 'cancel' ? cancelButtonRef : submitButtonRef
          }
        />
      ) : null}
    </main>
  );
}
