import { FileUp, TextCursorInput } from 'lucide-react';
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
import type { SubmissionType } from './types';

export type ProgramRequirementEditorValue = {
  readonly name: string;
  readonly required: boolean;
  readonly submissionType: SubmissionType;
};

export function ProgramRequirementEditor({
  idPrefix,
  value,
  templateFile,
  typeLocked = false,
  typeLockDescription,
  errors,
  onNameChange,
  onRequiredChange,
  onTypeChange,
  onTemplateFile,
  validateFile,
}: {
  readonly idPrefix: string;
  readonly value: ProgramRequirementEditorValue;
  readonly templateFile?: ProgramAuthoringTemplateFile | null;
  readonly typeLocked?: boolean;
  readonly typeLockDescription?: string;
  readonly errors: {
    readonly name?: string;
    readonly templateFile?: string;
    readonly general?: string;
  };
  readonly onNameChange: (name: string) => void;
  readonly onRequiredChange: (required: boolean) => void;
  readonly onTypeChange: (submissionType: SubmissionType) => void;
  readonly onTemplateFile?: (file: File | null) => void;
  readonly validateFile?: (file: File) => string | null;
}) {
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const nameId = `${idPrefix}-name`;
  const requiredId = `${idPrefix}-required`;
  const typeDescriptionId = `${idPrefix}-type-description`;
  const fileId = `${idPrefix}-template`;

  return (
    <div className="grid gap-4">
      <Field>
        <FieldLabel htmlFor={nameId}>요구서류명 *</FieldLabel>
        <Input
          id={nameId}
          value={value.name}
          aria-invalid={Boolean(errors.name)}
          onChange={(event) => onNameChange(event.target.value)}
        />
        <FieldError>{errors.name}</FieldError>
      </Field>
      <Field>
        <FieldLabel>제출 방식</FieldLabel>
        <div
          className="grid gap-3 sm:grid-cols-2"
          role="radiogroup"
          aria-label="요구서류 제출 방식"
          aria-describedby={typeLocked ? typeDescriptionId : undefined}
        >
          <RequirementTypeChoice
            id={`${idPrefix}-file`}
            checked={value.submissionType === 'FILE'}
            disabled={typeLocked}
            icon={<FileUp aria-hidden="true" />}
            label="파일 제출"
            description="PDF, HWP, 이미지, ZIP 파일을 받습니다."
            onChange={() => onTypeChange('FILE')}
          />
          <RequirementTypeChoice
            id={`${idPrefix}-text`}
            checked={value.submissionType === 'TEXT'}
            disabled={typeLocked}
            icon={<TextCursorInput aria-hidden="true" />}
            label="텍스트 입력"
            description="학생이 화면에서 내용을 직접 입력합니다."
            onChange={() => onTypeChange('TEXT')}
          />
        </div>
        {typeLocked && typeLockDescription ? (
          <FieldDescription id={typeDescriptionId}>
            {typeLockDescription}
          </FieldDescription>
        ) : null}
      </Field>
      <Field orientation="horizontal">
        <input
          id={requiredId}
          type="checkbox"
          checked={value.required}
          onChange={(event) => onRequiredChange(event.target.checked)}
        />
        <FieldLabel htmlFor={requiredId}>필수 제출로 지정합니다</FieldLabel>
      </Field>
      {value.submissionType === 'FILE' && onTemplateFile ? (
        <Field>
          <FieldLabel htmlFor={fileId}>양식 파일 (선택)</FieldLabel>
          <Input
            id={fileId}
            type="file"
            accept=".pdf,.hwp,.jpg,.jpeg,.png,.zip"
            aria-invalid={Boolean(errors.templateFile)}
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
          <FieldDescription>
            5MiB 이하 PDF, HWP, JPG, PNG, ZIP. 양식이 없으면 첨부하지 않아도
            됩니다.
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
          <FieldError>{selectionError ?? errors.templateFile}</FieldError>
        </Field>
      ) : null}
      <FieldError>{errors.general}</FieldError>
    </div>
  );
}

function RequirementTypeChoice({
  id,
  checked,
  disabled,
  icon,
  label,
  description,
  onChange,
}: {
  readonly id: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly description: string;
  readonly onChange: () => void;
}) {
  return (
    <label className="grid min-h-control cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-card border border-border p-4 has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
      <input
        id={id}
        className="sr-only"
        type="radio"
        name={`${id.slice(0, id.lastIndexOf('-'))}-submission-type`}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
      <span className="text-primary">{icon}</span>
      <span className="grid gap-1">
        <span className="font-semibold">{label}</span>
        <span className="text-small text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}
