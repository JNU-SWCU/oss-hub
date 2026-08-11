import { FileText, Upload } from 'lucide-react';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { formatFileSize } from '@/lib/format-file-size';
import {
  SUBMISSION_FILE_ACCEPT,
  type SubmissionFormErrors,
  type SubmissionFormInput,
} from '../submission-form';
import type { SubmissionType } from '../types';

export interface SubmissionInputProps {
  readonly submissionType: SubmissionType;
  readonly input: SubmissionFormInput;
  readonly errors: SubmissionFormErrors;
  readonly disabled?: boolean;
  readonly file?: File | null;
  readonly fileError?: string | null;
  readonly onTextChange: (value: string) => void;
  readonly onFileChange?: (file: File | null) => void;
}

interface FileSelectionControl {
  readonly files: { item(index: number): File | null } | null;
}

export function selectedFileFromControl(
  control: FileSelectionControl,
): File | null {
  return control.files?.item(0) ?? null;
}

/**
 * #115 유형별 제출 입력 — 최초 제출 폼과 #116 보완 재제출 폼이 공유한다.
 * FILE handler가 없는 보완 재제출 폼은 입력을 렌더하지 않아 fail-closed한다.
 */
export function SubmissionInput({
  submissionType,
  input,
  errors,
  disabled,
  file,
  fileError,
  onTextChange,
  onFileChange,
}: SubmissionInputProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  switch (submissionType) {
    case 'TEXT':
      return (
        <Field data-invalid={Boolean(errors.text)}>
          <FieldLabel htmlFor="submission-text">제출 내용 *</FieldLabel>
          <textarea
            id="submission-text"
            value={input.text}
            required
            disabled={disabled}
            aria-required="true"
            aria-invalid={Boolean(errors.text)}
            aria-describedby={errors.text ? 'submission-text-error' : undefined}
            onChange={(event) => onTextChange(event.target.value)}
            className="min-h-48 w-full resize-y rounded-lg border border-input bg-transparent p-3 text-sm leading-6 transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 disabled:cursor-not-allowed disabled:opacity-50"
          />
          <FieldError id="submission-text-error">{errors.text}</FieldError>
        </Field>
      );
    case 'FILE': {
      if (!onFileChange) return null;
      // `errors.file`도 함께 본다. 파일 오류를 담는 자리가 둘(`fileError`·`errors.file`)
      // 인데 이 갈래는 앞의 것만 그려, 뒤의 것만 채운 호출부에서는 제출이 막히고도
      // 화면에 아무 말이 없었다 — 눌러도 아무 일이 없는 것처럼 보인다.
      const fileMessage = fileError ?? errors.file ?? null;
      return (
        <div
          className="grid min-w-0 gap-0"
          data-testid="file-submission-steps"
          aria-label="파일 제출 단계"
        >
          <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3">
            <div className="flex flex-col items-center" aria-hidden="true">
              <span className="grid size-8 place-items-center rounded-full border border-primary/30 bg-background text-sm font-semibold text-primary">
                1
              </span>
              <span className="h-full w-px bg-border" />
            </div>
            <Field data-invalid={Boolean(fileMessage)} className="min-w-0 pb-6">
              <FieldLabel htmlFor="submission-file">1. 파일 선택 *</FieldLabel>
              <Input
                id="submission-file"
                ref={fileInputRef}
                type="file"
                disabled={disabled}
                aria-required="true"
                aria-invalid={Boolean(fileMessage)}
                aria-describedby="submission-file-description submission-file-error"
                accept={SUBMISSION_FILE_ACCEPT}
                onChange={(event) =>
                  onFileChange(selectedFileFromControl(event.currentTarget))
                }
              />
              <span className="inline-flex items-center gap-2 text-sm font-medium">
                <Upload aria-hidden="true" className="size-4" />
                {file ? '파일 바꾸기' : '파일 선택하기'}
              </span>
              <FieldDescription id="submission-file-description">
                PDF, HWP, JPG, PNG, ZIP · 최대 5MB
              </FieldDescription>
              <FieldError id="submission-file-error">{fileMessage}</FieldError>
            </Field>
          </div>

          <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3">
            <div className="flex flex-col items-center" aria-hidden="true">
              <span className="grid size-8 place-items-center rounded-full border border-primary/30 bg-background text-sm font-semibold text-primary">
                2
              </span>
              <span className="h-full w-px bg-border" />
            </div>
            <div className="grid min-w-0 gap-2 pb-6">
              <p className="text-sm font-medium">2. 선택 확인</p>
              {file ? (
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 p-3">
                  <p
                    className="flex min-w-0 items-center gap-2 text-sm"
                    aria-live="polite"
                  >
                    <FileText aria-hidden="true" className="size-4 shrink-0" />
                    <span className="min-w-0 truncate">{file.name}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {formatFileSize(file.size)}
                    </span>
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={disabled}
                    onClick={() => {
                      if (fileInputRef.current) fileInputRef.current.value = '';
                      onFileChange(null);
                    }}
                  >
                    선택 취소
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  선택한 파일이 여기에 표시됩니다.
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3">
            <span
              className="grid size-8 place-items-center rounded-full border border-primary/30 bg-background text-sm font-semibold text-primary"
              aria-hidden="true"
            >
              3
            </span>
            <div className="grid min-w-0 gap-1">
              <p className="text-sm font-medium">3. 제출</p>
              <p className="text-sm break-keep text-muted-foreground">
                파일과 코멘트를 확인한 뒤 아래 제출하기 버튼을 누르세요.
              </p>
            </div>
          </div>
        </div>
      );
    }
    default: {
      const exhaustiveType: never = submissionType;
      return exhaustiveType;
    }
  }
}
