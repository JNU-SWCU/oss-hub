'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ApiError } from '@/lib/api-client';
import { getProgramDetail } from './api';
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
      /** 팩트 바 전용. 조회 실패(비로그인 등)해도 페이지 전체를 실패로 만들지 않는다. */
      readonly overview: ProgramOverview | null;
    };

export function detailFailure(error: unknown): DetailState {
  return error instanceof ApiError && error.problem.code === 'PROGRAM_NOT_FOUND'
    ? { kind: 'not-found' }
    : { kind: 'failed' };
}

export function ProgramDetailPage({
  programId,
  approvedStudentMilestones,
}: {
  readonly programId: string;
  readonly approvedStudentMilestones?: ReactNode;
}) {
  const router = useRouter();
  const [state, setState] = useState<DetailState>({ kind: 'loading' });
  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const program = await getProgramDetail(programId);
      const overview = await getProgramOverview(programId).catch(() => null);
      setState({ kind: 'ready', program, overview });
    } catch (error: unknown) {
      setState(detailFailure(error));
    }
  }, [programId]);
  useEffect(() => {
    void load();
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
