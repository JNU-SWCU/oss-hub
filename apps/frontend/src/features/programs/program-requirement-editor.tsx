import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { ProgramAuthoringTemplateFile } from './program-authoring-model';

export type ProgramRequirementEditorValue = {
  readonly name: string;
  readonly required: boolean;
};

export function ProgramRequirementEditor({
  idPrefix,
  value,
  templateFile,
  errors,
  onNameChange,
  onRequiredChange,
  onTemplateFile,
  validateFile,
}: {
  readonly idPrefix: string;
  readonly value: ProgramRequirementEditorValue;
  readonly templateFile?: ProgramAuthoringTemplateFile | null;
  readonly errors: {
    readonly name?: string;
    readonly templateFile?: string;
    readonly general?: string;
  };
  readonly onNameChange: (name: string) => void;
  readonly onRequiredChange: (required: boolean) => void;
  readonly onTemplateFile?: (file: File | null) => void;
  readonly validateFile?: (file: File) => string | null;
}) {
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const nameId = `${idPrefix}-name`;
  const requiredId = `${idPrefix}-required`;
  const fileId = `${idPrefix}-template`;
  const submissionHelpId = `${idPrefix}-submission-help`;
  const nameErrorId = `${idPrefix}-name-error`;
  const fileHelpId = `${idPrefix}-template-help`;
  const fileErrorId = `${idPrefix}-template-error`;

  return (
    <div className="grid gap-4">
      <Field>
        <FieldLabel htmlFor={nameId}>제출 항목 이름 *</FieldLabel>
        <Input
          id={nameId}
          value={value.name}
          aria-invalid={Boolean(errors.name)}
          aria-describedby={`${submissionHelpId}${errors.name ? ` ${nameErrorId}` : ''}`}
          onChange={(event) => onNameChange(event.target.value)}
        />
        <FieldError id={nameErrorId}>{errors.name}</FieldError>
      </Field>
      <FieldDescription
        id={submissionHelpId}
        className="break-keep text-pretty"
      >
        학생은 이 항목에 내용만, 파일만, 또는{' '}
        <span className="whitespace-nowrap">둘 다</span> 제출할 수 있습니다.
      </FieldDescription>
      <Field orientation="horizontal">
        <input
          id={requiredId}
          type="checkbox"
          checked={value.required}
          onChange={(event) => onRequiredChange(event.target.checked)}
        />
        <FieldLabel htmlFor={requiredId}>필수 제출로 지정합니다</FieldLabel>
      </Field>
      {onTemplateFile ? (
        <Field>
          <FieldLabel htmlFor={fileId}>참고 자료·양식 (선택)</FieldLabel>
          <Input
            id={fileId}
            type="file"
            accept=".pdf,.hwp,.jpg,.jpeg,.png,.zip"
            aria-invalid={Boolean(errors.templateFile)}
            aria-describedby={`${fileHelpId}${(selectionError ?? errors.templateFile) ? ` ${fileErrorId}` : ''}`}
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              event.target.value = '';
              const nextError =
                file === null ? null : (validateFile?.(file) ?? null);
              setSelectionError(nextError);
              if (nextError !== null) return;
              onTemplateFile(file);
            }}
          />
          <FieldDescription id={fileHelpId} className="break-keep text-pretty">
            학생이 참고할 자료가 있을 때만{' '}
            <span className="whitespace-nowrap">올려 주세요.</span> 제출 방법을
            제한하지 않습니다.
          </FieldDescription>
          {templateFile ? (
            <div className="flex flex-wrap items-center gap-3 rounded-control bg-muted px-4 py-3 text-small">
              <span className="min-w-0 flex-1 break-all">
                {templateFile.name}
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSelectionError(null);
                  onTemplateFile(null);
                }}
              >
                선택 해제
              </Button>
            </div>
          ) : null}
          <FieldError id={fileErrorId} role="alert">
            {selectionError ?? errors.templateFile}
          </FieldError>
        </Field>
      ) : null}
      <FieldError role="alert">{errors.general}</FieldError>
    </div>
  );
}
