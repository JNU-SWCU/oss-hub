import { ListCard } from '@/components/list-card';
import { ProgramCover } from '@/components/program-cover';
import { programCoverSource } from '@/components/program-cover-source';
import * as React from 'react';
import type { VariantProps } from 'class-variance-authority';

import { statusBadgeVariants } from '@/components/status-badge';

export type ProgramCardStatus =
  | 'recruiting'
  | 'in_progress'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'ended'
  | 'upcoming';

const STATUS_BADGE_VARIANT: Readonly<
  Record<ProgramCardStatus, VariantProps<typeof statusBadgeVariants>['variant']>
> = {
  recruiting: 'recruiting',
  in_progress: 'approved',
  pending: 'pending',
  approved: 'approved',
  rejected: 'rejected',
  ended: 'closed',
  upcoming: 'closed',
};

interface ProgramCardProps extends Omit<
  React.ComponentProps<'div'>,
  'title' | 'children'
> {
  title: string;
  coverImageUrl?: string | null;

  category?: string;

  period?: string;

  status: ProgramCardStatus;

  badgeText: string;

  note?: string;

  noteIcon?: 'team';

  href?: string;
}

function TeamIcon() {
  return (
    <svg
      data-slot="program-card-note-icon"
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3.5 shrink-0"
    >
      <circle cx={9} cy={8} r={3} />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M16 6.5a3 3 0 0 1 0 5.8" />
      <path d="M18 20a6 6 0 0 0-2-4.5" />
    </svg>
  );
}

function ProgramCard({
  title,
  coverImageUrl,
  category,
  period,
  status,
  badgeText,
  note,
  noteIcon,
  href,
  ...props
}: ProgramCardProps) {
  const srStatusPrefix =
    status === 'ended'
      ? `상태: ${badgeText}. 신청은 마감되었습니다. `
      : `상태: ${badgeText}. `;

  return (
    <ListCard
      {...props}
      data-slot="program-card"
      data-status={status}
      title={title}
      subtitle={category}
      badge={{ text: badgeText, variant: STATUS_BADGE_VARIANT[status] }}
      statusDescription={srStatusPrefix}
      cover={<ProgramCover src={programCoverSource(coverImageUrl)} />}
      meta={period}
      note={
        note ? (
          <span className="flex items-center gap-1.5">
            {noteIcon === 'team' ? <TeamIcon /> : null}
            <span>{note}</span>
          </span>
        ) : undefined
      }
      href={href}
    />
  );
}

export { ProgramCard };
