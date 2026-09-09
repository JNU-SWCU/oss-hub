'use client';

import { useEffect, useId, useState } from 'react';
import { ProgramCover } from '@/components';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import { apiPath } from '@/lib/api-client';

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
  readonly name: string;
  readonly disabled?: boolean;
  readonly serverError?: string;
  readonly onChange: (file: File | null | undefined) => void;
}

export function ProgramCoverField({
  selection,
  currentImageUrl,
  name,
  disabled,
  serverError,
  onChange,
}: ProgramCoverFieldProps) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const shownError = error ?? serverError;
  useEffect(() => {
    if (!selection) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(selection);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [selection]);
  const src =
    selection === undefined && currentImageUrl
      ? apiPath(currentImageUrl)
      : preview;
  return (
    <Field data-slot="program-cover-field">
      <FieldLabel htmlFor={id}>
        대표 이미지{' '}
        <span className="font-normal text-muted-foreground">(선택)</span>
      </FieldLabel>
      <div className="grid items-start gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 gap-3">
          <FieldDescription id={`${id}-hint`}>
            JPG·PNG · 5 MB 이하. 세로 포스터도 전체가 표시됩니다.
          </FieldDescription>
          {currentImageUrl !== undefined ? (
            <p className="text-sm text-muted-foreground">
              변경한 이미지는 저장 후 반영됩니다.
            </p>
          ) : null}
          <input
            id={id}
            type="file"
            accept="image/jpeg,image/png,.jpg,.jpeg,.png"
            disabled={disabled}
            aria-invalid={Boolean(shownError)}
            aria-describedby={`${id}-hint${shownError ? ` ${id}-error` : ''}`}
            className="block w-full min-w-0 rounded-control border border-input p-3 text-sm file:mr-3"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              const message = validateProgramCover(file);
              setError(message);
              if (message === null) onChange(file);
            }}
          />
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
              (src ? '현재 대표 이미지' : '선택한 이미지 없음')}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            {src ? (
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
        </div>
        <div className="overflow-hidden rounded-card border border-border bg-card">
          <ProgramCover src={src} />
          <div className="grid gap-1 p-3">
            <p className="text-xs text-muted-foreground">목록 미리보기</p>
            <p className="break-keep text-sm font-semibold">
              {name.trim() || '프로그램명'}
            </p>
          </div>
        </div>
      </div>
    </Field>
  );
}
