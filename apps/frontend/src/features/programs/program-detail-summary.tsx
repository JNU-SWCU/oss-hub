import { ChevronDown } from 'lucide-react';
import { useId } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import type { ProgramOverview } from './program-overview-api';
import type { ProgramDetail } from './types';

// 주관기관/신청기간/유형·모집 배지는 PageHeader로 옮겼다(#865) — 이 카드는 이제
// 설명 문구 하나만 담고, 설명이 없으면 빈 카드를 그리지 않는다.
export function ProgramSummary({
  program,
}: {
  readonly program: ProgramDetail;
}) {
  const contentId = useId();
  if (!program.description) return null;
  return (
    <Collapsible key={program.id} defaultOpen={false}>
      <Card className="gap-0 py-0">
        <CardHeader className="gap-0 px-0">
          <CollapsibleTrigger
            aria-controls={contentId}
            className="group flex h-control w-full items-center justify-between gap-3 px-(--card-spacing) text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <CardTitle>프로그램 안내</CardTitle>
            <ChevronDown
              aria-hidden
              className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none"
            />
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent
          id={contentId}
          className="data-[state=closed]:hidden"
          forceMount
        >
          <CardContent className="py-(--card-spacing)">
            <p className="text-sm leading-6 break-keep whitespace-pre-wrap">
              {program.description}
            </p>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

/**
 * 팩트 바 — 프로그램 상세 요약 스트립. 숫자 지표만 담는다(주관기관/신청기간은
 * PageHeader로 옮겼다, #865). 마지막 항목은 뷰어 역할별로 갈린다
 * (program-overview 응답의 viewer* 필드는 역할별 한쪽만 채워진다). overview가
 * 없으면(비로그인 등으로 조회 실패) 보여줄 숫자 지표가 없으므로 아무것도
 * 그리지 않는다 — 빈 테두리 바를 남기지 않는다.
 */
export function ProgramFactBar({
  program,
  overview,
}: {
  readonly program: ProgramDetail;
  readonly overview: ProgramOverview | null;
}) {
  if (!overview) return null;
  const items: {
    readonly key: string;
    readonly k: string;
    readonly v: string;
    readonly caption?: string;
  }[] = [
    {
      key: 'participants',
      k: '참여 학생',
      v: `${overview.participantCount}명`,
    },
    { key: 'teams', k: '참여 팀', v: `${overview.teamCount}팀` },
    {
      key: 'repositories',
      k: '연결 저장소',
      v: `${overview.connectedRepositoryCount}개`,
    },
  ];
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
      caption: '현재 마일스톤 필수 항목을 모두 제출한 참여자 기준',
    });
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
