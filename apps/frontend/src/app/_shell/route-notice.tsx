'use client';

import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface RouteNoticeProps {
  readonly title: string;
  readonly description: string;
  readonly actions: ReactNode;
  /**
   * 본문 아래 작게 남기는 기술 표식(`404`, 오류 digest). 개발자·문의 창구에는
   * 단서지만 학생에게는 아니라, 제목 자리에 크게 세우지 않고 여기로만 내린다.
   */
  readonly code?: string;
  readonly className?: string;
}

/**
 * 라우트 트리가 화면을 내주지 못했을 때 그 자리를 대신하는 안내 —
 * 없는 주소(`app/not-found.tsx`)와 렌더 실패(`app/error.tsx`) 둘이 함께 쓴다.
 *
 * 뼈대를 새로 만들지 않는다. 같은 처지의 전면 안내 셋(`access-denied.tsx`
 * ·`login-required-notice.tsx`·`session-error.tsx`)이 이미 쓰는 치수를 그대로 따른다 —
 * `min-h-[50svh]` 가운데 정렬, `text-lg font-semibold` 제목, `max-w-md break-keep
 * text-sm text-muted-foreground` 한 문단, `min-h-11` 버튼. 그래야 주소가 틀렸을 때와
 * 권한이 없을 때가 서로 다른 서비스처럼 보이지 않는다.
 *
 * **그림을 넣지 않는다.** 위 전면 안내 셋은 모두 글자만 쓰고, 목록이 비었을 때의
 * `EmptyState`도 53곳 중 40곳이 아이콘 없이 선다(2026-09-04 전수 확인). 여기만 삽화를
 * 두면 결이 어긋난다.
 *
 * **live region을 두지 않는다.** R-12(docs/design.md §피드백·알림)는 `role="alert"`을
 * 상호작용 중 발생한 동적 error에만 허용하고, 이 두 화면은 그 라우트의 **초기 렌더
 * 콘텐츠**다. 이웃 둘이 정적 heading에 `role="alert"`을 달고 있으나 그것은 같은 문서의
 * 「수용된 부채」에 위반으로 적힌 항목이라(AP-04) 따라 하지 않는다.
 */
export function RouteNotice({
  title,
  description,
  actions,
  code,
  className,
}: RouteNoticeProps) {
  return (
    <main
      data-slot="route-notice"
      className={cn(
        'flex min-h-[50svh] flex-col items-center justify-center gap-4 px-6 py-16 text-center',
        className,
      )}
    >
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        <p className="mx-auto max-w-md break-keep text-sm text-muted-foreground">
          {description}
        </p>
      </div>
      <div
        data-slot="route-notice-actions"
        className="flex flex-wrap justify-center gap-2"
      >
        {actions}
      </div>
      {code ? (
        <p
          data-slot="route-notice-code"
          className="text-xs text-muted-foreground"
        >
          {code}
        </p>
      ) : null}
    </main>
  );
}

/**
 * 없는 주소에서 「이전 화면」으로 돌아가는 버튼.
 *
 * 대시보드로 보내지 않는다 — `/dashboard`는 역할마다 본문이 갈리는 자리라, 주소를
 * 잘못 눌렀을 뿐인 사람을 자기 역할 화면으로 밀어 넣는 셈이 된다. 갈 곳은 역할과
 * 무관한 `/programs`와, 사용자가 원래 있던 자리 둘로 둔다.
 */
export function PreviousPageButton() {
  const router = useRouter();

  return (
    <Button
      type="button"
      className="min-h-11"
      variant="outline"
      size="sm"
      onClick={() => router.back()}
    >
      이전 화면
    </Button>
  );
}

export type { RouteNoticeProps };
