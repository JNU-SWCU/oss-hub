'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DataTable,
  EmptyState,
  PageHeader,
  StatusBadge,
  type DataTableColumn,
} from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { listProgramApplications, listStaffProgramTeams } from './api';
import type {
  ApplicationListItem,
  ApplicationStatus,
  StaffProgramTeam,
} from './types';

/**
 * 교직원용 참여 팀 목록(QA33). 사이드바 「참여 팀」이 교직원에게도 보이는데 누르면
 * 학생 전용 팀 구성 화면에 막히던 것을 이 화면이 받는다.
 *
 * 데이터는 두 곳을 합친다 — 팀 축은 staff 팀 목록(`GET .../teams`), 신청 상태와
 * 저장소는 교직원 신청자 목록(`GET .../applications`)이다. 팀을 기준 축으로 잡는
 * 이유는 **팀만 만들고 아직 신청하지 않은 팀이 있기 때문**이다. 신청 목록을 축으로
 * 잡으면 그 팀들이 통째로 사라져 사이드바의 팀 수와 어긋난다.
 */

const STATUS_LABELS: Readonly<Record<ApplicationStatus, string>> = {
  SUBMITTED: '제출됨',
  APPROVED: '승인',
  REJECTED: '반려',
};
const STATUS_BADGE: Readonly<
  Record<ApplicationStatus, 'pending' | 'approved' | 'rejected'>
> = {
  SUBMITTED: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
};

/**
 * 신청 목록 한 페이지 크기. **backend DTO 의 `@Max(100)` 을 넘으면 안 된다** —
 * 넘기면 `ValidationPipe` 가 요청 전체를 400 SYS_003 으로 거절한다.
 */
const APPLICATION_PAGE_SIZE = 100;
/** 폭주 방지 상한. 100 * 20 = 2,000건이면 한 프로그램 규모를 크게 넘는다. */
const MAX_APPLICATION_PAGES = 20;

/**
 * 신청을 끝까지 받아 온다. 팀 목록이 기준 축이라 **일부만 받으면 신청이 있는 팀이
 * 「신청서 안 냄」으로 잘못 보인다** — 부분 데이터가 조용히 오답이 되는 자리다.
 */
async function fetchAllApplications(
  programId: string,
): Promise<readonly ApplicationListItem[]> {
  const first = await listProgramApplications(programId, {
    page: 1,
    pageSize: APPLICATION_PAGE_SIZE,
    search: '',
    status: 'all',
  });
  const items = [...first.items];
  const lastPage = Math.min(first.totalPages, MAX_APPLICATION_PAGES);
  for (let page = 2; page <= lastPage; page += 1) {
    const next = await listProgramApplications(programId, {
      page,
      pageSize: APPLICATION_PAGE_SIZE,
      search: '',
      status: 'all',
    });
    items.push(...next.items);
  }
  return items;
}

type TeamFilter = 'all' | ApplicationStatus | 'no-application';

interface StaffTeamRow {
  readonly team: StaffProgramTeam;
  readonly application: ApplicationListItem | null;
}

interface LoadedState {
  readonly kind: 'ready';
  readonly rows: readonly StaffTeamRow[];
}
type ScreenState =
  { readonly kind: 'loading' } | { readonly kind: 'error' } | LoadedState;

/**
 * 팀 ↔ 신청을 `teamId`로 잇는다. 한 프로그램에서 팀 하나당 신청은 최대 하나라
 * (`Application @@unique([programId, teamId])`) 다대일이 생기지 않는다.
 */
export function joinTeamsWithApplications(
  teams: readonly StaffProgramTeam[],
  applications: readonly ApplicationListItem[],
): readonly StaffTeamRow[] {
  const byTeamId = new Map<string, ApplicationListItem>();
  for (const application of applications) {
    if (application.team !== null)
      byTeamId.set(application.team.id, application);
  }
  return teams.map((team) => ({
    team,
    application: byTeamId.get(team.teamId) ?? null,
  }));
}

export function memberSummary(team: StaffProgramTeam): string {
  const names = team.members.map((member) => member.name ?? member.nickname);
  if (names.length <= 3) return names.join(' · ');
  return `${names.slice(0, 3).join(' · ')} · 외 ${names.length - 3}명`;
}

function leaderOf(team: StaffProgramTeam) {
  return team.members.find((member) => member.isLeader) ?? null;
}

function matchesFilter(row: StaffTeamRow, filter: TeamFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'no-application') return row.application === null;
  return row.application?.status === filter;
}

function matchesSearch(row: StaffTeamRow, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (needle === '') return true;
  const haystack = [
    row.team.name,
    ...row.team.members.flatMap((member) => [
      member.name ?? '',
      member.nickname,
    ]),
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(needle);
}

export function ProgramStaffTeamsPage({
  programId,
}: {
  readonly programId: string;
}) {
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<TeamFilter>('all');

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const [teams, applications] = await Promise.all([
        listStaffProgramTeams(programId),
        fetchAllApplications(programId),
      ]);
      setState({
        kind: 'ready',
        rows: joinTeamsWithApplications(teams, applications),
      });
    } catch {
      setState({ kind: 'error' });
    }
  }, [programId]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = state.kind === 'ready' ? state.rows : [];
  const counts = useMemo(
    () => ({
      all: rows.length,
      APPROVED: rows.filter((row) => row.application?.status === 'APPROVED')
        .length,
      SUBMITTED: rows.filter((row) => row.application?.status === 'SUBMITTED')
        .length,
      REJECTED: rows.filter((row) => row.application?.status === 'REJECTED')
        .length,
      'no-application': rows.filter((row) => row.application === null).length,
    }),
    [rows],
  );

  const visible = useMemo(
    () =>
      rows.filter(
        (row) => matchesFilter(row, filter) && matchesSearch(row, search),
      ),
    [rows, filter, search],
  );

  const columns = useMemo<DataTableColumn<StaffTeamRow>[]>(
    () => [
      {
        id: 'team',
        header: '팀',
        cell: (row) => (
          <div className="grid gap-0.5">
            <span className="font-medium break-keep">{row.team.name}</span>
            <span className="text-xs text-muted-foreground break-keep">
              {memberSummary(row.team)}
            </span>
          </div>
        ),
      },
      {
        id: 'memberCount',
        header: '인원',
        cell: (row) => (
          <span className="tabular-nums">{row.team.memberCount}</span>
        ),
      },
      {
        id: 'leader',
        header: '팀장',
        cell: (row) => {
          const leader = leaderOf(row.team);
          if (leader === null)
            return <span className="text-muted-foreground">—</span>;
          return (
            <div className="grid gap-0.5">
              <span className="break-keep">
                {leader.name ?? leader.nickname}
              </span>
              <span className="text-xs text-muted-foreground">
                @{leader.nickname}
              </span>
            </div>
          );
        },
      },
      {
        id: 'status',
        header: '신청 상태',
        cell: (row) =>
          row.application === null ? (
            <StatusBadge variant="pending">신청서 안 냄</StatusBadge>
          ) : (
            <StatusBadge variant={STATUS_BADGE[row.application.status]}>
              {STATUS_LABELS[row.application.status]}
            </StatusBadge>
          ),
      },
      {
        id: 'repository',
        header: '저장소',
        cell: (row) => {
          const repository = row.application?.repository ?? null;
          if (repository === null)
            return (
              <span className="text-muted-foreground text-sm">아직 없음</span>
            );
          const isPublic = repository.visibility === 'PUBLIC';
          return (
            <a
              className="text-sm underline underline-offset-2"
              href={repository.url}
              target="_blank"
              rel="noreferrer"
            >
              {isPublic ? '공개 저장소 열기' : '비공개 저장소 확인'}
            </a>
          );
        },
      },
    ],
    [],
  );

  if (state.kind === 'error') {
    return (
      <div className="grid gap-4 p-4 sm:p-6">
        <PageHeader title="참여 팀" />
        <Alert variant="destructive">
          <AlertTitle>참여 팀을 불러오지 못했습니다</AlertTitle>
          <AlertDescription>
            잠시 후 다시 시도해 주세요. 문제가 계속되면 관리자에게 알려 주세요.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="grid gap-4 p-4 sm:p-6">
      <PageHeader
        title="참여 팀"
        description="팀 구성과 신청 현황을 함께 봅니다."
      />

      <div className="flex flex-wrap gap-2" role="group" aria-label="상태 필터">
        {(
          [
            ['all', `전체 ${counts.all}`],
            ['APPROVED', `승인 ${counts.APPROVED}`],
            ['SUBMITTED', `제출됨 ${counts.SUBMITTED}`],
            ['REJECTED', `반려 ${counts.REJECTED}`],
            ['no-application', `신청서 안 냄 ${counts['no-application']}`],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className="rounded-full border px-3 py-1 text-sm aria-pressed:bg-primary aria-pressed:text-primary-foreground"
          >
            {label}
          </button>
        ))}
      </div>

      <Input
        aria-label="팀 검색"
        placeholder="팀명 · 팀원 이름 · GitHub 계정으로 검색"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />

      <DataTable
        columns={columns}
        data={[...visible]}
        rowKey={(row) => row.team.teamId}
        isLoading={state.kind === 'loading'}
        caption={`${counts.all}팀 중 ${visible.length}팀을 표시합니다. 표를 좌우로 스크롤할 수 있습니다.`}
        emptyState={
          <EmptyState
            title="표시할 팀이 없습니다"
            description="검색어나 상태 필터를 바꿔 보세요."
          />
        }
      />
    </div>
  );
}
