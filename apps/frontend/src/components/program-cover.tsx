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

function DefaultCover() {
  return (
    <svg
      viewBox="0 0 200 283"
      className="size-full"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="200" height="283" className="fill-primary/10" />
      <circle cx="128" cy="96" r="64" className="fill-primary/25" />
      <rect
        x="44"
        y="132"
        width="78"
        height="78"
        rx="16"
        transform="rotate(-12 83 171)"
        className="fill-accent/20"
      />
      <circle cx="158" cy="186" r="20" className="fill-primary" />
      <circle cx="58" cy="54" r="11" className="fill-chart-2" />
      <path d="M128 214 l16 -27 l16 27 z" className="fill-chart-4" />
      <text x="22" y="252" fontSize="24" className="fill-primary font-semibold">
        OSS Hub
      </text>
      <rect
        x="22"
        y="262"
        width="48"
        height="5"
        rx="2.5"
        className="fill-chart-2"
      />
    </svg>
  );
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
        'relative flex items-center justify-center overflow-hidden bg-muted text-primary/50',
        size === 'thumbnail' && 'aspect-video w-24 shrink-0 rounded-md',
        size === 'card' && 'aspect-[1/1.414]',
        size === 'detail' && '@container rounded-card border border-border',
        size === 'detail' && !available && 'aspect-[1/1.414]',
        className,
      )}
    >
      {available ? (
        <img
          src={src}
          referrerPolicy="no-referrer"
          alt=""
          loading={size === 'detail' ? 'eager' : 'lazy'}
          decoding="async"
          className={
            size === 'detail'
              ? 'block h-auto max-h-[141.4cqw] w-full object-cover object-top'
              : 'absolute inset-0 h-full w-full object-contain'
          }
          onError={() => setFailedSource(src)}
        />
      ) : size === 'thumbnail' ? (
        <ImageIcon className="size-6" aria-hidden="true" />
      ) : (
        <DefaultCover />
      )}
    </div>
  );

  if (size !== 'detail' || !available) return image;

  return (
    <Dialog.Root>
      <Dialog.Trigger
        className="group relative block w-full rounded-card focus-visible:outline-2 focus-visible:outline-ring"
        aria-label={`${title} 대표 이미지 크게 보기`}
      >
        {image}
        <span className="absolute right-3 bottom-3 flex items-center gap-1 rounded-md bg-background/95 px-2 py-1 text-xs">
          <Maximize2 className="size-3.5" aria-hidden="true" /> 크게 보기
        </span>
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

          <img
            src={src}
            referrerPolicy="no-referrer"
            alt={`${title} 대표 이미지`}
            onError={() => setFailedSource(src)}
            className="min-h-0 flex-1 object-contain"
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
