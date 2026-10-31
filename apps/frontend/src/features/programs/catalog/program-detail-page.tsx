'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  MILESTONE_DOCUMENT_SUBMITTED_EVENT,
  submittedMilestoneId,
} from '../documents/milestone-document-events';
import { ApiError } from '@/lib/api-client';
import { getProgramDetail, getPublicProgramDetail } from './api';
import { getProgramOverview } from './program-overview-api';
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
  const requestId = useRef(0);
  const [state, setState] = useState<DetailState>({ kind: 'loading' });
  const load = useCallback(
    async (background = false) => {
      const currentRequestId = ++requestId.current;
      if (session === 'unknown' || operationsView === null) return;
      if (!background) setState({ kind: 'loading' });
      try {
        if (session === 'anonymous') {
          const program = await getPublicProgramDetail(programId);
          if (requestId.current === currentRequestId)
            setState({ kind: 'ready', program, overview: null });
          return;
        }
        const program = await getProgramDetail(programId, operationsView);
        const overview = await getProgramOverview(
          programId,
          operationsView,
        ).catch((error: unknown) => {
          if (background) throw error;
          return null;
        });
        if (requestId.current === currentRequestId)
          setState({ kind: 'ready', program, overview });
      } catch (error: unknown) {
        if (requestId.current === currentRequestId)
          setState((previous) =>
            background && previous.kind === 'ready'
              ? { ...previous, refreshFailed: true }
              : detailFailure(error),
          );
      }
    },
    [programId, session, operationsView],
  );
  useEffect(() => {
    void load();
    return () => {
      requestId.current += 1;
    };
  }, [load]);
  useEffect(() => {
    if (state.kind !== 'ready') return;
    const refresh = (event: Event) => {
      const milestoneId = submittedMilestoneId(event);
      if (
        state.program.milestones.some(
          (milestone) => milestone.id === milestoneId,
        )
      )
        void load(true);
    };
    window.addEventListener(MILESTONE_DOCUMENT_SUBMITTED_EVENT, refresh);
    return () =>
      window.removeEventListener(MILESTONE_DOCUMENT_SUBMITTED_EVENT, refresh);
  }, [load, state]);
  useEffect(() => {
    if (state.kind === 'ready' && state.program.viewer.role === 'PENDING') {
      router.replace('/onboarding/pending');
    }
  }, [router, state]);
  useEffect(() => {
    if (state.kind === 'ready') onProgramName?.(state.program.name);
  }, [onProgramName, state]);

  if (operationsView === null) return null;
  if (state.kind === 'loading') return <ProgramDetailSkeleton />;
  if (state.kind === 'not-found')
    return (
      <ProgramDetailFailureState kind="not-found" onRetry={() => void load()} />
    );

  if (state.kind === 'failed')
    return (
      <ProgramDetailFailureState kind="failed" onRetry={() => void load()} />
    );

  return (
    <>
      {state.refreshFailed ? (
        <div role="alert" className="flex items-center gap-3">
          <p>제출은 저장되었지만 집계를 갱신하지 못했습니다.</p>
          <Button variant="outline" onClick={() => void load(true)}>
            집계 다시 불러오기
          </Button>
        </div>
      ) : null}
      <ProgramDetailReadyState
        program={state.program}
        overview={state.overview}
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
