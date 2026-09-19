'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
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
      /** 팩트 바 전용. 조회 실패(비로그인 등)해도 페이지 전체를 실패로 만들지 않는다. */
      readonly overview: ProgramOverview | null;
    };

export function detailFailure(error: unknown): DetailState {
  return error instanceof ApiError && error.problem.code === 'PROGRAM_NOT_FOUND'
    ? { kind: 'not-found' }
    : { kind: 'failed' };
}

/**
 * 방문자에게 세션이 있는가. app 계층이 공유 세션 저장소를 읽어 넘긴다 — 이 feature는
 * `features/auth`를 import할 수 없다(feature 간 의존 금지).
 *
 * - `unknown`: 아직 모른다. 아무것도 부르지 않고 뼈대만 그린다.
 * - `anonymous`: 세션이 없다. 공개 상세만 부른다 — viewer·overview를 부르면 401이 나고
 *   화면은 그려지지만 콘솔에 오류 두 줄이 남는다(#1294).
 * - `present`: 세션이 있다(조회 실패로 모를 때도 여기다). viewer·overview를 부르고,
 *   viewer가 401이면 공개 상세로 내려간다.
 */
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
  const [state, setState] = useState<DetailState>({ kind: 'loading' });
  const load = useCallback(async () => {
    if (session === 'unknown') return;
    setState({ kind: 'loading' });
    try {
      if (session === 'anonymous') {
        const program = await getPublicProgramDetail(programId);
        setState({ kind: 'ready', program, overview: null });
        return;
      }
      const program = await getProgramDetail(programId);
      const overview = await getProgramOverview(programId).catch(() => null);
      setState({ kind: 'ready', program, overview });
    } catch (error: unknown) {
      setState(detailFailure(error));
    }
  }, [programId, session]);
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
