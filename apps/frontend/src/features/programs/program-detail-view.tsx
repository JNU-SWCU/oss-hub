'use client';

import Link from 'next/link';
import { useEffect, useRef, type ReactNode } from 'react';
import { EmptyState, PageHeader, StatusBadge } from '@/components';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ActivityGraphPanel } from './components/activity-graph-panel';
import { MilestoneRow } from './components/milestone-row';
import { MilestoneDocumentSection } from './milestone-document-list';
import {
  categoryLabel,
  formatSeoulDate,
  formatSeoulDateOnly,
} from './program-detail-format';
import { programApplicantsHref, programEditHref } from '@/lib/program-route';
import { programHref } from './program-paths';
import type { ProgramOverview } from './program-overview-api';
import type { ProgramDetail } from './types';

const SIGNUP_ENTRY_HREF = '/signup';

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
    return (
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <Link href={programApplicantsHref(program.id)}>신청자 목록</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={programEditHref(program.id)}>편집</Link>
        </Button>
      </div>
    );
  }
  return null;
}

function ProgramSummary({ program }: { readonly program: ProgramDetail }) {
  const now = Date.now();
  const startsAt = new Date(program.applicationPeriod.startsAt).getTime();
  const endsAt = new Date(program.applicationPeriod.endsAt).getTime();
  const recruiting = startsAt <= now && now <= endsAt;
  return (
    <Card>
      <CardHeader>
        <CardTitle>프로그램 안내</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {/* 넓은 화면에서 세 항목을 왼쪽으로 붙인다(QA32). 예전 템플릿은
            `auto minmax(0,1fr) auto` 세 칸이라 가운데 `1fr` 이 남는 폭을 통째로 먹고
            셋째 항목을 카드 오른쪽 끝으로 밀어냈다 — 1280px 실측에서 「신청기간」
            글자가 x=842 에서 끝나는데 「유형」은 x=1176 에서 시작해 334px 이 비었다.
            앞 두 항목은 24px(`gap-x-6`)로 붙어 있는데 셋째만 멀리 떨어져 보이는
            이유가 그것이다.

            ⚠ **칸을 다시 배정하는 길로는 못 푼다.** 세 칸을 유지하면 같은 결함이
            돌아오고, `auto auto minmax(0,1fr)` 로 남는 폭을 마지막으로 옮기면
            1024px 에서 긴 주관기관명이 들어왔을 때 「유형」이 **폭 0 으로 찌그러진다**
            (`minmax(0,auto)` 로 바꿔도 같았다 — 앞 칸들이 먼저 자리를 차지한다).
            그래서 넓은 화면에서는 칸을 열지 않고 흐르게 두고, 폭이 모자라면 줄을
            바꾼다. 정상 내용에서는 1024~1920px 전부 한 줄이고 카드 높이도 196px
            그대로다(수정 전과 같다).

            요청자는 「유형을 아래 줄로」를 제안했지만, 그러면 오른쪽 빈 곳은 남은 채
            카드만 28px 높아진다 — 세 안을 실제 화면으로 비교한 뒤 이쪽으로 정했다.
            좁은 화면(375·768px)은 손대지 않았다. */}
        <div className="grid min-w-0 gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:flex lg:flex-wrap">
          <span className="min-w-0 break-words">
            <strong>주관기관</strong> {program.organizer}
          </span>
          <span className="min-w-0 break-words">
            <strong>신청기간</strong>{' '}
            {formatSeoulDate(program.applicationPeriod.startsAt)} ~{' '}
            {formatSeoulDate(program.applicationPeriod.endsAt)}
          </span>
          <span className="min-w-0 break-words">
            <strong>유형</strong> {categoryLabel(program.category)}
          </span>
        </div>
        <p className="text-sm leading-6 break-keep whitespace-pre-wrap">
          {program.description}
        </p>
        <StatusBadge variant={recruiting ? 'recruiting' : 'closed'}>
          {recruiting ? '모집중' : '모집 마감'}
        </StatusBadge>
      </CardContent>
    </Card>
  );
}

/**
 * 팩트 바 — 프로그램 상세 요약 스트립. 6번째 항목은 뷰어 역할별로 갈린다
 * (program-overview 응답의 viewer* 필드는 역할별 한쪽만 채워진다). overview가
 * 없으면(비로그인 등으로 조회 실패) 프로그램 기본 정보만으로 앞 두 항목만 보여준다.
 */
export function ProgramFactBar({
  program,
  overview,
}: {
  readonly program: ProgramDetail;
  readonly overview: ProgramOverview | null;
}) {
  const items: {
    readonly key: string;
    readonly k: string;
    readonly v: string;
    readonly caption?: string;
  }[] = [
    { key: 'organizer', k: '주관', v: program.organizer },
    {
      key: 'period',
      k: '신청 기간',
      v: `${formatSeoulDateOnly(program.applicationPeriod.startsAt)} ~ ${formatSeoulDateOnly(program.applicationPeriod.endsAt)}`,
    },
  ];
  if (overview) {
    items.push(
      {
        key: 'participants',
        k: '참여 학생',
        v: `${overview.participantCount}명`,
      },
      { key: 'teams', k: '팀', v: `${overview.teamCount}팀` },
      {
        key: 'repositories',
        k: '연결된 저장소',
        v: `${overview.connectedRepositoryCount}개`,
      },
    );
    if (overview.viewerRole === 'STUDENT') {
      items.push({
        key: 'my-submission',
        k: '내 제출',
        v: `${overview.viewerDocumentsCompleted ?? 0} / ${overview.viewerDocumentsTotal ?? 0} 서류`,
      });
    } else if (
      overview.viewerRole === 'STAFF' ||
      overview.viewerRole === 'ADMIN'
    ) {
      const denominator = overview.participantCount;
      const numerator = overview.fullySubmittedParticipantCount ?? 0;
      const rate =
        denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;
      // QA47 — "제출률"만으로는 마일스톤 카드(1/1)·매트릭스(2/3)와 다른
      // 숫자가 나오는 이유를 알 수 없었다. 이 값은 "현재 마일스톤" 기준
      // 완주율이라는 측정 범위를 라벨과 캡션에 명시한다.
      items.push({
        key: 'submission-rate',
        k: '이번 마일스톤 완주율',
        v: `${rate}% (${numerator}/${denominator})`,
        caption: '현재 마일스톤 필수 서류를 모두 제출한 참여자 기준',
      });
    }
  }
  return (
    <dl
      aria-label="프로그램 요약"
      className="flex flex-wrap gap-x-8 gap-y-3 border-y border-border py-4"
    >
      {items.map((item) => (
        <div key={item.key} className="grid gap-0.5">
          <dt className="text-xs text-muted-foreground">{item.k}</dt>
          <dd className="text-sm font-bold tabular-nums">{item.v}</dd>
          {item.caption !== undefined ? (
            <p className="text-xs text-muted-foreground">{item.caption}</p>
          ) : null}
        </div>
      ))}
    </dl>
  );
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
              closed={milestone.dDay < 0}
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
   * 이 경우 팩트 바는 프로그램 기본 정보만으로 앞 두 항목만 보여준다.
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
  const didScrollActivityHash = useRef(false);
  useEffect(() => {
    if (didScrollActivityHash.current) return;
    if (window.location.hash !== '#activity') return;
    const target = document.getElementById('activity');
    if (target === null) return;
    target.scrollIntoView({ block: 'start', inline: 'nearest' });
    didScrollActivityHash.current = true;
  }, []);

  return (
    <main className="mx-auto grid max-w-6xl gap-8 px-4 py-8">
      <PageHeader
        title={
          <span className="break-keep text-2xl sm:text-3xl">
            {program.name}
          </span>
        }
        description={`${program.organizer} · ${categoryLabel(program.category)}`}
        actions={<ProgramActions program={program} />}
      />
      <ProgramSummary program={program} />
      <ProgramFactBar program={program} overview={overview} />
      <ProgramMilestones program={program} />
      <section id="activity" aria-label="활동 상세">
        <ActivityGraphPanel
          programId={program.id}
          viewerRole={program.viewer.role}
        />
      </section>
    </main>
  );
}
