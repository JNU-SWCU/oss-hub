import * as React from 'react';

import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
  CardFooter,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface ProgramCardProps extends Omit<
  React.ComponentProps<typeof Card>,
  'title'
> {
  /** 프로그램 제목 */
  title: string;
  /** 카테고리(캡스톤/해커톤 등) */
  category?: string;
  /** 모집·진행 기간 문구 */
  period?: string;
  /** 상태 표시 슬롯 — StatusBadge 등을 그대로 전달한다 */
  status?: React.ReactNode;
  /** 상태 슬롯 배치 방식 */
  statusPlacement?: 'header' | 'body-center';
  /** 카드 하단 액션 슬롯(예: 상세 보기 링크) */
  footer?: React.ReactNode;
}

/**
 * 프로그램 요약 카드. B-5 Card 프리미티브를 조합만 하고 자체 스타일은
 * 얹지 않는다. 역할별 표시 분기는 이 컴포넌트가 하지 않는다 — role prop을
 * 받지 않고, 무엇을 보여줄지는 항상 호출부(소비 화면)가 결정한다.
 */
function ProgramCard({
  title,
  category,
  period,
  status,
  statusPlacement = 'header',
  footer,
  className,
  children,
  ...props
}: ProgramCardProps) {
  const header = (
    <CardHeader>
      <CardTitle>{title}</CardTitle>
      {category ? <CardDescription>{category}</CardDescription> : null}
      {statusPlacement === 'header' && status ? (
        <CardAction>{status}</CardAction>
      ) : null}
    </CardHeader>
  );
  const content =
    period || children ? (
      <CardContent className="flex flex-col gap-1 text-sm text-muted-foreground">
        {period ? <span>{period}</span> : null}
        {children}
      </CardContent>
    ) : null;

  return (
    <Card
      data-slot="program-card"
      data-status-placement={statusPlacement}
      className={cn('h-full', className)}
      {...props}
    >
      {statusPlacement === 'body-center' && status ? (
        <div className="@container/program-card-status grid flex-1 grid-cols-1 gap-4 @min-[32rem]/program-card-status:grid-cols-[minmax(0,1fr)_auto] @min-[32rem]/program-card-status:items-center">
          <div className="grid gap-(--card-spacing)">
            {header}
            {content}
          </div>
          <div className="px-(--card-spacing) @min-[32rem]/program-card-status:justify-self-end @min-[32rem]/program-card-status:pl-0 @min-[32rem]/program-card-status:pr-(--card-spacing)">
            {status}
          </div>
        </div>
      ) : (
        <>
          {header}
          {content}
        </>
      )}
      {footer ? <CardFooter>{footer}</CardFooter> : null}
    </Card>
  );
}

export { ProgramCard };
export type { ProgramCardProps };
