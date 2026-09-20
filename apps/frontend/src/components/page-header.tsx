import * as React from 'react';

import { cn } from '@/lib/utils';

interface PageHeaderProps extends Omit<
  React.ComponentProps<'header'>,
  'title'
> {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /**
   * 제목 **그 자체**를 다루는 액션(예: 이름 수정). 우측 `actions`와 가르는 이유는
   * 둘이 가리키는 대상이 다르기 때문이다 — `actions`에 서는 상태 배지·페이지 CTA는
   * 화면을 대상으로 하고, 이것은 제목 문자열을 대상으로 한다.
   *
   * heading **밖에** 그린다. 안에 넣으면 버튼 라벨이 heading의 접근 가능한 이름에
   * 섮여 읽어 주는 도구가 「한빛 팀 한빛 팀 수정」으로 읽는다.
   */
  titleAction?: React.ReactNode;
  /**
   * h1 기본 타이포(계단식 text-section/text-page)를 화면별로 덮어써야 할 때
   * 쓴다 — 선택적이며, 넘기지 않으면 기존 렌더와 동일하다. 화면이 필터에 따라
   * H1 문구 자체를 바꾸는 것(예: 프로그램 목록의 "모집중인 프로그램")은 이미
   * `title`이 `ReactNode`라 별도 prop 없이도 된다.
   */
  titleClassName?: string;
  /** description 기본 스타일을 덮어써야 할 때. 선택적. */
  descriptionClassName?: string;
  /**
   * 제목을 그릴 heading 요소. 기본값 `h1`이라 넘기지 않으면 기존 렌더와 동일하다.
   *
   * `h2`가 필요한 자리는 이 머리말이 **문서의 최상위 제목이 아닐 때**다 — 예를
   * 들어 `role="dialog"` 안에 그려질 때. 다이얼로그는 이미 자기 제목을 갖고
   * 있고(Radix `Dialog.Title`은 `h2`로 렌더된다), 그 뒤에 `h1`이 오면 제목
   * 레벨이 h2 → h1으로 역행해 heading-order 검사에 걸린다.
   */
  titleAs?: 'h1' | 'h2';
}

/**
 * 페이지 제목 + 설명 + 우측 액션 슬롯. 화면 상단에서 반복되는 뼈대를 공용화한다.
 */
function PageHeader({
  title,
  description,
  actions,
  titleAction,
  className,
  titleClassName,
  descriptionClassName,
  titleAs: TitleTag = 'h1',
  ...props
}: PageHeaderProps) {
  return (
    <header
      data-slot="page-header"
      // 시안 v2 — 페이지 머리에는 선을 긋지 않는다. 제목 크기(40)와 아래 여백만으로
      // 이미 구분되고, 선을 더하면 섹션 구분선과 위계가 섞인다.
      className={cn(
        'flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between',
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-col gap-3">
        {/*
          `titleAction`이 없으면 제목을 그대로 둔다 — 쓰지 않는 화면까지 한 겹
          더 감싸면 제목과 설명이 다른 부모로 갈라져, 그 둘을 한 덩어리로 읽던
          화면의 계약이 조용히 깨진다(학생 「우리 팀」 머리말 시험이 그것을 잡는다).
        */}
        {titleAction ? (
          <div className="flex min-w-0 items-center gap-2">
            <TitleTag
              data-slot="page-header-title"
              className={cn(
                'font-heading text-section leading-tight font-bold tracking-tight break-keep text-pretty sm:text-page',
                titleClassName,
              )}
            >
              {title}
            </TitleTag>
            <div data-slot="page-header-title-action" className="shrink-0">
              {titleAction}
            </div>
          </div>
        ) : (
          <TitleTag
            data-slot="page-header-title"
            // 크기 계단의 맨 위 칸. 좁은 화면에서 40px은 제목 한 줄이 화면을 넘기므로
            // 한 계단 내려 섹션 크기로 쓴다(시안의 900px 미만 규칙과 같은 취지).
            className={cn(
              'font-heading text-section leading-tight font-bold tracking-tight break-keep text-pretty sm:text-page',
              titleClassName,
            )}
          >
            {title}
          </TitleTag>
        )}
        {description ? (
          <p
            data-slot="page-header-description"
            className={cn(
              'max-w-[60ch] text-body text-muted-foreground break-keep text-pretty',
              descriptionClassName,
            )}
          >
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div
          data-slot="page-header-actions"
          className="flex flex-wrap items-center gap-3"
        >
          {actions}
        </div>
      ) : null}
    </header>
  );
}

export { PageHeader };
export type { PageHeaderProps };
