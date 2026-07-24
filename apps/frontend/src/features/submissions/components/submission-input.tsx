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
import type { SubmissionType } from '../types';

export interface SubmissionInputProps {
  readonly submissionType: SubmissionType;
  /** 연결 저장소 URL — placeholder 안내에만 쓰인다. 없으면 일반 예시를 보여준다. */
  readonly repositoryUrl: string | null;
  readonly input: SubmissionFormInput;
  readonly errors: SubmissionFormErrors;
  readonly disabled?: boolean;
  readonly onTextChange: (value: string) => void;
  readonly onReleaseUrlChange: (value: string) => void;
}

/**
 * #115 유형별 제출 입력 — 최초 제출 폼과 #116 보완 재제출 폼이 공유한다.
 * FILE은 업로드 미지원(fail-closed)이라 입력을 렌더하지 않는다.
 */
export function SubmissionInput({
  submissionType,
  repositoryUrl,
  input,
  errors,
  disabled,
  onTextChange,
  onReleaseUrlChange,
}: SubmissionInputProps) {
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
    case 'REPOSITORY_RELEASE':
      return (
        <Field data-invalid={Boolean(errors.releaseUrl)}>
          <FieldLabel htmlFor="release-url">태그 또는 릴리스 URL *</FieldLabel>
          <Input
            id="release-url"
            type="url"
            value={input.releaseUrl}
            required
            disabled={disabled}
            aria-required="true"
            placeholder={`${repositoryUrl ?? 'https://github.com/owner/repository'}/releases/tag/v1.0.0`}
            aria-invalid={Boolean(errors.releaseUrl)}
            aria-describedby={
              errors.releaseUrl
                ? 'release-url-description release-url-error'
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
      const exhaustiveType: never = submissionType;
      return exhaustiveType;
    }
  }
}
