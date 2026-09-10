'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';

export const PROGRAM_COVER_MAX_BYTES = 5 * 1024 * 1024;

export function validateProgramCover(
  file: Pick<File, 'name' | 'type' | 'size'>,
): string | null {
  const jpg = /\.jpe?g$/i.test(file.name) && file.type === 'image/jpeg';
  const png = /\.png$/i.test(file.name) && file.type === 'image/png';
  if (!jpg && !png) return 'JPG 또는 PNG 이미지를 선택해 주세요.';
  if (file.size === 0)
    return '빈 파일은 사용할 수 없습니다. 다른 이미지를 선택해 주세요.';
  if (file.size > PROGRAM_COVER_MAX_BYTES)
    return '5 MB 이하의 이미지를 선택해 주세요.';
  return null;
}

export interface ProgramCoverFieldProps {
  readonly selection: File | null | undefined;
  readonly currentImageUrl?: string | null;
  readonly disabled?: boolean;
  readonly serverError?: string;
  readonly onChange: (file: File | null | undefined) => void;
}

export function ProgramCoverField({
  selection,
  currentImageUrl,
  disabled,
  serverError,
  onChange,
}: ProgramCoverFieldProps) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const shownError = error ?? serverError;
  const hasImage = Boolean(
    selection || (selection === undefined && currentImageUrl),
  );
  return (
    <Field data-slot="program-cover-field">
      <FieldLabel htmlFor={id}>
        대표 이미지{' '}
        <span className="font-normal text-muted-foreground">(선택)</span>
      </FieldLabel>
      <div className="flex flex-wrap items-center gap-2">
        <div
          data-disabled={disabled || undefined}
          className="relative inline-flex min-h-control w-fit items-center rounded-control border border-input px-3 text-sm focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring data-[disabled=true]:opacity-50"
        >
          <span aria-hidden="true">이미지 선택</span>
          <input
            id={id}
            type="file"
            accept="image/jpeg,image/png,.jpg,.jpeg,.png"
            disabled={disabled}
            aria-invalid={Boolean(shownError)}
            aria-describedby={`${id}-hint${shownError ? ` ${id}-error` : ''}`}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              const message = validateProgramCover(file);
              setError(message);
              if (message === null) onChange(file);
            }}
          />
        </div>
        {hasImage ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => {
              setError(null);
              onChange(null);
            }}
          >
            이미지 제거
          </Button>
        ) : null}
        {currentImageUrl && selection !== undefined ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => {
              setError(null);
              onChange(undefined);
            }}
          >
            기존 이미지로 되돌리기
          </Button>
        ) : null}
      </div>
      {shownError ? (
        <FieldError id={`${id}-error`} role="alert">
          {shownError}
        </FieldError>
      ) : null}
      <p
        className="break-all text-sm text-muted-foreground"
        role={selection ? 'status' : undefined}
      >
        {selection?.name ??
          (hasImage ? '현재 대표 이미지' : '선택한 이미지 없음')}
      </p>
      <FieldDescription id={`${id}-hint`}>
        JPG·PNG · 5 MB 이하. 세로 포스터도 전체가 표시됩니다.
      </FieldDescription>
      {currentImageUrl !== undefined ? (
        <p className="text-sm text-muted-foreground">
          변경한 이미지는 저장 후 반영됩니다.
        </p>
      ) : null}
    </Field>
  );
}
