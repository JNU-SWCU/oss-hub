'use client';

import { useState } from 'react';
import { ImageIcon, Maximize2, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ProgramCoverProps {
  readonly src: string | null;
  readonly title?: string;
  readonly size?: 'card' | 'thumbnail' | 'detail';
  readonly className?: string;
}

export function ProgramCover({
  src,
  title = '프로그램',
  size = 'card',
  className,
}: ProgramCoverProps) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const available = src !== null && failedSource !== src;
  const image = (
    <div
      data-slot="program-cover"
      data-cover-state={available ? 'image' : src === null ? 'empty' : 'error'}
      className={cn(
        'relative flex aspect-video items-center justify-center overflow-hidden bg-muted text-primary/50',
        size === 'thumbnail' && 'w-24 shrink-0 rounded-md',
        size === 'detail' && 'rounded-card border border-border',
        className,
      )}
    >
      {available ? (
        // Request the versioned API route directly so current program visibility is checked before streaming.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading={size === 'detail' ? 'eager' : 'lazy'}
          decoding="async"
          className="absolute inset-0 h-full w-full object-contain"
          onError={() => setFailedSource(src)}
        />
      ) : (
        <span className="flex flex-col items-center gap-2" aria-hidden="true">
          <ImageIcon className={size === 'thumbnail' ? 'size-6' : 'size-10'} />
          {size !== 'thumbnail' ? (
            <span className="text-xs font-semibold">OSS Hub</span>
          ) : null}
        </span>
      )}
    </div>
  );

  if (size !== 'detail' || !available) return image;

  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="group relative block w-full rounded-card focus-visible:outline-2 focus-visible:outline-ring"
          aria-label={`${title} 대표 이미지 크게 보기`}
        >
          {image}
          <span className="absolute right-3 bottom-3 flex items-center gap-1 rounded-md bg-background/95 px-2 py-1 text-xs">
            <Maximize2 className="size-3.5" aria-hidden="true" /> 크게 보기
          </span>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/60" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-4 z-50 flex flex-col gap-3 rounded-xl bg-background p-4 sm:inset-8"
        >
          <div className="flex items-center justify-between gap-4">
            <Dialog.Title className="min-w-0 break-keep text-base font-semibold">
              {title} 대표 이미지
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="이미지 닫기"
              >
                <X aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={`${title} 대표 이미지`}
            onError={() => setFailedSource(src)}
            className="min-h-0 flex-1 object-contain"
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
