'use client';

import { useEffect, useState } from 'react';
import { ProgramCover } from '@/components';
import { programCoverSource } from '@/components/program-cover-source';
import {
  isExternalProgramCover,
  type ProgramCoverSelection,
} from './program-cover-selection';

export function ProgramCoverPreview({
  selection,
  currentImageUrl,
  name,
  showCaption = true,
}: {
  readonly selection: ProgramCoverSelection;
  readonly currentImageUrl?: string | null;
  readonly name: string;
  readonly showCaption?: boolean;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!selection || isExternalProgramCover(selection)) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(selection);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [selection]);
  const src = isExternalProgramCover(selection)
    ? programCoverSource(selection.imageUrl)
    : selection === undefined && currentImageUrl
      ? programCoverSource(currentImageUrl)
      : preview;
  return (
    <div
      data-slot="program-cover-preview"
      className="w-full overflow-hidden rounded-card border border-border bg-card"
    >
      <ProgramCover src={src} />
      {showCaption ? (
        <div className="grid gap-1 p-3">
          <p className="text-xs text-muted-foreground">목록 미리보기</p>
          <p className="break-keep text-sm font-semibold">
            {name.trim() || '프로그램명'}
          </p>
        </div>
      ) : null}
    </div>
  );
}
