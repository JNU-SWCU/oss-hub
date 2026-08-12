'use client';

import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { EmptyState, PageHeader, StatusBadge } from '@/components';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-client';
import { programApplicationDetailHref } from '@/lib/program-route';
import { getStaffProgramTeamDetail } from './api';
import { programHref } from './program-paths';
import {
  APPLICATION_STATUS_BADGE,
  APPLICATION_STATUS_LABELS,
  NO_APPLICATION_LABEL,
  REVIEW_ACTION_LABEL,
} from './application-presentation';
import { ProgramStaffRepositorySection } from './program-staff-repository-section';
import type { StaffTeamDetail } from './types';

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly detail: StaffTeamDetail }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'error'; readonly message: string };

function DetailSkeleton(): ReactElement {
  return (
    <main
      className="mx-auto grid w-full max-w-3xl gap-6 px-4 py-8"
      aria-label="팀 상세 불러오는 중"
    >
      <div className="h-20 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      <div className="h-40 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      <div className="h-40 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
    </main>
  );
}

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}): ReactElement {
  return (
    <section className="grid gap-4 rounded-card border border-border p-card">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/**
 * 교직원 전용 팀 상세(#874). 참여 팀 목록(`ProgramStaffTeamsPage`)의 팀명에서
 * 들어오는 문맥 경로다.
 *
 * 데이터는 백엔드가 **한 요청으로** 팀원·신청 상태·저장소 발급 상태를 합쳐 준다
 * (`getStaffProgramTeamDetail`) — 참여 팀 목록처럼 팀 목록과 신청 목록을 따로
 * 불러 클라이언트에서 잇지 않는다.
 */
export function ProgramStaffTeamDetailPage({
  programId,
  teamId,
}: {
  readonly programId: string;
  readonly teamId: string;
}): ReactElement {
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' });
  const cancelled = useRef(false);

  const load = useCallback(async (): Promise<void> => {
    setLoadState({ kind: 'loading' });
    try {
      const detail = await getStaffProgramTeamDetail(programId, teamId);
      if (cancelled.current) return;
      setLoadState({ kind: 'ready', detail });
    } catch (error: unknown) {
      if (cancelled.current) return;
      if (error instanceof ApiError && error.problem.status === 404) {
        setLoadState({ kind: 'not-found' });
      } else {
        setLoadState({
          kind: 'error',
          message:
            error instanceof ApiError
              ? error.problem.detail
              : '팀 상세를 불러오지 못했습니다.',
        });
      }
    }
  }, [programId, teamId]);

  useEffect(() => {
    cancelled.current = false;
    void load();
    return () => {
      cancelled.current = true;
    };
  }, [load]);

  const teamsHref = programHref(programId, '/teams');

  if (loadState.kind === 'loading') return <DetailSkeleton />;

  if (loadState.kind === 'not-found' || loadState.kind === 'error') {
    const copy =
      loadState.kind === 'not-found'
        ? {
            title: '팀을 찾을 수 없습니다',
            description: '이 프로그램의 팀이 아니거나 주소가 잘못되었습니다.',
          }
        : { title: '팀 상세를 열 수 없습니다', description: loadState.message };
    return (
      <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
        <PageHeader title="팀 상세" />
        <EmptyState
          title={copy.title}
          description={copy.description}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {loadState.kind === 'error' ? (
                <Button onClick={() => void load()}>다시 시도</Button>
              ) : null}
              <Button asChild variant="outline">
                <Link href={teamsHref}>참여 팀으로</Link>
              </Button>
            </div>
          }
        />
      </main>
    );
  }

  const { detail } = loadState;
  const { application } = detail;

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
      <Button asChild variant="ghost" size="sm">
        <Link href={teamsHref}>← 참여 팀으로</Link>
      </Button>
      <PageHeader
        title={detail.name}
        description={`팀원 ${detail.memberCount}명`}
        actions={
          application === null ? (
            <StatusBadge variant="pending">{NO_APPLICATION_LABEL}</StatusBadge>
          ) : (
            <StatusBadge variant={APPLICATION_STATUS_BADGE[application.status]}>
              {APPLICATION_STATUS_LABELS[application.status]}
            </StatusBadge>
          )
        }
      />

      <Section title="팀원">
        <ul className="grid gap-3">
          {detail.members.map((member) => (
            <li
              key={member.userId}
              className="flex items-center justify-between gap-2 break-keep"
            >
              <div className="grid gap-0.5">
                <span>{member.name ?? member.nickname}</span>
                <span className="text-xs text-muted-foreground">
                  @{member.nickname}
                </span>
              </div>
              {member.isLeader ? (
                <StatusBadge variant="recruiting" size="default">
                  팀장
                </StatusBadge>
              ) : null}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="저장소">
        <ProgramStaffRepositorySection application={application} />
      </Section>

      {application !== null ? (
        <div className="flex flex-wrap justify-end gap-2">
          <Button asChild>
            <Link
              href={programApplicationDetailHref(programId, application.id)}
            >
              {REVIEW_ACTION_LABEL}
            </Link>
          </Button>
        </div>
      ) : null}
    </main>
  );
}
