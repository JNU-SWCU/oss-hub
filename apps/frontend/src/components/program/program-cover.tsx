'use client';

import { useState } from 'react';
import Image from 'next/image';
import { ImageIcon, Maximize2, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type ProgramCoverProps = {
  readonly src: string | null;
  readonly title?: string;
  readonly priority?: boolean;
  readonly className?: string;
} & (
  | { readonly size?: 'card'; readonly sizes: string }
  | { readonly size: 'thumbnail' | 'detail'; readonly sizes?: string }
);

export const programCoverCardFrame = 'aspect-[1/1.414] w-full rounded-md';

const RENDERED_WIDTH = {
  thumbnail: '96px',
  detail: '180px',
} as const;

interface CoverFailure {
  readonly src: string;
  readonly stage: 'optimized' | 'original';
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
  sizes,
  priority = false,
  className,
}: ProgramCoverProps) {
  const [failure, setFailure] = useState<CoverFailure | null>(null);
  const failedStage = failure?.src === src ? failure.stage : null;
  const available = src !== null && failedStage !== 'original';
  const optimized = src?.startsWith('/') === true && failedStage === null;
  const failedStageNow = optimized ? 'optimized' : 'original';
  const imageSizes = size === 'card' ? sizes : (sizes ?? RENDERED_WIDTH[size]);
  const image = (
    <div
      data-slot="program-cover"
      data-cover-state={available ? 'image' : src === null ? 'empty' : 'error'}
      className={cn(
        'relative flex items-center justify-center overflow-hidden bg-muted text-primary/50',
        size === 'thumbnail' && 'aspect-video w-24 shrink-0 rounded-md',
        size === 'card' && programCoverCardFrame,
        size === 'detail' && '@container rounded-card border border-border',
        size === 'detail' && !available && 'aspect-[1/1.414]',
        className,
      )}
    >
      {available ? (
        size === 'detail' ? (
          <Image
            src={src}
            alt=""
            width={0}
            height={0}
            sizes={imageSizes}
            priority
            fetchPriority="high"
            unoptimized={!optimized}
            referrerPolicy="no-referrer"
            className="block h-auto max-h-[141.4cqw] w-full object-cover object-top"
            onError={() => setFailure({ src, stage: failedStageNow })}
          />
        ) : (
          <Image
            src={src}
            alt=""
            fill
            sizes={imageSizes}
            priority={priority}
            fetchPriority={priority ? 'high' : undefined}
            unoptimized={!optimized}
            referrerPolicy="no-referrer"
            className="object-contain"
            onError={() => setFailure({ src, stage: failedStageNow })}
          />
        )
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
        className="group relative block w-full cursor-zoom-in rounded-card focus-visible:outline-2 focus-visible:outline-ring"
        aria-label={`${title} 대표 이미지 크게 보기`}
      >
        {image}
        <span
          data-slot="program-cover-zoom"
          className="absolute right-2 bottom-2 flex size-7 items-center justify-center rounded-full bg-foreground/60 text-background"
        >
          <Maximize2 className="size-3.5" aria-hidden="true" />
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

          <div className="relative min-h-0 flex-1">
            <Image
              src={src}
              alt={`${title} 대표 이미지`}
              fill
              unoptimized
              referrerPolicy="no-referrer"
              className="object-contain"
              onError={() => setFailure({ src, stage: 'original' })}
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
