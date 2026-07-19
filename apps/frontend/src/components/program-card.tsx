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
  footer,
  className,
  children,
  ...props
}: ProgramCardProps) {
  return (
    <Card
      data-slot="program-card"
      className={cn('h-full', className)}
      {...props}
    >
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {category ? <CardDescription>{category}</CardDescription> : null}
        {status ? <CardAction>{status}</CardAction> : null}
      </CardHeader>
      {period || children ? (
        <CardContent className="flex flex-col gap-1 text-sm text-muted-foreground">
          {period ? <span>{period}</span> : null}
          {children}
        </CardContent>
      ) : null}
      {footer ? <CardFooter>{footer}</CardFooter> : null}
    </Card>
  );
}

export { ProgramCard };
export type { ProgramCardProps };
