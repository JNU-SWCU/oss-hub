'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ApiError } from '@/lib/api-client';
import { getProgramDetail, getPublicProgramDetail } from './api';
import {
  getProgramOverview,
  type ProgramOverview,
} from './program-overview-api';
import {
  ProgramDetailFailureState,
  ProgramDetailReadyState,
  ProgramDetailSkeleton,
} from './program-detail-view';
import type { ProgramDetail } from './types';

export type DetailState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'failed' }
  | {
      readonly kind: 'ready';
      readonly program: ProgramDetail;

      readonly overview: ProgramOverview | null;
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
  approvedStudentMilestones,
}: {
  readonly programId: string;
  readonly session: ProgramDetailSession;
  readonly approvedStudentMilestones?: ReactNode;
}) {
  const router = useRouter();
  const operationsView = useSearchParams().get('view') === 'operations';
  const requestId = useRef(0);
  const [state, setState] = useState<DetailState>({ kind: 'loading' });
  const load = useCallback(async () => {
    const currentRequestId = ++requestId.current;
    if (session === 'unknown') return;
    setState({ kind: 'loading' });
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
      ).catch(() => null);
      if (requestId.current === currentRequestId)
        setState({ kind: 'ready', program, overview });
    } catch (error: unknown) {
      if (requestId.current === currentRequestId)
        setState(detailFailure(error));
    }
  }, [programId, session, operationsView]);
  useEffect(() => {
    void load();
    return () => {
      requestId.current += 1;
    };
  }, [load]);
  useEffect(() => {
    if (state.kind === 'ready' && state.program.viewer.role === 'PENDING') {
      router.replace('/onboarding/pending');
    }
  }, [router, state]);

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
    <ProgramDetailReadyState
      program={state.program}
      overview={state.overview}
      approvedStudentMilestones={approvedStudentMilestones}
    />
  );
}

export {
  ProgramActions,
  ProgramDetailFailureState,
  ProgramDetailReadyState,
  ProgramMilestones,
} from './program-detail-view';
