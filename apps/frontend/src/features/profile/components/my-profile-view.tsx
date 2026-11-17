import Link from 'next/link';
import { Pencil } from 'lucide-react';
import { FailureState, PageHeader, UserProfileCard } from '@/components';
import { Button } from '@/components/ui/button';
import { Skeleton, SkeletonBlock } from '@/components/ui/skeleton';
import type { UserProfile } from '../types';

export type MyProfileState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'ready'; readonly profile: UserProfile };

interface MyProfileViewProps {
  readonly state: MyProfileState;
  readonly onRetry: () => void;
}

function MyProfileBody({ state, onRetry }: MyProfileViewProps) {
  if (state.kind === 'loading') {
    return (
      <Skeleton label="내 정보를 불러오는 중">
        <SkeletonBlock className="h-48 rounded-card" />
      </Skeleton>
    );
  }
  if (state.kind === 'error') {
    return (
      <FailureState title="내 정보를 불러오지 못했습니다" onRetry={onRetry} />
    );
  }
  return <UserProfileCard profile={state.profile} />;
}

export function MyProfileView({ state, onRetry }: MyProfileViewProps) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-5 sm:p-8">
      <PageHeader
        className="flex-row flex-wrap items-center justify-between sm:items-center"
        title="내 정보"
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/settings">
              <Pencil aria-hidden="true" />
              정보 수정
            </Link>
          </Button>
        }
      />
      <MyProfileBody state={state} onRetry={onRetry} />
    </main>
  );
}
