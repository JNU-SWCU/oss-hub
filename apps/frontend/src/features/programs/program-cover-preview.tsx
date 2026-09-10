'use client';

import { useEffect, useState } from 'react';
import { ProgramCover } from '@/components';
import { apiPath } from '@/lib/api-client';

export function ProgramCoverPreview({
  selection,
  currentImageUrl,
  name,
}: {
  readonly selection: File | null | undefined;
  readonly currentImageUrl?: string | null;
  readonly name: string;
}) {
  const [preview, setPreview] = useState<string | null>(null);
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
    <div
      data-slot="program-cover-preview"
      className="w-full overflow-hidden rounded-card border border-border bg-card"
    >
      <ProgramCover src={src} />
      <div className="grid gap-1 p-3">
        <p className="text-xs text-muted-foreground">목록 미리보기</p>
        <p className="break-keep text-sm font-semibold">
          {name.trim() || '프로그램명'}
        </p>
      </div>
    </div>
  );
}
