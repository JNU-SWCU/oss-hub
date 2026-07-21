'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { EmptyState, PageHeader, StatusBadge } from '@/components';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api-client';
import { getProgramDetail } from './api';
import { ActivityGraphPanel } from './components/activity-graph-panel';
import { MilestoneRow } from './components/milestone-row';
import { categoryLabel, formatSeoulDate } from './program-detail-format';
import type { ProgramDetail } from './types';

type DetailState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'ready'; readonly program: ProgramDetail };

function DetailSkeleton() {
  return (
    <main
      className="mx-auto grid max-w-6xl gap-6 px-4 py-8"
      aria-label="프로그램 상세 불러오는 중"
    >
      <div className="h-24 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      <div className="h-40 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      <div className="h-56 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      <div className="h-36 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
    </main>
  );
}

function ProgramActions({ program }: { readonly program: ProgramDetail }) {
  const role = program.viewer.role;
  if (role === null)
    return (
      <Button asChild>
        <Link href="/">로그인 후 확인</Link>
      </Button>
    );
  if (role === 'STUDENT' && program.viewer.applicationStatus === null) {
    return (
      <Button asChild>
        <Link href={`/programs/${program.id}/apply`}>신청하기</Link>
      </Button>
    );
  }
  if (role === 'STAFF' || role === 'ADMIN') {
    return (
      <>
        <Button asChild variant="outline">
          <Link href={`/staff/programs/${program.id}/edit`}>편집</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={`/staff/programs/${program.id}/applications`}>
            신청자 목록
          </Link>
        </Button>
        <Button asChild>
          <Link href={`/staff/programs/${program.id}/submissions`}>
            전체 제출 현황
          </Link>
        </Button>
      </>
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
  if (state.kind === 'not-found') {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12">
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
  if (state.kind === 'failed') {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12">
        <EmptyState
          title="프로그램을 불러오지 못했습니다"
          description="잠시 후 다시 시도해 주세요."
          action={
            <Button type="button" onClick={() => void load()}>
              다시 시도
            </Button>
          }
        />
      </main>
    );
  }

  const program = state.program;
  return (
    <main className="mx-auto grid max-w-6xl gap-8 px-4 py-8">
      <PageHeader
        title={program.name}
        description={`${program.organizer} · ${categoryLabel(program.category)}`}
        actions={<ProgramActions program={program} />}
      />
      <ProgramSummary program={program} />
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
                  <Link href={`/staff/programs/${program.id}/edit#milestones`}>
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
      <ActivityGraphPanel programId={program.id} />
    </main>
  );
}
