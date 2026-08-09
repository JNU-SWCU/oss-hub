import Link from 'next/link';
import * as React from 'react';
import type { VariantProps } from 'class-variance-authority';

import { StatusBadge, statusBadgeVariants } from '@/components/status-badge';
import { cn } from '@/lib/utils';

/** 카드가 표현하는 업무 상태. 배지 팔레트와 openable 여부를 함께 결정한다. */
export type ProgramCardStatus =
  | 'recruiting'
  | 'in_progress'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'ended'
  | 'upcoming';

/**
 * 업무 상태 → 배지 색상 variant. ProgramCard.dc.html의 `MAP`을 그대로 옮긴다.
 * `ended`·`upcoming`은 둘 다 closed(회색) 톤을 쓴다 — 별도 팔레트가 정의돼
 * 있지 않다(program-list.md 미결 항목).
 */
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
  /** 프로그램 제목 */
  title: string;
  /** 카테고리 · 회차 문구 (예: "SW중심대학사업단 · 2026-2학기") */
  category?: string;
  /** 모집·진행 기간 문구 */
  period?: string;
  /** 업무 상태. 배지 팔레트와 openable(`status !== 'ended'`)을 함께 결정한다. */
  status: ProgramCardStatus;
  /**
   * 배지에 표시할 문구. status와 별개로 호출부가 정확한 텍스트를 정한다 —
   * 같은 status라도 역할에 따라 문구가 갈릴 수 있다(학생 "승인 대기" vs
   * 교직원 "모집중").
   */
  badgeText: string;
  /** 카드 하단 안내 문구. 없으면 표시하지 않는다. */
  note?: string;
  /** note 앞에 붙는 아이콘. 프로토타입 스펙상 'team'만 존재한다. */
  noteIcon?: 'team';
  /**
   * 이동 경로. `status === 'ended'`면 openable이 아니므로 href를 넘겨도
   * 카드는 열리지 않는다(종료된 프로그램은 클릭 자체가 막힌다).
   */
  href?: string;
}

function TeamIcon() {
  return (
    <svg
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

/**
 * 프로그램 요약 카드. ProgramCard.dc.html 스펙을 그대로 옮긴다 — 배지는
 * 카드 우상단에 절대 위치, 종료 카드(`status: 'ended'`)는 openable이 아니라
 * href를 받아도 열리지 않고 "자세히 ›" 푸터도 뜨지 않는다.
 *
 * 색은 전부 semantic 토큰(`--status-*-bg/fg`, `--primary`, `--accent`,
 * `--border`, `--card`)을 통해서만 나온다 — 하드코딩 색상 없음.
 */
function ProgramCard({
  title,
  category,
  period,
  status,
  badgeText,
  note,
  noteIcon,
  href,
  className,
  ...props
}: ProgramCardProps) {
  const openable = status !== 'ended';
  const variant = STATUS_BADGE_VARIANT[status];

  // 배지 자체는 링크 이름에서 빼고(aria-hidden), 제목 앞에 "상태: …" 한 줄로
  // 정리해 넣는다 — 그대로 두면 링크 이름이 "모집중 SW중심대학사업단 · …"처럼
  // 배지 문구와 카테고리가 이어 붙어 어색해진다.
  const srStatusPrefix = openable
    ? `상태: ${badgeText}. `
    : `상태: ${badgeText}. 이 프로그램은 종료되어 더 이상 열람할 수 없습니다. `;

  const content = (
    <>
      <StatusBadge
        aria-hidden="true"
        className="absolute top-4 right-4 font-bold"
        variant={variant}
      >
        {badgeText}
      </StatusBadge>
      {category ? (
        <div className="pr-[88px] break-keep text-[12px] text-muted-foreground">
          {category}
        </div>
      ) : null}
      <div className="text-[17px] font-bold text-pretty tracking-[-0.02em] text-foreground">
        <span className="sr-only">{srStatusPrefix}</span>
        {title}
      </div>
      {period ? (
        <div className="text-[12px] text-muted-foreground tabular-nums">
          {period}
        </div>
      ) : null}
      {note ? (
        <div className="flex items-center gap-[5px] text-[12px] font-[650] text-accent">
          {noteIcon === 'team' ? <TeamIcon /> : null}
          <span>{note}</span>
        </div>
      ) : null}
      <div className="mt-auto flex justify-end pt-3">
        {openable ? (
          <span className="text-[12px] font-[650] text-primary">자세히 ›</span>
        ) : null}
      </div>
    </>
  );

  const cardClassName = cn(
    'relative box-border flex h-full min-h-[170px] flex-col gap-1.5 rounded-card border border-border bg-card p-5',
    openable
      ? 'cursor-pointer transition-[border-color,box-shadow] duration-150 hover:border-ring hover:shadow-[0_2px_8px_rgba(0,26,77,0.08)]'
      : 'cursor-default',
    className,
  );

  // href는 항상 anchor(next/link)에 두고, 임의 div props(...props)는 안쪽
  // div에만 편다 — Link의 prop 타입이 AnchorHTMLAttributes라 div 이벤트
  // 핸들러 타입과 안 맞는다(HTMLDivElement vs HTMLAnchorElement 이벤트).
  if (openable && href) {
    return (
      <Link
        className="block h-full rounded-card outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        href={href}
      >
        <div
          data-slot="program-card"
          data-status={status}
          className={cardClassName}
          {...props}
        >
          {content}
        </div>
      </Link>
    );
  }

  return (
    <div
      data-slot="program-card"
      data-status={status}
      className={cardClassName}
      {...props}
    >
      {content}
    </div>
  );
}

export { ProgramCard };
export type { ProgramCardProps };
