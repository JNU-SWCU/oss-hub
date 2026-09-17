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
  meta,
  children,
  headingClassName = 'font-semibold',
}: {
  readonly title: string;
  /**
   * 머리말 오른쪽에 붙는 수·단위. 공용 `SectionHeading`의 `meta`와 같은 역할이고
   * 같은 키울을 쓴다 — 이 페이지는 카드 안 머리말이라 제목 크기만 다르다.
   */
  readonly meta?: string;
  readonly children: React.ReactNode;
  readonly headingClassName?: string;
}): ReactElement {
  return (
    <section className="grid gap-4 rounded-card border border-border p-card">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className={headingClassName}>{title}</h2>
        {meta ? (
          <span className="text-small text-muted-foreground">{meta}</span>
        ) : null}
      </div>
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
          /*
           * 인원수를 제목 아래에 두지 않는다 — 「한빛 팀 / 팀원 3명 / 팀원」으로 한
           * 눈에 「팀」이 세 번 서고, 정작 그 수를 설명하는 명단은 아래 섹션에 있다.
           * 수는 그 명단의 머리말이 말한다(`섹션 title·meta`).
           */
          /*
           * 수정은 제목 문자열을 대상으로 하므로 제목 옆이다. 우측 `actions`는
           * 신청 상태 배지가 쓰는 자리라 둘을 한 덩어리로 묶으면 연필이 배지를
           * 가리키는 것처럼 읽힌다.
           */
          titleAction={
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
          }
          /*
           * 신청이 없으면 배지 자체를 그리지 않는다(#1272). 없는 신청에 배지를 달면
           * 대기 중인 신청처럼 읽혀 교직원이 처리할 것이 있다고 오해한다 — 상태가
           * 아니라 상태가 없는 것이므로 헤더는 조용히 비운다. 아래 「검토하기」도
           * 같은 이유로 없다.
           */
          actions={
            application === null ? undefined : (
              <StatusBadge
                variant={APPLICATION_STATUS_BADGE[application.status]}
              >
                {APPLICATION_STATUS_LABELS[application.status]}
              </StatusBadge>
            )
          }
        />

        {/*
         * 바뀐 이름을 여기서 다시 말하지 않는다 — 바로 위 제목이 그 이름이다.
         * 이 줄이 말하는 것은 「저장됐다」는 사실 하나다.
         */}
        {justRenamed ? (
          <Alert>
            <AlertTitle>팀 이름을 바꿨습니다</AlertTitle>
          </Alert>
        ) : null}

        <Section title="팀원" meta={`${detail.memberCount}명`}>
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
