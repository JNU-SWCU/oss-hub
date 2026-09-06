'use client';

import Link from 'next/link';
import { useEffect, useId, type ReactNode } from 'react';
import {
  EmptyState,
  ListPanel,
  PageHeader,
  SectionHeading,
  StatusBadge,
} from '@/components';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import { ActivityGraphPanel } from './components/activity-graph-panel';
import { MilestoneRow } from './components/milestone-row';
import { MilestoneDocumentSection } from './milestone-document-list';
import {
  programDetailMeta,
  formatSeoulDateOnly,
  isPastDue,
} from './program-detail-format';
import { ProgramFactBar, ProgramSummary } from './program-detail-summary';
import { programEditHref } from '@/lib/program-route';
import { programHref } from './program-paths';
import type { ProgramOverview } from './program-overview-api';
import { getProgramRecruitmentState } from './program-list';
import {
  PROGRAM_LIST_STATUS_LABELS,
  type ProgramDetail,
  type ProgramListItem,
  type ProgramMilestone,
  type ViewerRole,
} from './types';

export { ProgramFactBar };

const SIGNUP_ENTRY_HREF = '/signup';

const ACTIVITY_SECTION_ID = 'activity';
const ACTIVITY_HASH = `#${ACTIVITY_SECTION_ID}`;

/**
 * 마일스톤 이름이 갖는 id. 묶음(`article`)이 이 id 를 `aria-labelledby` 로 가리켜,
 * 화면에서 선으로 그은 경계를 화면 읽기 도구에서도 같은 경계로 들리게 한다.
 */
function milestoneNameId(milestoneId: string): string {
  return `milestone-${milestoneId}-name`;
}

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
 * 못한 채 끝나고, 뒤늦게 자란 레이아웃은 그대로 남는다(#1088). 프로그램 본문의
 * 크기 변화를 따라 다시 맞추되, 사용자가 스스로 스크롤하면 그 자리에서 손을 뗀다.
 */
function useActivityHashScroll(): void {
  useEffect(() => {
    if (window.location.hash !== ACTIVITY_HASH) return;

    const target = document.getElementById(ACTIVITY_SECTION_ID);
    if (target === null) return;

    const layoutRoot = target.closest('main') ?? target;
    const align = (): void => {
      target.scrollIntoView({ block: 'start', inline: 'nearest' });
    };
    const observer = new ResizeObserver(align);

    const release = (): void => {
      observer.disconnect();
      for (const event of SCROLL_HANDOVER_EVENTS) {
        window.removeEventListener(event, release);
      }
    };

    observer.observe(layoutRoot);
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

/**
 * 상세 응답을 목록 판정 함수가 받는 모양으로 옮긴다.
 *
 * 종료 여부를 상세에서 따로 계산하지 않으려는 것이다 — 목록의
 * `getProgramRecruitmentState` 가 이 티켓의 기준값이라(#1092), 같은 프로그램이
 * 목록에서는 「종료」인데 상세에서는 「모집중」으로 남는 일이 구조적으로 생기지
 * 않는다. 운영 기간이 없는 응답은 종료일을 모르는 것이므로 목록의 `endAt: null`
 * 과 같게 「아직 안 끝남」으로 본다.
 */
function asRecruitmentInput(program: ProgramDetail): ProgramListItem {
  return {
    id: program.id,
    name: program.name,
    organizer: program.organizer,
    trackType: program.trackType,
    lifecycle: program.lifecycle,
    applicationStartAt: program.applicationPeriod.startsAt,
    applicationEndAt: program.applicationPeriod.endsAt,
    endAt: program.operatingPeriod?.endsAt ?? null,
    description: program.description,
  };
}

/**
 * 학생이 보는 「종료」. 내린 프로그램(저장된 `ARCHIVED`)과 종료일이 지난 프로그램
 * (날짜에서 파생)을 한 상태로 접는다 — 학생에게는 결과가 같기 때문이고, 「종료」와
 * 「내림」을 갈라 보여 주는 것은 교직원 화면의 몫이다.
 */
function isEnded(program: ProgramDetail): boolean {
  return (
    getProgramRecruitmentState(asRecruitmentInput(program), new Date()) ===
    'ended'
  );
}

/**
 * 제목 옆 배지. 종료를 신청 기간보다 먼저 본다 — 목록이 ARCHIVED 와 지난 종료일을
 * 곧바로 `ended` 로 접는 것과 같은 우선순위이고, 그래야 한 프로그램이 목록과
 * 상세에서 다른 상태로 보이지 않는다(#1092). 종료가 아닐 때의 두 문구는 이 티켓
 * 이전과 같다.
 */
function detailStatusBadge(program: ProgramDetail): {
  readonly variant: 'recruiting' | 'closed';
  readonly label: string;
} {
  if (isEnded(program)) {
    return { variant: 'closed', label: PROGRAM_LIST_STATUS_LABELS.ended };
  }
  return isRecruiting(program.applicationPeriod)
    ? { variant: 'recruiting', label: PROGRAM_LIST_STATUS_LABELS.recruiting }
    : { variant: 'closed', label: '모집 마감' };
}

/**
 * 배지가 말하는 상태(「종료」)와 같은 말로 신청이 막힌 이유를 적는다. 내림과 종료일
 * 경과를 한 문구로 묶는 것이 의도다 — 학생에게 「내림」이라는 운영 개념을 꺼내지
 * 않는다.
 */
const APPLY_BLOCKED_REASON = '종료된 프로그램이라 신청을 받지 않습니다.';

/**
 * 신청을 받지 않는 프로그램의 신청 입구. 버튼을 지우지 않고 흐리게 남긴다
 * (`disabled:opacity-50`) — 입구가 통째로 사라지면 학생은 자기가 잘못 들어온 줄
 * 안다. 대신 왜 못 누르는지를 버튼과 같은 자리에 적는다. `disabled` 버튼은 포인터
 * 이벤트를 받지 못해(`disabled:pointer-events-none`) 툴팁으로는 이유를 전할 수
 * 없으므로, 문구를 화면에 그대로 두고 `aria-describedby` 로 버튼에 묶는다.
 */
function BlockedApplyEntry({ label }: { readonly label: string }) {
  const reasonId = useId();
  return (
    <div className="grid justify-items-start gap-2 sm:justify-items-end">
      <Button type="button" disabled aria-describedby={reasonId}>
        {label}
      </Button>
      <p
        id={reasonId}
        className="text-small text-muted-foreground [word-break:keep-all]"
      >
        {APPLY_BLOCKED_REASON}
      </p>
    </div>
  );
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
  // 서버는 이미 두 갈래로 거부한다 — 내린 프로그램은 APP_020, 신청 기간이 지난
  // 프로그램은 APP_010이다(`applications.service.ts`). 화면이 먼저 알려 줘야
  // 학생이 신청서를 다 채운 뒤에 거절당하지 않는다(#1092).
  const applyBlocked = isEnded(program);
  if (role === null)
    return applyBlocked ? (
      <BlockedApplyEntry label="가입하고 신청하기" />
    ) : (
      <Button asChild>
        <Link href={SIGNUP_ENTRY_HREF}>가입하고 신청하기</Link>
      </Button>
    );
  if (role === 'STUDENT' && program.viewer.applicationStatus === null) {
    return applyBlocked ? (
      <BlockedApplyEntry label="신청하기" />
    ) : (
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

/**
 * 마일스톤 하나가 차지하는 자리. 머리줄(`MilestoneRow`)과 그 마일스톤의 제출
 * 항목을 **한 덩어리로 묶는다.**
 *
 * 예전에는 둘을 `grid gap-3` 로 세워 목록 전체의 `gap-4` 와 나란히 뒀다 — 안쪽
 * 12px, 바깥쪽 16px 이라 어디까지가 한 마일스톤인지 간격만으로는 알 수 없었고,
 * 화면에 그어진 유일한 가로선이 제출 항목 블록의 `border-t` 였다. 즉 선은
 * **마일스톤 안**을 갈랐고 마일스톤 **사이**에는 아무 표시도 없었다. 항목이 늘수록
 * 안쪽이 무거워져 다음 마일스톤이 앞 마일스톤의 꼬리처럼 읽혔다.
 *
 * 그래서 신호를 뒤집는다. 마일스톤 사이에만 선을 긋고(`[&+&]:border-t`), 안쪽
 * 경계는 머리줄의 옅은 바탕(`milestone-row` 의 `bg-muted/60`)이 대신 진다.
 * 이 목록에서 **가로선 하나 = 새 마일스톤**이다. 색을 새로 만들지 않고 간격·선·
 * 묶음만 쓴다.
 *
 * 그 선을 그어 놓고 보니 작성자가 다시 말했다 — 경계는 보이는데 **세부가 한눈에
 * 안 들어온다**. 마일스톤 하나가 제출 항목·판정 사유·제출 이력까지 달고 500px 을
 * 넘게 차지해, 세 개짜리 목록이 화면 두 개 반이 됐다. 그래서 이 묶음은 이제
 * **접힌다**: 머리줄만 서 있고, 누르면 그 아래로 제출 항목이 열린다. 접힌 상태
 * 에서도 이 묶음이 곧 `article` 이라 선과 순번은 그대로 남는다.
 */
function MilestoneGroup({
  program,
  milestone,
  position,
  defaultOpen,
}: {
  readonly program: ProgramDetail;
  readonly milestone: ProgramDetail['milestones'][number];
  readonly position: number;
  /** 첫 화면에서 이 마일스톤만 펼친 채로 연다. `hasSubmissionDetail` 인 것 중 하나뿐이다. */
  readonly defaultOpen: boolean;
}) {
  const contentId = useId();
  const foldable = hasSubmissionDetail(milestone, program.viewer.role);
  const row = (
    <MilestoneRow
      programId={program.id}
      milestone={milestone}
      position={position}
      nameId={milestoneNameId(milestone.id)}
      disclosureContentId={foldable ? contentId : undefined}
      viewerRole={program.viewer.role}
      applicationStatus={program.viewer.applicationStatus}
    />
  );
  const detail = (
    <MilestoneDocumentSection
      milestoneId={milestone.id}
      viewerRole={program.viewer.role}
      closed={isPastDue(milestone.dueAt)}
    />
  );
  const groupProps = {
    role: 'listitem',
    'data-testid': 'milestone-group',
    'aria-labelledby': milestoneNameId(milestone.id),
    className: '[&+&]:border-t-2 [&+&]:border-border',
  } as const;

  if (!foldable) {
    return (
      <article {...groupProps}>
        {row}
        {detail}
      </article>
    );
  }
  return (
    /*
      `asChild` 로 묶음 자체를 접기 뿌리로 삼는다. 뿌리가 `article` 을 감싸는 별도
      `div` 가 되면 묶음들이 더는 서로 형제가 아니라서 `[&+&]:border-t-2` 가 한
      줄도 긋지 못한다 — 앞 커밋이 세운 마일스톤 사이 경계가 조용히 사라진다.
    */
    <Collapsible defaultOpen={defaultOpen} asChild>
      <article {...groupProps}>
        {row}
        {/*
          `forceMount` + `data-[state=closed]:hidden` 는 프로그램 안내 카드가 쓰는
          것과 같은 조합이다. 접혔다고 내용을 걷어내면 다시 펼칠 때마다 목록을
          새로 부르고, 무엇보다 **쓰다 만 제출 입력이 사라진다** — 접었다 편 것이
          입력을 지우는 조작이 되면 안 된다. `hidden` 은 화면 읽기 도구와 탭
          순서에서도 함께 빠지므로 접힌 내용이 몰래 남지 않는다.
        */}
        <CollapsibleContent
          id={contentId}
          className="data-[state=closed]:hidden"
          forceMount
        >
          {detail}
        </CollapsibleContent>
      </article>
    </Collapsible>
  );
}

/**
 * 이 마일스톤이 **열어서 볼 것을 가졌는가.** 제출 항목이 0개이거나 제출 항목을
 * 볼 수 없는 사람(비로그인·가입 미완)에게는 접기를 걸지 않는다 — 눌러도 아무 일이
 * 일어나지 않는 화살표는 「고장」으로 읽힌다.
 *
 * 접지 않기로 한 마일스톤은 예전처럼 제출 항목 블록을 그대로 펼쳐 둔다. 그래서
 * `submissionItemCount` 가 혹시 실제 항목 수와 어긋나더라도 **내용이 감춰지는
 * 쪽으로는 틀리지 않는다** — 최악이 「접히지 않는 마일스톤」이지 「사라진 제출
 * 항목」이 아니다.
 */
function hasSubmissionDetail(
  milestone: ProgramMilestone,
  viewerRole: ViewerRole,
): boolean {
  if (viewerRole === null || viewerRole === 'PENDING') return false;
  return milestone.submissionItemCount > 0;
}

/**
 * 첫 화면에서 펼쳐 둘 마일스톤 하나.
 *
 * 전부 접으면 학생은 「지금 낼 것」을 보기까지 한 번을 더 눌러야 하고, 그 한 번은
 * 이 화면에 온 사람 거의 모두가 치르는 비용이다. 반대로 다 펼치면 작성자가 지적한
 * 상태 그대로다. 그래서 **지금 차례인 하나만** 연다.
 *
 * 차례는 마감으로 정한다(마감이 아직 지나지 않은 첫 마일스톤, 전부 지났으면 마지막 것).
 * 마감은 역할과 무관하게 모두에게 같은 축이고, 무엇보다 **화면이 이미 배지로 말하고
 * 있는 값**이다 — 「D-10 짜리가 열려 있다」는 화면만 보고 설명이 되지만, 제출
 * 상태로 골랐다면 왜 그것이 열렸는지 배지만으로는 알 수 없다.
 *
 * ⚠ 「지났는가」는 `dDay` 가 아니라 `dueAt` 으로 묻는다. `dDay` 는 백엔드가 서울
 *   기준 **달력 날짜** 차로 계산하므로(`program-deadline.ts` 의 `calendarDayNumber`),
 *   오늘 09시에 닫힌 마감도 그날이 끝날 때까지 `dDay === 0` 이다. 그 값으로 고르면
 *   **이미 닫힌 마일스톤을 펼쳐 두고** 정작 다음에 낼 것은 접어 둔다 — 이 화면이
 *   여는 하나로 「지금 낼 것」을 가리키겠다는 약속과 정반대다.
 *
 *   같은 화면이 제출 입력을 잠글 때는 이미 시각까지 보는 `isPastDue(dueAt)` 를
 *   쓴다(위 `MilestoneGroup` 의 `closed`). 펼칠 대상도 같은 예측자로 골라야
 *   **열려 있는 마일스톤과 지금 제출할 수 있는 마일스톤이 갈리지 않는다.**
 *
 * 고를 대상은 접히는 마일스톤뿐이다. 접히지 않는 것을 골라 봐야 열 것이 없어,
 * 결과적으로 전부 접힌 화면이 된다.
 */
function initiallyOpenMilestoneId(program: ProgramDetail): string | null {
  const foldable = program.milestones.filter((milestone) =>
    hasSubmissionDetail(milestone, program.viewer.role),
  );
  if (foldable.length === 0) return null;
  const current = foldable.find((milestone) => !isPastDue(milestone.dueAt));
  return (current ?? foldable[foldable.length - 1]).id;
}

export function ProgramMilestones({
  program,
}: {
  readonly program: ProgramDetail;
}) {
  const openMilestoneId = initiallyOpenMilestoneId(program);
  return (
    <section
      id="milestones"
      className="grid scroll-mt-24 gap-4"
      aria-labelledby="milestones-title"
    >
      <SectionHeading
        id="milestones-title"
        title="마일스톤"
        meta={`${program.milestones.length}개`}
      />
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
        /*
          목록은 카드 하나 안에 쌓는다(`ListPanel`). 마일스톤마다 카드를 두면
          테두리가 개수만큼 생겨 목록 자체의 윤곽이 사라진다 — 같은 성격의 항목이
          순서대로 이어지는 자리의 규약이고, 마일스톤 타임라인 화면도 같은 형태다.
          바깥 테두리가 서면 그 안의 가로선이 비로소 「경계」로 읽힌다.
        */
        <ListPanel role="list">
          {program.milestones.map((milestone, index) => (
            <MilestoneGroup
              key={milestone.id}
              program={program}
              milestone={milestone}
              position={index + 1}
              defaultOpen={milestone.id === openMilestoneId}
            />
          ))}
        </ListPanel>
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

  const badge = detailStatusBadge(program);

  return (
    <main className="mx-auto grid max-w-6xl gap-8 px-4 py-8">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="break-keep text-2xl sm:text-3xl">
              {program.name}
            </span>
            <StatusBadge variant={badge.variant}>{badge.label}</StatusBadge>
          </span>
        }
        description={programDetailMeta(program)}
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
