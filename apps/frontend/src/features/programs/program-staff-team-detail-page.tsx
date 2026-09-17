'use client';

import Link from 'next/link';
import { Pencil } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { EmptyState, PageHeader, StatusBadge } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ApiError } from '@/lib/api-client';
import { programApplicationDetailHref } from '@/lib/program-route';
import { getStaffProgramTeamDetail } from './api';
import { programHref } from './program-paths';
import {
  APPLICATION_STATUS_BADGE,
  APPLICATION_STATUS_LABELS,
  REVIEW_ACTION_LABEL,
} from './application-presentation';
import { ProgramStaffRepositorySection } from './program-staff-repository-section';
import { StaffRepositoryEvidenceView } from './staff-repository-evidence-view';
import { TeamNameDialog } from './team-name-dialog';
import type { StaffTeamDetail } from './types';

/** 이름 변경 창을 연 버튼. 창이 닫힐 때 포커스를 여기로 돌려준다. */
const RENAME_TRIGGER_ID = 'staff-team-rename-trigger';

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
  headingClassName = 'font-semibold',
}: {
  readonly title: string;
  readonly children: React.ReactNode;
  readonly headingClassName?: string;
}): ReactElement {
  return (
    <section className="grid gap-4 rounded-card border border-border p-card">
      <h2 className={headingClassName}>{title}</h2>
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
  const [renaming, setRenaming] = useState(false);
  /**
   * 이번 방문에서 이름을 바꿨는지. 바뀐 이름 자체는 `detail.name`이 이미 들고
   * 있어 여기에 다시 담지 않는다 — 같은 값을 두 곳에 두면 어느 쪽이 참인지 갈린다.
   */
  const [justRenamed, setJustRenamed] = useState(false);
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
    // 툴팁 지연은 마일스톤 카드와 같은 200ms다 — 같은 종류의 보조 액션이 화면마다
    // 다른 속도로 뜨면 같은 조작이 다르게 느껴진다.
    <TooltipProvider delayDuration={200}>
      <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
        <Button asChild variant="ghost" size="sm">
          <Link href={teamsHref}>← 참여 팀으로</Link>
        </Button>
        <PageHeader
          title={detail.name}
          description={`팀원 ${detail.memberCount}명`}
          /*
           * 신청이 없으면 배지 자체를 그리지 않는다(#1272). 없는 신청에 배지를 달면
           * 대기 중인 신청처럼 읽혀 교직원이 처리할 것이 있다고 오해한다 — 상태가
           * 아니라 상태가 없는 것이므로 헤더는 조용히 비운다. 아래 「검토하기」도
           * 같은 이유로 없다.
           */
          /*
           * 배지와 수정 아이콘을 그대로 넘긴다 — `PageHeader`가 이미 이 자리를
           * `flex items-center gap-3`로 묶고 있어 감싸는 div를 더하면 간격이 두 번
           * 정해져 다른 화면의 머리말과 어긋난다.
           */
          actions={
            <>
              {application === null ? null : (
                <StatusBadge
                  variant={APPLICATION_STATUS_BADGE[application.status]}
                >
                  {APPLICATION_STATUS_LABELS[application.status]}
                </StatusBadge>
              )}
              {/*
               * 팀명을 고치는 자리는 여기다 — 이 화면의 제목이 곧바로 팀명이고, 팀을 단위로
               * 다루는 유일한 화면이다. 신청자 목록은 신청 축이라 팀만 만들고 아직
               * 신청하지 않은 팀이 그 표에 없고, 신청 상세의 팀은 제출 시점 기록이다.
               *
               * 보조 액션이므로 글자 버튼이 아니라 아이콘 + 툴팁이다(design.md R-27).
               * 접근 가능한 이름에 팀명을 넣는 것도 같은 규칙이다 — 마일스톤 카드의
               * 「{이름} 수정」과 문형을 맞춘다. 44px 타겟은 `size="icon"`이 소유한다.
               */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    id={RENAME_TRIGGER_ID}
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`${detail.name} 수정`}
                    onClick={() => setRenaming(true)}
                  >
                    <Pencil aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{`${detail.name} 수정`}</TooltipContent>
              </Tooltip>
            </>
          }
        />

        {justRenamed ? (
          <Alert>
            <AlertTitle>팀 이름을 바꿨습니다</AlertTitle>
            <AlertDescription className="break-keep">
              이제 「{detail.name}」입니다.
            </AlertDescription>
          </Alert>
        ) : null}

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

        <Section
          title="저장소"
          headingClassName="rounded-control bg-primary px-4 py-3 font-semibold text-primary-foreground"
        >
          <ProgramStaffRepositorySection application={application} />
          <StaffRepositoryEvidenceView
            evidence={detail}
            members={detail.members}
            programId={programId}
            teamId={teamId}
          />
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

        {renaming ? (
          <TeamNameDialog
            programId={programId}
            teamId={teamId}
            currentName={detail.name}
            returnFocusId={RENAME_TRIGGER_ID}
            onCancel={() => setRenaming(false)}
            onRenamed={(name) => {
              setRenaming(false);
              setJustRenamed(true);
              /*
               * 바뀐 이름만 덮어 쓴다 — 상세를 다시 불러오면 화면이 스켈레톤으로
               * 갈아끼워져, 바꾼 사실을 확인하려는 사람 앞에서 화면이 한 번 비운다.
               * 이름 밖의 값은 이 요청이 바꾸지 않는다.
               */
              setLoadState((current) =>
                current.kind === 'ready'
                  ? { ...current, detail: { ...current.detail, name } }
                  : current,
              );
            }}
          />
        ) : null}
      </main>
    </TooltipProvider>
  );
}
