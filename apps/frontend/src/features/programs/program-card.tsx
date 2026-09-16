import { ListCard } from '@/components/list-card';
import { ProgramCover } from '@/components/program-cover';
import { apiPath } from '@/lib/api-client';
import * as React from 'react';
import type { VariantProps } from 'class-variance-authority';

import { statusBadgeVariants } from '@/components/status-badge';

/** 카드가 표현하는 업무 상태. 배지 팔레트를 결정한다. */
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
  coverImageUrl?: string | null;
  /** 카테고리 · 회차 문구 (예: "SW중심대학사업단 · 2026-2학기") */
  category?: string;
  /** 모집·진행 기간 문구 */
  period?: string;
  /** 업무 상태. 배지 팔레트를 결정한다. `ended`도 상세 열람은 허용된다 — 신청 등 쓰기만 백엔드 lifecycle이 막는다. */
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
   * 이동 경로. 넘기면 카드 전체가 링크가 된다 — `ended`를 포함해 status와
   * 무관하게 href가 있으면 항상 openable이다(백엔드는 ARCHIVED 상세 읽기를
   * 이미 허용한다; 신청 등 쓰기만 각 쓰기 경로에서 lifecycle로 거부한다).
   */
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

/** 프로그램 데이터와 상태 설명을 공용 목록 카드에 연결한다. */
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
      cover={
        <ProgramCover src={coverImageUrl ? apiPath(coverImageUrl) : null} />
      }
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
export type { ProgramCardProps };
