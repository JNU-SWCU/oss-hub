'use client';

import { useId, useRef, useState } from 'react';
import { ImageIcon } from 'lucide-react';
import { ProgramCoverPreview } from './program-cover-preview';
import { Button } from '@/components/ui/button';
import {
  isExternalProgramCover,
  type ProgramCoverSelection,
} from './program-cover-selection';
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
  readonly selection: ProgramCoverSelection;
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const shownError = error ?? serverError;
  const hasImage = Boolean(
    selection || (selection === undefined && currentImageUrl),
  );
  const describedBy = `${id}-hint${shownError ? ` ${id}-error` : ''}`;
  const hint = (
    <FieldDescription id={`${id}-hint`} className="grid gap-1 text-center">
      <span>JPG · PNG · 최대 5 MB</span>
      <span>세로 포스터도 전체가 표시됩니다.</span>
    </FieldDescription>
  );
  return (
    <Field data-slot="program-cover-field">
      <FieldLabel htmlFor={id}>
        대표 이미지{' '}
        <span className="font-normal text-muted-foreground">(선택)</span>
      </FieldLabel>
      <div className="grid w-full justify-items-center gap-4 rounded-card border border-dashed border-border bg-muted/20 p-6 text-center">
        {hasImage ? (
          <>
            <ProgramCoverPreview
              selection={selection}
              currentImageUrl={currentImageUrl}
              name="대표 이미지"
              showCaption={false}
            />
            <p
              className="max-w-full break-all text-body text-muted-foreground"
              role={selection ? 'status' : undefined}
            >
              {isExternalProgramCover(selection)
                ? '공지에서 가져온 이미지'
                : (selection?.name ?? '현재 대표 이미지')}
            </p>
          </>
        ) : (
          <>
            <div className="grid size-14 place-items-center rounded-full bg-muted text-muted-foreground">
              <ImageIcon className="size-7" aria-hidden="true" />
            </div>
            <p className="text-body font-semibold">대표 이미지 업로드</p>
            {hint}
          </>
        )}
        <input
          ref={fileInputRef}
          id={id}
          type="file"
          accept="image/jpeg,image/png,.jpg,.jpeg,.png"
          disabled={disabled}
          tabIndex={-1}
          aria-invalid={Boolean(shownError)}
          aria-describedby={describedBy}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            const message = validateProgramCover(file);
            setError(message);
            if (message === null) onChange(file);
          }}
        />
        <div className="flex flex-wrap justify-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            aria-describedby={describedBy}
            onClick={() => fileInputRef.current?.click()}
          >
            {hasImage ? '이미지 바꾸기' : '이미지 선택'}
          </Button>
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
        {hasImage ? hint : null}
      </div>
      {shownError ? (
        <FieldError id={`${id}-error`} role="alert">
          {shownError}
        </FieldError>
      ) : null}
      {currentImageUrl !== undefined ? (
        <p className="text-small text-muted-foreground">
          변경한 이미지는 저장 후 반영됩니다.
        </p>
      ) : null}
    </Field>
  );
}
