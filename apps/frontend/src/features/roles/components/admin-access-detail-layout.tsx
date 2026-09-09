import Link from 'next/link';
import { AlertCircle, RotateCcw, UserRound } from 'lucide-react';
import { EmptyState } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  accessListPath,
  type AccessWorkspace,
} from '../admin-access-list-query';

export type AdminAccessDetailLayoutContext = 'standalone' | 'overlay';
export type DetailHeadingTag = 'h2' | 'h3';

export function detailRootTag(
  layoutContext: AdminAccessDetailLayoutContext,
): 'main' | 'div' {
  return layoutContext === 'overlay' ? 'div' : 'main';
}

export function detailHeadingTags(
  layoutContext: AdminAccessDetailLayoutContext,
): {
  readonly title: 'h1' | 'h2';
  readonly section: DetailHeadingTag;
} {
  return layoutContext === 'overlay'
    ? { title: 'h2', section: 'h3' }
    : { title: 'h1', section: 'h2' };
}

export function detailRootClassName(
  layoutContext: AdminAccessDetailLayoutContext,
  standaloneClassName: string,
): string {
  return layoutContext === 'overlay'
    ? 'flex w-full min-w-0 flex-col gap-6'
    : standaloneClassName;
}

export function AdminAccessDetailLoading({
  layoutContext,
  workspace,
}: {
  readonly layoutContext: AdminAccessDetailLayoutContext;
  readonly workspace: AccessWorkspace;
}) {
  const Root = detailRootTag(layoutContext);
  return (
    <Root
      aria-label={
        layoutContext === 'overlay'
          ? undefined
          : workspace === 'queue'
            ? '가입 신청을 불러오는 중'
            : '사용자 정보를 불러오는 중'
      }
      className={detailRootClassName(
        layoutContext,
        'mx-auto grid w-full max-w-6xl gap-6 p-5 sm:p-8',
      )}
    >
      <div className="h-24 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
      <div className="h-64 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
    </Root>
  );
}

export function AdminAccessDetailError({
  onRetry,
  layoutContext,
  workspace,
}: {
  readonly onRetry: () => void;
  readonly layoutContext: AdminAccessDetailLayoutContext;
  readonly workspace: AccessWorkspace;
}) {
  const Root = detailRootTag(layoutContext);
  return (
    <Root
      className={detailRootClassName(
        layoutContext,
        'mx-auto grid w-full max-w-3xl gap-6 p-5 sm:p-8',
      )}
    >
      <Alert variant="destructive">
        <AlertCircle aria-hidden="true" />
        <AlertTitle>
          {workspace === 'queue'
            ? '가입 신청을 불러오지 못했습니다'
            : '사용자 정보를 불러오지 못했습니다'}
        </AlertTitle>
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          <span>잠시 후 다시 시도해 주세요.</span>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            <RotateCcw aria-hidden="true" />
            다시 시도
          </Button>
        </AlertDescription>
      </Alert>
    </Root>
  );
}

export function AdminAccessDetailNotFound({
  layoutContext,
  workspace,
}: {
  readonly layoutContext: AdminAccessDetailLayoutContext;
  readonly workspace: AccessWorkspace;
}) {
  const Root = detailRootTag(layoutContext);
  const isQueue = workspace === 'queue';
  return (
    <Root
      className={detailRootClassName(
        layoutContext,
        'mx-auto flex w-full max-w-3xl flex-col gap-6 p-5 sm:p-8',
      )}
    >
      <EmptyState
        icon={<UserRound className="size-8" />}
        title={
          isQueue ? '가입 신청을 찾을 수 없습니다' : '사용자를 찾을 수 없습니다'
        }
        description={
          isQueue
            ? '가입 신청 목록에서 현재 상태를 확인해 주세요.'
            : '사용자 목록에서 다시 확인해 주세요.'
        }
        action={
          <Button asChild variant="outline">
            <Link href={accessListPath(workspace)}>
              {isQueue ? '가입 신청으로' : '사용자 목록으로'}
            </Link>
          </Button>
        }
      />
    </Root>
  );
}
