'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyState, PageHeader } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldError } from '@/components/ui/field';
import { ApiError } from '@/lib/api-client';
import { fetchSession } from '@/features/auth/api';
import {
  createApplication,
  getMyTeam,
  getProgramDetail,
  listApplicationTemplates,
} from './api';
import { FormRenderer } from './form-renderer';
import {
  EMPTY_APPLY_FORM,
  mapCreateApplicationError,
  resolveApplyBlockedReason,
  teamSetupHref,
  validateApplyForm,
  type ProgramApplyFormErrors,
  type ProgramApplyFormValues,
  type ProgramApplyPageState,
} from './program-apply-flow';
import { programHref } from './program-paths';
import {
  PROGRAM_TEMPLATE_DEFINITIONS,
} from './program-templates';
import type { ApplicationFormTemplate, ProgramDetail } from './types';

function ApplySkeleton() {
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

function BlockedView({
  reason,
  program,
}: {
  readonly reason: 'period-closed' | 'already-applied' | 'team-required';
  readonly program: ProgramDetail;
}) {
  if (reason === 'period-closed') {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12">
        <EmptyState
          title="신청 기간이 아닙니다"
          description="모집 기간에만 신청할 수 있습니다."
          action={
            <Button asChild variant="outline">
              <Link href={programHref(program.id)}>프로그램 상세로</Link>
            </Button>
          }
        />
      </main>
    );
  }

  if (reason === 'already-applied') {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12">
        <EmptyState
          title="이미 신청했습니다"
          description="이 프로그램에는 이미 제출한 신청이 있습니다."
          action={
            <Button asChild variant="outline">
              <Link href={programHref(program.id)}>프로그램 상세로</Link>
            </Button>
          }
        />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <EmptyState
        title="팀 구성이 필요합니다"
        description="팀형 프로그램은 팀을 만든 뒤 신청할 수 있습니다. 팀 구성 화면에서 팀을 만들거나 참여 코드로 합류한 다음 다시 시도해 주세요."
        action={
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href={teamSetupHref(program.id)}>팀 구성으로 이동</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={programHref(program.id)}>프로그램 상세로</Link>
            </Button>
          </div>
        }
      />
    </main>
  );
}

export function ProgramApplySuccessView({
  program,
  applicationId,
}: {
  readonly program: ProgramDetail;
  readonly applicationId: string;
}) {
  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-12">
      <Alert>
        <AlertTitle>신청이 접수되었습니다</AlertTitle>
        <AlertDescription>
          신청 번호 {applicationId} 로 제출되었습니다. 결과는 프로그램
          상세에서 확인할 수 있습니다.
        </AlertDescription>
      </Alert>
      <Button asChild>
        <Link href={programHref(program.id)}>프로그램 상세로</Link>
      </Button>
    </main>
  );
}

export function ProgramApplyFormView({
  program,
  template,
  applicantName,
  values,
  errors,
  serverError,
  submitting,
  onChange,
  onSubmit,
}: {
  readonly program: ProgramDetail;
  readonly template: ApplicationFormTemplate;
  readonly applicantName: string;
  readonly values: ProgramApplyFormValues;
  readonly errors: ProgramApplyFormErrors;
  readonly serverError: string | null;
  readonly submitting: boolean;
  readonly onChange: (key: keyof ProgramApplyFormValues, value: string) => void;
  readonly onSubmit: () => void;
}) {
  const fieldValues = useMemo(
    () => ({
      applicantName,
      title: values.title,
      summary: values.summary,
    }),
    [applicantName, values.summary, values.title],
  );

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <PageHeader
        title={`${program.name} 신청`}
        description="필수 항목을 작성한 뒤 제출해 주세요."
      />
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
          {serverError ? (
            <Alert variant="destructive">
              <AlertTitle>제출 실패</AlertTitle>
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={submitting} onClick={onSubmit}>
              {submitting ? '제출 중…' : '신청 제출'}
            </Button>
            <Button asChild variant="outline">
              <Link href={programHref(program.id)}>취소</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

function resolveTemplate(
  program: ProgramDetail,
  templates: readonly ApplicationFormTemplate[],
): ApplicationFormTemplate | null {
  const definition = PROGRAM_TEMPLATE_DEFINITIONS.find(
    (item) => item.category === program.category,
  );
  if (!definition) return null;
  return (
    templates.find((item) => item.key === definition.template.key) ??
    definition.template
  );
}

export function ProgramApplyPage({
  programId,
  teamId = null,
}: {
  readonly programId: string;
  readonly teamId?: string | null;
}) {
  const [state, setState] = useState<ProgramApplyPageState>({ kind: 'loading' });
  const [values, setValues] =
    useState<ProgramApplyFormValues>(EMPTY_APPLY_FORM);
  const [errors, setErrors] = useState<ProgramApplyFormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const [program, templates, session] = await Promise.all([
        getProgramDetail(programId),
        listApplicationTemplates().catch(() => [] as ApplicationFormTemplate[]),
        fetchSession().catch(() => ({ isAuthenticated: false as const })),
      ]);
      const template = resolveTemplate(program, templates);
      if (!template) {
        setState({
          kind: 'failed',
          message: '신청 양식을 찾을 수 없습니다.',
        });
        return;
      }

      const applicantName = session.isAuthenticated
        ? (session.user.name ?? session.user.nickname)
        : '';

      let resolvedTeamId = teamId;
      if (
        template.participation === 'team' &&
        resolvedTeamId === null &&
        session.isAuthenticated
      ) {
        try {
          const team = await getMyTeam(programId);
          resolvedTeamId = team.id;
        } catch (error: unknown) {
          if (!(error instanceof ApiError && error.problem.status === 404)) {
            throw error;
          }
        }
      }

      const blocked = resolveApplyBlockedReason(
        program,
        template,
        resolvedTeamId,
      );
      if (blocked) {
        setState({ kind: 'blocked', reason: blocked, program });
        return;
      }

      setState({
        kind: 'ready',
        program,
        template,
        applicantName,
        teamId: resolvedTeamId,
      });
    } catch (error: unknown) {
      if (error instanceof ApiError && error.problem.status === 404) {
        setState({ kind: 'not-found' });
        return;
      }
      setState({
        kind: 'failed',
        message:
          error instanceof ApiError
            ? error.problem.detail
            : '신청 양식을 불러오지 못했습니다.',
      });
    }
  }, [programId, teamId]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    if (state.kind !== 'ready') return;
    const nextErrors = validateApplyForm(values);
    setErrors(nextErrors);
    setServerError(null);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    try {
      const created = await createApplication(programId, {
        answers: {
          title: values.title.trim(),
          summary: values.summary.trim(),
        },
        teamId: state.teamId,
        applicationTemplateVersion: state.template.version,
      });
      setState({
        kind: 'success',
        program: state.program,
        applicationId: created.id,
      });
    } catch (error: unknown) {
      if (error instanceof ApiError) {
        if (error.problem.code === 'APP_012') {
          setState({
            kind: 'blocked',
            reason: 'team-required',
            program: state.program,
          });
          return;
        }
        if (error.problem.code === 'APP_010') {
          setState({
            kind: 'blocked',
            reason: 'period-closed',
            program: state.program,
          });
          return;
        }
        if (error.problem.code === 'APP_011') {
          setState({
            kind: 'blocked',
            reason: 'already-applied',
            program: state.program,
          });
          return;
        }
        setServerError(mapCreateApplicationError(error.problem));
      } else {
        setServerError('신청을 제출하지 못했습니다.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  switch (state.kind) {
    case 'loading':
      return <ApplySkeleton />;
    case 'not-found':
      return (
        <main className="mx-auto max-w-3xl px-4 py-12">
          <EmptyState
            title="프로그램을 찾을 수 없습니다"
            description="삭제되었거나 공개되지 않은 프로그램입니다."
            action={
              <Button asChild variant="outline">
                <Link href="/programs">프로그램 목록으로</Link>
              </Button>
            }
          />
        </main>
      );
    case 'failed':
      return (
        <main className="mx-auto max-w-3xl px-4 py-12">
          <EmptyState
            title="신청 양식을 불러오지 못했습니다"
            description={state.message}
            action={
              <Button type="button" variant="outline" onClick={() => void load()}>
                다시 시도
              </Button>
            }
          />
        </main>
      );
    case 'blocked':
      return <BlockedView reason={state.reason} program={state.program} />;
    case 'success':
      return (
        <ProgramApplySuccessView
          program={state.program}
          applicationId={state.applicationId}
        />
      );
    case 'ready':
      return (
        <ProgramApplyFormView
          program={state.program}
          template={state.template}
          applicantName={state.applicantName}
          values={values}
          errors={errors}
          serverError={serverError}
          submitting={submitting}
          onChange={(key, value) =>
            setValues((previous) => ({ ...previous, [key]: value }))
          }
          onSubmit={() => void submit()}
        />
      );
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}
