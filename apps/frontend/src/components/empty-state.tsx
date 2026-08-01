import * as React from 'react';

import { cn } from '@/lib/utils';

interface EmptyStateProps extends React.ComponentProps<'div'> {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

/**
 * 목록·그리드가 비었을 때의 안내 화면.
 * StyleGallery stack(수직 리듬) + center(폭 제한·가운데 정렬) 패턴 조합.
 */
function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      // 시안 v2 `.empty` — 점선 테두리 + 카드 모서리. 비어 있음을 "아직 채워지지
      // 않은 자리"로 보여 준다. 안쪽 글줄만 폭을 제한해 읽는 길이를 유지한다.
      className={cn(
        'grid justify-items-center gap-3 rounded-card border border-dashed border-border p-12 text-center',
        className,
      )}
      {...props}
    >
      {icon ? (
        <div
          data-slot="empty-state-icon"
          aria-hidden="true"
          className="text-muted-foreground"
        >
          {icon}
        </div>
      ) : null}
      <p className="font-heading text-body font-semibold text-foreground">
        {title}
      </p>
      {description ? (
        <p className="max-w-[46ch] text-body text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export { EmptyState };
export type { EmptyStateProps };
