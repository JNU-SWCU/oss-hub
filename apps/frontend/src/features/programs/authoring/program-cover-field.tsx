'use client';

import { useId, useRef, useState } from 'react';
import { ImageIcon } from 'lucide-react';
import { ProgramCoverPreview } from './program-cover-preview';
import { Button } from '@/components/ui/button';
import {
  isExternalProgramCover,
  type ProgramCoverSelection,
} from './program-cover-selection';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { programCoverCardFrame } from '@/components/program/program-cover';
import { cn } from '@/lib/utils';

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
  readonly onChange: (file: File | null) => void;
}

const COVER_ACTION_CLASS =
  'bg-foreground/80 text-background hover:bg-foreground/90';

const COVER_DROPZONE_CLASS = cn(
  programCoverCardFrame,
  'h-auto flex-col rounded-card border-dashed bg-muted/20 text-muted-foreground hover:bg-muted/40',
);

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
  const openPicker = () => fileInputRef.current?.click();
  return (
    <Field data-slot="program-cover-field">
      <FieldLabel htmlFor={id}>대표 이미지</FieldLabel>
      <div className="relative max-w-56">
        {hasImage ? (
          <>
            <ProgramCoverPreview
              selection={selection}
              currentImageUrl={currentImageUrl}
              name="대표 이미지"
              showCaption={false}
            />
            <p className="sr-only" role={selection ? 'status' : undefined}>
              {isExternalProgramCover(selection)
                ? '공지에서 가져온 이미지'
                : (selection?.name ?? '현재 대표 이미지')}
            </p>
            <div className="absolute top-2 right-2 flex gap-1.5">
              <Button
                type="button"
                size="sm"
                disabled={disabled}
                aria-label="대표 이미지 교체"
                aria-describedby={describedBy}
                className={COVER_ACTION_CLASS}
                onClick={openPicker}
              >
                교체
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={disabled}
                aria-label="대표 이미지 삭제"
                className={COVER_ACTION_CLASS}
                onClick={() => {
                  setError(null);
                  onChange(null);
                }}
              >
                삭제
              </Button>
            </div>
          </>
        ) : (
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            aria-describedby={describedBy}
            className={COVER_DROPZONE_CLASS}
            onClick={openPicker}
          >
            <ImageIcon className="size-7" aria-hidden="true" />
            이미지 올리기
          </Button>
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
        <p id={`${id}-hint`} className="sr-only">
          JPG · PNG · 최대 5 MB
        </p>
      </div>
      {shownError ? (
        <FieldError id={`${id}-error`} role="alert">
          {shownError}
        </FieldError>
      ) : null}
    </Field>
  );
}
