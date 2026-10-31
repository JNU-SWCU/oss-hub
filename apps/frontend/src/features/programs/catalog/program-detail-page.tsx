'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-client';
import {
  invalidateProgram,
  useProgramDetailQuery,
  useProgramOverviewQuery,
  usePublicProgramDetailQuery,
} from './queries';
import type { ProgramOverview } from './program-overview-dto';
import {
  ProgramDetailFailureState,
  ProgramDetailReadyState,
  ProgramDetailSkeleton,
  type RenderSignInApply,
} from './program-detail-view';
import type { ProgramDetail } from './dto';

export type DetailState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'failed' }
  | {
      readonly kind: 'ready';
      readonly program: ProgramDetail;

      readonly overview: ProgramOverview | null;
      readonly refreshFailed?: boolean;
    };

export function detailFailure(error: unknown): DetailState {
  return error instanceof ApiError && error.problem.code === 'PROGRAM_NOT_FOUND'
    ? { kind: 'not-found' }
    : { kind: 'failed' };
}

export type ProgramDetailSession = 'unknown' | 'anonymous' | 'present';

export function ProgramDetailPage({
  programId,
  session,
  operationsView = false,
  renderSignInApply,
  onProgramName,
}: {
  readonly programId: string;
  readonly session: ProgramDetailSession;
  readonly operationsView?: boolean | null;
  readonly renderSignInApply: RenderSignInApply;

  readonly onProgramName?: (name: string) => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const memberProgramId = session === 'present' ? programId : null;
  const memberDetail = useProgramDetailQuery(memberProgramId, operationsView);
  const publicDetail = usePublicProgramDetailQuery(
    session === 'anonymous' && operationsView !== null ? programId : null,
  );
  const overview = useProgramOverviewQuery(memberProgramId, operationsView);
  const detail = session === 'anonymous' ? publicDetail : memberDetail;
  const program = detail.data;
  const load = () => invalidateProgram(queryClient, programId);
  useEffect(() => {
    if (program?.viewer.role === 'PENDING') {
      router.replace('/onboarding/pending');
    }
  }, [router, program]);
  useEffect(() => {
    if (program !== undefined) onProgramName?.(program.name);
  }, [onProgramName, program]);

  if (operationsView === null) return null;
  if (program === undefined && detail.isError)
    return (
      <ProgramDetailFailureState
        kind={
          detailFailure(detail.error).kind === 'not-found'
            ? 'not-found'
            : 'failed'
        }
        onRetry={() => void load()}
      />
    );
  if (
    session === 'unknown' ||
    program === undefined ||
    (session === 'present' &&
      overview.isPending &&
      overview.errorUpdateCount === 0)
  )
    return <ProgramDetailSkeleton />;

  return (
    <>
      {detail.isRefetchError ||
      overview.isRefetchError ||
      (overview.isError && overview.errorUpdateCount > 1) ? (
        <div role="alert" className="flex items-center gap-3">
          <p>제출은 저장되었지만 집계를 갱신하지 못했습니다.</p>
          <Button variant="outline" onClick={() => void load()}>
            집계 다시 불러오기
          </Button>
        </div>
      ) : null}
      <ProgramDetailReadyState
        program={program}
        overview={session === 'present' ? (overview.data ?? null) : null}
        renderSignInApply={renderSignInApply}
      />
    </>
  );
}

export {
  ProgramActions,
  ProgramDetailFailureState,
  ProgramDetailReadyState,
  ProgramMilestones,
} from './program-detail-view';
