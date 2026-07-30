'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { FormSection } from '@/components/form-section';
import { ApiError } from '@/lib/api-client';
import { createProgram, listApplicationTemplates } from './api';
import {
  buildCreateProgramInput,
  EMPTY_PROGRAM_FORM,
  hasProgramFormInput,
  startProgramSubmission,
  validateProgramForm,
  type ProgramForm,
  type ProgramFormErrors,
  type ProgramSubmissionLock,
} from './program-creation-flow';
import {
  mergeTemplateFieldsFromApi,
  PROGRAM_TEMPLATE_DEFINITIONS,
  type ProgramTemplateDefinition,
} from './program-templates';
import { ProgramTypeModal } from './program-type-modal';
import { useProgramExitGuard } from './use-program-exit-guard';

function mapServerFieldErrors(error: ApiError): ProgramFormErrors {
  const errors: {
    name?: string;
    organizer?: string;
    period?: string;
    endAt?: string;
    team?: string;
    description?: string;
  } = {};
  for (const fieldError of error.problem.fieldErrors ?? []) {
    switch (fieldError.field) {
      case 'name':
        errors.name = fieldError.message;
        break;
      case 'organizer':
        errors.organizer = fieldError.message;
        break;
      case 'applicationStartAt':
      case 'applicationEndAt':
        errors.period = fieldError.message;
        break;
      case 'endAt':
        errors.endAt = fieldError.message;
        break;
      case 'teamMinSize':
      case 'teamMaxSize':
        errors.team = fieldError.message;
        break;
      case 'description':
        errors.description = fieldError.message;
        break;
    }
  }
  return errors;
}

export function ProgramCreationPage() {
  const [definitions, setDefinitions] = useState(PROGRAM_TEMPLATE_DEFINITIONS);
  const [selected, setSelected] = useState<ProgramTemplateDefinition | null>(
    null,
  );
  const [modalOpen, setModalOpen] = useState(true);
  const [form, setForm] = useState<ProgramForm>(EMPTY_PROGRAM_FORM);
  const [errors, setErrors] = useState<ProgramFormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submissionLock = useRef<ProgramSubmissionLock>({ current: false });
  const hasUnsavedInput = hasProgramFormInput(form);
  const { leavePage, completeAndNavigate } =
    useProgramExitGuard(hasUnsavedInput);

  useEffect(() => {
    let cancelled = false;
    void listApplicationTemplates()
      .then((templates) => {
        if (cancelled) return;
        setDefinitions(
          mergeTemplateFieldsFromApi(PROGRAM_TEMPLATE_DEFINITIONS, templates),
        );
      })
      .catch(() => {
        // 로컬 V1 fields 폴백 유지 — 생성 유형 선택은 계속 가능
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = (key: keyof ProgramForm, value: string) =>
    setForm((previous) => ({ ...previous, [key]: value }));
  const save = async () => {
    if (!selected) return;
    const nextErrors = validateProgramForm(form, selected);
    setErrors(nextErrors);
    setServerError(null);
    if (Object.keys(nextErrors).length) return;
    const submission = startProgramSubmission(
      submissionLock.current,
      buildCreateProgramInput(form, selected),
      createProgram,
      completeAndNavigate,
    );
    if (submission.status === 'ignored') return;
    setSubmitting(true);
    try {
      await submission.completion;
    } catch (error) {
      if (error instanceof ApiError) {
        const fieldErrors = mapServerFieldErrors(error);
        setErrors(fieldErrors);
        setServerError(
          Object.keys(fieldErrors).length > 0 ? null : error.problem.detail,
        );
      } else {
        setServerError('저장에 실패했습니다. 다시 시도해 주세요.');
      }
    } finally {
      setSubmitting(false);
    }
  };
  if (!selected || modalOpen)
    return (
      <ProgramTypeModal
        definitions={definitions}
        selected={selected}
        onSelect={setSelected}
        onContinue={() => setModalOpen(false)}
        onCancel={() => (selected ? setModalOpen(false) : leavePage())}
      />
    );
  const isTeam = selected.template.participation === 'team';
  return (
    <main className="space-y-6 p-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">프로그램 생성</h1>
        <p className="text-sm text-muted-foreground">
          선택 유형 <strong>{selected.label}</strong> · 템플릿{' '}
          <strong>
            {selected.template.key} v{selected.template.version}
          </strong>
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={() => setModalOpen(true)}
        >
          유형 다시 선택
        </Button>
      </header>
      {serverError ? (
        <Alert variant="destructive">
          <AlertTitle>저장 실패</AlertTitle>
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      ) : null}
      <FormSection title="기본 정보">
        <Field>
          <FieldLabel htmlFor="name">프로그램명 *</FieldLabel>
          <Input
            id="name"
            value={form.name}
            onChange={(event) => update('name', event.target.value)}
          />
          <FieldError>{errors.name}</FieldError>
        </Field>
        <Field>
          <FieldLabel htmlFor="organizer">주관기관 *</FieldLabel>
          <Input
            id="organizer"
            value={form.organizer}
            onChange={(event) => update('organizer', event.target.value)}
          />
          <FieldError>{errors.organizer}</FieldError>
        </Field>
        <Field>
          <FieldLabel>신청 기간 *</FieldLabel>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-2">
              <FieldLabel className="text-xs" htmlFor="applicationStartAt">
                시작일시
              </FieldLabel>
              <Input
                id="applicationStartAt"
                type="datetime-local"
                value={form.applicationStartAt}
                onChange={(event) =>
                  update('applicationStartAt', event.target.value)
                }
              />
            </div>
            <div className="space-y-2">
              <FieldLabel className="text-xs" htmlFor="applicationEndAt">
                마감일시
              </FieldLabel>
              <Input
                id="applicationEndAt"
                type="datetime-local"
                value={form.applicationEndAt}
                onChange={(event) =>
                  update('applicationEndAt', event.target.value)
                }
              />
            </div>
          </div>
          <FieldError>{errors.period}</FieldError>
        </Field>
        <Field>
          <FieldLabel htmlFor="endAt">프로그램 종료일 *</FieldLabel>
          <Input
            id="endAt"
            type="datetime-local"
            required
            aria-invalid={Boolean(errors.endAt)}
            aria-describedby={errors.endAt ? 'endAt-error' : undefined}
            value={form.endAt}
            onChange={(event) => update('endAt', event.target.value)}
          />
          <FieldError id="endAt-error">{errors.endAt}</FieldError>
        </Field>
        {isTeam ? (
          <Field>
            <FieldLabel>팀 인원 *</FieldLabel>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                type="number"
                min="1"
                value={form.teamMinSize}
                onChange={(event) => update('teamMinSize', event.target.value)}
              />
              <Input
                type="number"
                min="1"
                value={form.teamMaxSize}
                onChange={(event) => update('teamMaxSize', event.target.value)}
              />
            </div>
            <FieldError>{errors.team}</FieldError>
          </Field>
        ) : null}
        <Field>
          <FieldLabel htmlFor="description">소개/설명 *</FieldLabel>
          <textarea
            id="description"
            value={form.description}
            onChange={(event) => update('description', event.target.value)}
            className="min-h-32 rounded-lg border border-input bg-transparent p-3 text-sm"
          />
          <FieldError>{errors.description}</FieldError>
        </Field>
      </FormSection>
      <div className="flex justify-between">
        <Button type="button" variant="outline" onClick={leavePage}>
          취소
        </Button>
        <Button type="button" disabled={submitting} onClick={() => void save()}>
          {submitting ? '저장 중…' : '저장'}
        </Button>
      </div>
    </main>
  );
}
