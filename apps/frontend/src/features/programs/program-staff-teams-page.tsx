'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';
import {
  DataTable,
  EmptyState,
  PageHeader,
  StatusBadge,
  type DataTableColumn,
} from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  programApplicantsHref,
  programApplicationDetailHref,
  programTeamDetailHref,
} from '@/lib/program-route';
import { listProgramApplications, listStaffProgramTeams } from './api';
import {
  APPLICATION_STATUS_BADGE,
  APPLICATION_STATUS_LABELS,
  NO_APPLICATION_LABEL,
  PROVISIONING_LABELS,
  REVIEW_ACTION_LABEL,
} from './application-presentation';
import type {
  ApplicationListItem,
  ApplicationStatus,
  RepositoryProvisioningJobStatus,
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
 *
 * 승인·반려는 이 화면에 두지 않는다 — 신청 상세에서만 한다([#869]). 각 행은
 * 그 팀의 신청 상세로 가는 「검토하기」 링크를 갖고, 신청이 없는 팀은 갈 곳이 없어
 * 링크도 행 클릭도 없다.
 */

/**
 * 사람이 손대야 끝나는 발급 상태. 저장소 칸에서 **눈에 띄게** 그린다.
 *
 * ⚠ 이 화면은 교직원이 현황을 한눈에 보는 자리다. 발급이 실패해도 「아직 없음」으로만
 * 보이던 탓에 교직원은 **문제가 있다는 사실 자체를 몰랐다**(2026-08-11 QA). 학생 화면은
 * 같은 상황에서 실패를 명시하고 있었으므로 두 화면이 서로 다른 이야기를 하고 있었다.
 *
 * `RETRYABLE_FAILED`(재시도 대기)도 포함한다 — 워커가 자동으로 다시 집기는 하지만,
 * 재시도가 계속 실패해도 교직원 눈에는 조용하다. `ANOMALOUS`(확인 필요)는 이름 그대로다.
 */
const PROVISION_FAILURE_STATUSES: ReadonlySet<RepositoryProvisioningJobStatus> =
  new Set(['FAILED', 'RETRYABLE_FAILED', 'ANOMALOUS']);

/**
 * 신청 목록 한 페이지 크기. **backend DTO 의 `@Max(100)` 을 넘으면 안 된다** —
 * 넘기면 `ValidationPipe` 가 요청 전체를 400 SYS_003 으로 거절한다.
 */
const APPLICATION_PAGE_SIZE = 100;
/**
 * 폭주 방지 상한. 여기 걸리면 **조용히 자르지 않고 화면에 드러낸다** — 일부만 받은 채
 * 팀을 붙이면 신청이 있는 팀이 「미신청」으로 보이고, 그건 빈 화면보다 나쁘다.
 * 사용자는 틀린 것을 맞다고 읽는다.
 */
const MAX_APPLICATION_PAGES = 20;

/**
 * 신청을 끝까지 받아 온다. 팀 목록이 기준 축이라 **일부만 받으면 신청이 있는 팀이
 * 「미신청」으로 잘못 보인다** — 부분 데이터가 조용히 오답이 되는 자리다.
 */
export interface FetchedApplications {
  readonly items: readonly ApplicationListItem[];
  /** 상한에 걸려 일부만 받았는지. `true` 면 화면이 그 사실을 알린다. */
  readonly truncated: boolean;
}

async function fetchAllApplications(
  programId: string,
): Promise<FetchedApplications> {
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
  return { items, truncated: first.totalPages > MAX_APPLICATION_PAGES };
}

type TeamFilter = 'all' | ApplicationStatus | 'no-application';

interface StaffTeamRow {
  readonly team: StaffProgramTeam;
  readonly application: ApplicationListItem | null;
}

interface LoadedState {
  readonly kind: 'ready';
  readonly rows: readonly StaffTeamRow[];
  readonly truncated: boolean;
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
  const router = useRouter();

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const [teams, applications] = await Promise.all([
        listStaffProgramTeams(programId),
        fetchAllApplications(programId),
      ]);
      setState({
        kind: 'ready',
        rows: joinTeamsWithApplications(teams, applications.items),
        truncated: applications.truncated,
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

  /**
   * 검색어와 상태 칩을 **한 번에** 되돌린다. 빈 화면이 「조건을 바꿔 보세요」 하나로
   * 말하는 이상, 되돌릴 수단도 하나여야 한다 — 칩만 풀리고 검색어가 남으면 표는 여전히
   * 비어 있고, 사용자는 버튼이 고장 났다고 읽는다.
   */
  const resetFilters = useCallback(() => {
    setFilter('all');
    setSearch('');
  }, []);

  const columns = useMemo<DataTableColumn<StaffTeamRow>[]>(
    () => [
      {
        id: 'team',
        header: '팀',
        cell: (row) => (
          <div className="grid gap-0.5">
            <Link
              href={programTeamDetailHref(programId, row.team.teamId)}
              className="font-medium break-keep underline underline-offset-2"
            >
              {row.team.name}
            </Link>
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
            <StatusBadge variant="pending">{NO_APPLICATION_LABEL}</StatusBadge>
          ) : (
            <StatusBadge
              variant={APPLICATION_STATUS_BADGE[row.application.status]}
            >
              {APPLICATION_STATUS_LABELS[row.application.status]}
            </StatusBadge>
          ),
      },
      {
        id: 'repository',
        header: '저장소',
        cell: (row) => {
          const repository = row.application?.repository ?? null;
          if (repository !== null) {
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
          }
          // 신청서를 아직 안 낸 팀은 발급 자체가 시작되지 않았다 — 발급 상태를
          // 물을 대상이 없으므로 여기만 「아직 없음」이 맞다.
          if (row.application === null) {
            return (
              <span className="text-muted-foreground text-sm">아직 없음</span>
            );
          }
          const provisioning = row.application.repositoryProvisioning;
          return (
            <span
              className="text-sm"
              title={provisioning.safeErrorClass ?? undefined}
            >
              {PROVISION_FAILURE_STATUSES.has(provisioning.jobStatus) ? (
                <StatusBadge variant="rejected">
                  {PROVISIONING_LABELS[provisioning.jobStatus]}
                </StatusBadge>
              ) : (
                <span className="text-muted-foreground">
                  {PROVISIONING_LABELS[provisioning.jobStatus]}
                </span>
              )}
            </span>
          );
        },
      },
      {
        id: 'actions',
        header: '작업',
        // 신청이 없는 팀은 갈 곳이 없다 — 링크를 만들지 않는다(눌리는데 아무
        // 일도 안 일어나는 행을 만들지 않는다).
        cell: (row) =>
          row.application === null ? (
            <span className="text-muted-foreground text-sm">—</span>
          ) : (
            <Button asChild size="sm" variant="outline">
              <Link
                href={programApplicationDetailHref(
                  programId,
                  row.application.id,
                )}
              >
                {REVIEW_ACTION_LABEL}
              </Link>
            </Button>
          ),
      },
    ],
    [programId],
  );

  const applicantsHref = programApplicantsHref(programId);
  const applicantsAction = (
    <Button asChild>
      <Link href={applicantsHref}>신청 목록 보기</Link>
    </Button>
  );

  if (state.kind === 'error') {
    return (
      <div className="grid gap-4 p-4 sm:p-6">
        <PageHeader title="참여 팀" actions={applicantsAction} />
        {/*
         * 실패는 표의 빈 자리가 아니라 화면 상태다 — 공개 아카이브·마일스톤 타임라인과
         * 같은 destructive Alert 하나로 말한다(design.md R-10: 재시도 가능한 실패에
         * `EmptyState`를 쓰지 않는다).
         *
         * ⚠ 「다시 시도해 주세요」라고 말하면서 다시 시도할 것을 주지 않으면 남는 길은
         * 브라우저 새로고침뿐이고, 그건 안내가 아니라 떠넘기기다(#1101). `load`는 이미
         * 다시 부를 수 있는 형태였는데 화면에 연결돼 있지 않았을 뿐이다.
         */}
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>참여 팀을 불러오지 못했습니다</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>
              잠시 후 다시 시도해 주세요. 문제가 계속되면 관리자에게 알려
              주세요.
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void load()}
            >
              <RotateCcw aria-hidden="true" />
              다시 시도
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="grid gap-4 p-4 sm:p-6">
      <PageHeader
        title="참여 팀"
        description="팀 구성과 신청 현황을 함께 봅니다. 승인·반려는 신청 상세에서 합니다."
        actions={applicantsAction}
      />

      {state.kind === 'ready' && state.truncated ? (
        <Alert>
          <AlertTitle>신청 정보를 일부만 불러왔습니다</AlertTitle>
          <AlertDescription>
            신청 건수가 많아 전부 받지 못했습니다. 아래에서 「
            {NO_APPLICATION_LABEL}」으로 보이는 팀 중 일부는 실제로 신청했을 수
            있습니다.{' '}
            <Link
              href={applicantsHref}
              className="font-medium underline underline-offset-2"
            >
              신청자 목록
            </Link>
            에서 확인해 주세요.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2" role="group" aria-label="상태 필터">
        {(
          [
            ['all', `전체 ${counts.all}`],
            [
              'APPROVED',
              `${APPLICATION_STATUS_LABELS.APPROVED} ${counts.APPROVED}`,
            ],
            [
              'SUBMITTED',
              `${APPLICATION_STATUS_LABELS.SUBMITTED} ${counts.SUBMITTED}`,
            ],
            [
              'REJECTED',
              `${APPLICATION_STATUS_LABELS.REJECTED} ${counts.REJECTED}`,
            ],
            [
              'no-application',
              `${NO_APPLICATION_LABEL} ${counts['no-application']}`,
            ],
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
        scrollRegionLabel="참여 팀 목록 표"
        columns={columns}
        data={[...visible]}
        rowKey={(row) => row.team.teamId}
        isLoading={state.kind === 'loading'}
        // 신청이 있는 행만 클릭 대상이다 — 신청이 없는 팀은 갈 곳이 없다.
        // `<tr>`을 `<Link>`/`<a>`로 감쌀 수 없어(table 구조가 깨진다) 여기서는
        // `router.push`로 이동한다 — 「검토하기」 셀 링크는 그대로 둬서 새 탭
        // 열기·가운데 클릭 같은 네이티브 동작·키보드 동선은 그 링크가 담당한다.
        onRowClick={(row) => {
          if (row.application === null) return;
          router.push(
            programApplicationDetailHref(programId, row.application.id),
          );
        }}
        isRowClickable={(row) => row.application !== null}
        caption={`${counts.all}팀 중 ${visible.length}팀을 표시합니다. 표를 좌우로 스크롤할 수 있습니다.`}
        /*
         * 빈 표는 한 가지가 아니다 — 「아직 팀이 없다」와 「조건에 안 걸렸다」는 다른
         * 사실이고, 다른 다음 행동을 부른다. 하나로 뭉쳐 두면 필터를 건 적 없는
         * 교직원에게 필터를 바꾸라고 말하게 된다(#1101).
         *
         * 갈래를 가르는 값은 이미 손안에 있다 — `counts.all`(원본 팀 수)이다. 새로
         * 부를 API 는 없다.
         *
         * ⚠ 순서가 중요하다. **팀이 0팀이면 칩을 눌러 둔 상태여도 「아직 없음」이다** —
         * 팀이 없는 프로그램에서 필터 탓을 하면 원래 결함으로 되돌아간다. 선행 조건을
         * 먼저 보는 것은 제출 현황(`matrixEmptyKind`)·서류 현황과 같은 순서다.
         *
         * 반대쪽 갈래는 `counts.all > 0`이면서 표가 비었을 때뿐이라, 검색어든 상태
         * 칩이든 **무언가는 반드시 걸려 있다**(둘 다 기본값이면 모든 행이 통과한다).
         * 그래서 두 원인을 갈라 말하지 않고 하나로 묶는다.
         */
        emptyState={
          counts.all === 0 ? (
            <EmptyState
              title="아직 참여 팀이 없습니다"
              description="학생이 팀을 만들면 여기에 표시됩니다."
            />
          ) : (
            <EmptyState
              title="조건에 맞는 팀이 없습니다"
              description="검색어나 상태 필터를 바꿔 보세요."
              action={
                <Button type="button" variant="outline" onClick={resetFilters}>
                  필터 초기화
                </Button>
              }
            />
          )
        }
      />
    </div>
  );
}
