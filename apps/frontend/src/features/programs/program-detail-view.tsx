'use client';

import Link from 'next/link';
import { useEffect, type ReactNode } from 'react';
import { EmptyState, PageHeader, StatusBadge } from '@/components';
import { Button } from '@/components/ui/button';
import { ActivityGraphPanel } from './components/activity-graph-panel';
import { MilestoneRow } from './components/milestone-row';
import { MilestoneDocumentSection } from './milestone-document-list';
import {
  categoryLabel,
  formatSeoulDateOnly,
  isPastDue,
} from './program-detail-format';
import { ProgramFactBar, ProgramSummary } from './program-detail-summary';
import { programEditHref } from '@/lib/program-route';
import { programHref } from './program-paths';
import type { ProgramOverview } from './program-overview-api';
import type { ProgramDetail } from './types';

export { ProgramFactBar };

const SIGNUP_ENTRY_HREF = '/signup';

const ACTIVITY_SECTION_ID = 'activity';
const ACTIVITY_HASH = `#${ACTIVITY_SECTION_ID}`;

/**
 * 앵커를 다시 맞춰 주는 창(50ms × 40 ≈ 2초). `admin-access-overlay`의 셸 스크롤
 * 복원과 같은 방식 — 늦게 도착하는 데이터가 레이아웃을 다 밀고 나서 앉을 시간을 번다.
 */
const ACTIVITY_ALIGN_INTERVAL_MS = 50;
const ACTIVITY_ALIGN_TICKS = 40;

/**
 * 스크롤 주도권이 사용자에게 넘어갔다고 볼 입력. `scroll`은 우리가 만든 이동도
 * 똑같이 내보내므로 구분 근거가 되지 못한다.
 */
const SCROLL_HANDOVER_EVENTS = [
  'wheel',
  'touchstart',
  'keydown',
  'pointerdown',
] as const;

/**
 * `/programs/{id}#activity` 로 들어온 진입을 활동 영역까지 데려다 놓는다.
 *
 * 상세는 비동기로 열리고 그 안의 활동 그래프·서류 목록도 각자 늦게 채워진다.
 * 그래서 마운트 직후 한 번만 `scrollIntoView`를 부르면, 셸의 스크롤 칸
 * (`#main-content`)이 아직 내용보다 크지 않아 그 호출이 조용히 아무 일도 하지
 * 못한 채 끝나고, 뒤늦게 자란 레이아웃은 그대로 남는다(#1088). 레이아웃이 앉을
 * 때까지 짧게 다시 맞추되, 사용자가 스스로 스크롤하면 그 자리에서 손을 뗀다.
 */
function useActivityHashScroll(): void {
  useEffect(() => {
    if (window.location.hash !== ACTIVITY_HASH) return;

    let ticks = 0;
    let intervalId = 0;

    const release = (): void => {
      window.clearInterval(intervalId);
      for (const event of SCROLL_HANDOVER_EVENTS) {
        window.removeEventListener(event, release);
      }
    };

    const align = (): void => {
      // 상세가 늦게 열리면 대상도 늦게 생긴다 — 없으면 다음 tick 에 다시 본다.
      document
        .getElementById(ACTIVITY_SECTION_ID)
        ?.scrollIntoView({ block: 'start', inline: 'nearest' });
      ticks += 1;
      if (ticks >= ACTIVITY_ALIGN_TICKS) release();
    };

    intervalId = window.setInterval(align, ACTIVITY_ALIGN_INTERVAL_MS);
    for (const event of SCROLL_HANDOVER_EVENTS) {
      window.addEventListener(event, release, { passive: true });
    }
    align();

    return release;
  }, []);
}

/** 신청 기간 기준 모집중 여부 — 헤더 배지·팩트 바가 함께 참조하는 단일 판정 지점. */
function isRecruiting(period: ProgramDetail['applicationPeriod']): boolean {
  const now = Date.now();
  const startsAt = new Date(period.startsAt).getTime();
  const endsAt = new Date(period.endsAt).getTime();
  return startsAt <= now && now <= endsAt;
}

export function ProgramDetailSkeleton() {
  return (
    <main
      className="mx-auto grid max-w-6xl gap-6 px-4 py-8"
      aria-label="프로그램 상세 불러오는 중"
    >
      <div className="h-24 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      <div className="h-40 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      <div className="h-56 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      <div className="h-36 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
    </main>
  );
}

export function ProgramActions({
  program,
}: {
  readonly program: ProgramDetail;
}) {
  const role = program.viewer.role;
  if (role === null)
    return (
      <Button asChild>
        <Link href={SIGNUP_ENTRY_HREF}>가입하고 신청하기</Link>
      </Button>
    );
  if (role === 'STUDENT' && program.viewer.applicationStatus === null) {
    return (
      <Button asChild>
        <Link href={programHref(program.id, '/apply')}>신청하기</Link>
      </Button>
    );
  }
  if (role === 'STAFF' || role === 'ADMIN') {
    // 신청자 목록은 프로그램 스코프 사이드바에 이미 있는 목적지라, 헤더에서는
    // 중복 노출하지 않는다(#865).
    return (
      <Button asChild variant="outline">
        <Link href={programEditHref(program.id)}>프로그램 편집</Link>
      </Button>
    );
  }
  return null;
}

export function ProgramDetailFailureState({
  kind,
  onRetry,
}: {
  readonly kind: 'not-found' | 'failed';
  readonly onRetry: () => void;
}) {
  if (kind === 'not-found') {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12">
        <EmptyState
          title="프로그램을 찾을 수 없습니다"
          description="삭제되었거나 공개되지 않은 프로그램입니다."
          action={
            <Button asChild variant="outline">
              <Link href="/programs">프로그램 목록으로</Link>
            </Button>
          }
        />
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <EmptyState
        title="프로그램을 불러오지 못했습니다"
        description="잠시 후 다시 시도해 주세요."
        action={
          <Button type="button" onClick={onRetry}>
            다시 시도
          </Button>
        }
      />
    </main>
  );
}

export function ProgramMilestones({
  program,
}: {
  readonly program: ProgramDetail;
}) {
  return (
    <section
      id="milestones"
      className="grid scroll-mt-24 gap-4"
      aria-labelledby="milestones-title"
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          id="milestones-title"
          className="font-heading text-xl font-semibold"
        >
          마일스톤
        </h2>
        <span className="text-sm text-muted-foreground">
          {program.milestones.length}개
        </span>
      </div>
      {program.milestones.length === 0 ? (
        <EmptyState
          title="아직 등록된 마일스톤이 없습니다"
          action={
            program.viewer.role === 'STAFF' ||
            program.viewer.role === 'ADMIN' ? (
              <Button asChild variant="outline">
                <Link href={`${programEditHref(program.id)}#milestones`}>
                  마일스톤 설정
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        program.milestones.map((milestone) => (
          <div key={milestone.id} className="grid gap-3">
            <MilestoneRow
              programId={program.id}
              milestone={milestone}
              viewerRole={program.viewer.role}
              applicationStatus={program.viewer.applicationStatus}
            />
            <MilestoneDocumentSection
              milestoneId={milestone.id}
              viewerRole={program.viewer.role}
              closed={isPastDue(milestone.dueAt)}
            />
          </div>
        ))
      )}
    </section>
  );
}

export function ProgramDetailReadyState({
  program,
  overview = null,
}: {
  readonly program: ProgramDetail;
  /**
   * program-overview 팩트 바 데이터. 비로그인 등으로 조회에 실패하면 null —
   * 이 경우 보여줄 숫자 지표가 없으므로 팩트 바 자체를 그리지 않는다.
   */
  readonly overview?: ProgramOverview | null;
  /**
   * 마일스톤 섹션은 이제 항상 `ProgramMilestones`(팩트 바 + 서류 제출 행)를
   * 그린다 — 승인된 학생 전용 체크리스트로 갈아 끼우던 이전 분기는 milestone
   * documents API 기반 인라인 서류 제출로 대체되었다. 호출부 호환을 위해 이
   * prop 자체는 그대로 받되(기존 caller가 여전히 넘겨도 타입 오류가 나지
   * 않도록) 더는 사용하지 않는다.
   */
  readonly approvedStudentMilestones?: ReactNode;
}) {
  useActivityHashScroll();

  const recruiting = isRecruiting(program.applicationPeriod);

  return (
    <main className="mx-auto grid max-w-6xl gap-8 px-4 py-8">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="break-keep text-2xl sm:text-3xl">
              {program.name}
            </span>
            <StatusBadge variant={recruiting ? 'recruiting' : 'closed'}>
              {recruiting ? '모집중' : '모집 마감'}
            </StatusBadge>
          </span>
        }
        description={`${program.organizer} · ${categoryLabel(program.category)} · ${formatSeoulDateOnly(program.applicationPeriod.startsAt)} ~ ${formatSeoulDateOnly(program.applicationPeriod.endsAt)}`}
        actions={<ProgramActions program={program} />}
      />
      <ProgramSummary program={program} />
      <ProgramFactBar program={program} overview={overview} />
      <ProgramMilestones program={program} />
      <section id={ACTIVITY_SECTION_ID} aria-label="활동 상세">
        <ActivityGraphPanel
          programId={program.id}
          viewerRole={program.viewer.role}
        />
      </section>
    </main>
  );
}
