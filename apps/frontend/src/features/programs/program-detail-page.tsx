'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { EmptyState, PageHeader, StatusBadge } from '@/components';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api-client';
import { getProgramDetail } from './api';
import { ActivityGraphPanel } from './components/activity-graph-panel';
import { MilestoneRow } from './components/milestone-row';
import { categoryLabel, formatSeoulDate } from './program-detail-format';
import { programHref, staffProgramHref } from './program-paths';
import type { ProgramDetail } from './types';

export type DetailState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'ready'; readonly program: ProgramDetail };

function DetailSkeleton() {
  return (
    <main
      className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8"
      aria-label="프로그램 상세 불러오는 중"
    >
      <div className="h-24 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      <div className="h-40 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      <div className="h-56 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      <div className="h-36 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
    </main>
  );
}

/**
 * 가입 진입점. `@/features/auth/signup-entry-link`의 `SIGNUP_ENTRY.href`와 같은 값을
 * 여기 한 벌 더 적는다 — feature는 다른 feature의 내부 경로를 직접 읽을 수 없고
 * (eslint `no-restricted-imports`, docs/rules/frontend.md), 이 한 자리를 위해 공용
 * 계약을 새로 파낼 만큼 값이 자라지 않았다. 진입 경로가 바뀌면 두 곳을 같이 고친다.
 */
const SIGNUP_ENTRY_HREF = '/signup';

export function ProgramActions({
  program,
}: {
  readonly program: ProgramDetail;
}) {
  const role = program.viewer.role;
  // 역할이 없는 사람은 두 종류가 섞여 들어온다 — 아직 GitHub도 연결하지 않은
  // 방문자와, 연결은 했지만 프로필을 채우지 않아 가입이 끝나지 않은 사람. 뒤쪽에게
  // "로그인 후 확인"은 거짓말이라(그는 이미 로그인해 있다) 어느 쪽에도 참인 "가입"으로
  // 말한다. GitHub 연결만으로는 회원이 아니고, 프로필까지 마쳐야 신청할 수 있다.
  //
  // 목적지도 랜딩이 아니라 가입 진입점 하나다. 재개 지점 판단은 `/signup`이 대신하므로
  // 프로필만 남은 사람은 프로필로 이어진다. 반대로 `/programs` 자체를 막는 방식은
  // 쓰지 않는다 — 프로그램 열람은 비로그인 방문자에게도 열려 있어야 한다.
  if (role === null)
    return (
      <Button asChild>
        <Link href={SIGNUP_ENTRY_HREF}>가입하고 신청하기</Link>
      </Button>
    );
  if (role === 'STUDENT' && program.viewer.applicationStatus === null) {
    return (
      <Button asChild>
        <Link href={programHref(program.id, '/apply')}>신청하기</Link>
      </Button>
    );
  }
  if (role === 'STAFF' || role === 'ADMIN') {
    return (
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <Link href={staffProgramHref(program.id, '/applicants')}>
            신청자 목록
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={staffProgramHref(program.id, '/edit')}>편집</Link>
        </Button>
      </div>
    );
  }
  return null;
}

function ProgramSummary({ program }: { readonly program: ProgramDetail }) {
  const now = Date.now();
  const startsAt = new Date(program.applicationPeriod.startsAt).getTime();
  const endsAt = new Date(program.applicationPeriod.endsAt).getTime();
  const recruiting = startsAt <= now && now <= endsAt;
  return (
    <Card>
      <CardHeader>
        <CardTitle>프로그램 안내</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <span>
            <strong>주관기관</strong> {program.organizer}
          </span>
          <span>
            <strong>신청기간</strong>{' '}
            {formatSeoulDate(program.applicationPeriod.startsAt)} ~{' '}
            {formatSeoulDate(program.applicationPeriod.endsAt)}
          </span>
          <span>
            <strong>유형</strong> {categoryLabel(program.category)}
          </span>
        </div>
        <p className="text-sm leading-6 break-keep whitespace-pre-wrap">
          {program.description}
        </p>
        <StatusBadge variant={recruiting ? 'recruiting' : 'closed'}>
          {recruiting ? '모집중' : '모집 마감'}
        </StatusBadge>
      </CardContent>
    </Card>
  );
}

export function ProgramDetailFailureState({
  kind,
  onRetry,
}: {
  readonly kind: 'not-found' | 'failed';
  readonly onRetry: () => void;
}) {
  if (kind === 'not-found') {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-12">
        <EmptyState
          title="프로그램을 찾을 수 없습니다"
          description="삭제되었거나 공개되지 않은 프로그램입니다."
          action={
            <Button asChild variant="outline">
              <Link href="/programs">프로그램 목록으로</Link>
            </Button>
          }
        />
      </main>
    );
  }
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-12">
      <EmptyState
        title="프로그램을 불러오지 못했습니다"
        description="잠시 후 다시 시도해 주세요."
        action={
          <Button type="button" onClick={onRetry}>
            다시 시도
          </Button>
        }
      />
    </main>
  );
}

export function ProgramMilestones({
  program,
}: {
  readonly program: ProgramDetail;
}) {
  return (
    <section className="grid gap-4" aria-labelledby="milestones-title">
      <div className="flex items-center justify-between gap-3">
        <h2
          id="milestones-title"
          className="font-heading text-xl font-semibold"
        >
          마일스톤
        </h2>
        <span className="text-sm text-muted-foreground">
          {program.milestones.length}개
        </span>
      </div>
      {program.milestones.length === 0 ? (
        <EmptyState
          title="아직 등록된 마일스톤이 없습니다"
          action={
            program.viewer.role === 'STAFF' ||
            program.viewer.role === 'ADMIN' ? (
              <Button asChild variant="outline">
                <Link href={staffProgramHref(program.id, '/edit#milestones')}>
                  마일스톤 설정
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        program.milestones.map((milestone) => (
          <MilestoneRow
            key={milestone.id}
            programId={program.id}
            milestone={milestone}
            viewerRole={program.viewer.role}
            applicationStatus={program.viewer.applicationStatus}
          />
        ))
      )}
    </section>
  );
}
export function detailFailure(error: unknown): DetailState {
  return error instanceof ApiError && error.problem.code === 'PROGRAM_NOT_FOUND'
    ? { kind: 'not-found' }
    : { kind: 'failed' };
}

export function ProgramDetailPage({
  programId,
}: {
  readonly programId: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<DetailState>({ kind: 'loading' });
  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      setState({ kind: 'ready', program: await getProgramDetail(programId) });
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

  if (state.kind === 'loading') return <DetailSkeleton />;
  if (state.kind === 'not-found')
    return (
      <ProgramDetailFailureState kind="not-found" onRetry={() => void load()} />
    );

  if (state.kind === 'failed')
    return (
      <ProgramDetailFailureState kind="failed" onRetry={() => void load()} />
    );

  return <ProgramDetailReadyState program={state.program} />;
}

export function ProgramDetailReadyState({
  program,
}: {
  readonly program: ProgramDetail;
}) {
  const didScrollActivityHash = useRef(false);
  useEffect(() => {
    if (didScrollActivityHash.current) return;
    if (window.location.hash !== '#activity') return;
    const target = document.getElementById('activity');
    if (target === null) return;
    target.scrollIntoView({ block: 'start', inline: 'nearest' });
    didScrollActivityHash.current = true;
  }, []);

  return (
    <main className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-8">
      <PageHeader
        title={
          <span className="break-keep text-2xl sm:text-3xl">
            {program.name}
          </span>
        }
        description={`${program.organizer} · ${categoryLabel(program.category)}`}
        actions={<ProgramActions program={program} />}
      />
      <ProgramSummary program={program} />
      <ProgramMilestones program={program} />
      <section id="activity" aria-label="활동 상세">
        <ActivityGraphPanel
          programId={program.id}
          viewerRole={program.viewer.role}
        />
      </section>
    </main>
  );
}
