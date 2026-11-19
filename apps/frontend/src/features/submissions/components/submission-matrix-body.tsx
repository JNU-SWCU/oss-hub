'use client';

import { ChevronRight, Download } from 'lucide-react';
import Link from 'next/link';
import {
  Fragment,
  type ReactElement,
  type ReactNode,
  useId,
  useState,
  useSyncExternalStore,
} from 'react';
import { EmptyState } from '@/components';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TooltipProvider } from '@/components/ui/tooltip';
import { programEditHref, programTeamDetailHref } from '@/lib/program-route';
import { SUBMISSION_STATUS_LABELS } from '@/lib/status-vocabulary';
import { cn } from '@/lib/utils';
import { cellForMilestone, matrixTotalPages, type MatrixSort } from '../matrix';
import { formatSubmittedAt } from '../matrix-format';
import type { MatrixCell, MatrixMilestone, MatrixRow } from '../types';
import {
  hasMatrixSubmissionStatus,
  MatrixCellContent,
  SubmissionDeadline,
  SubmissionStatusMark,
} from './submission-matrix-cell';
import {
  MatrixPagination,
  MatrixSkeleton,
  SubmissionSortHeader,
  SubmissionStatusLegend,
} from './submission-matrix-controls';
import type { SubmissionMatrixViewProps } from './submission-matrix-view';

const TABLE_CARD =
  'hidden min-w-0 overflow-hidden rounded-card border border-border sm:block';
const TEAM_COLUMN = 'sticky left-0 z-10 min-w-40 bg-background';
const MOBILE_CARD =
  'grid min-w-0 gap-3 rounded-card border border-border bg-card p-4 text-small';

function TeamIdentity({
  name,
  leaderName,
  href,
}: {
  readonly name: string;
  readonly leaderName: string | null;
  readonly href?: string;
}): ReactElement {
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-left break-words whitespace-normal sm:flex-col">
      {href === undefined ? (
        <span className="font-semibold text-foreground">{name}</span>
      ) : (
        <Link
          href={href}
          className="font-semibold text-primary underline-offset-4 hover:underline"
        >
          {name}
        </Link>
      )}
      {leaderName && leaderName !== name ? (
        <span className="text-small font-normal text-muted-foreground">
          팀장 {leaderName}
        </span>
      ) : null}
    </span>
  );
}

function MatrixProgress({
  row,
  milestones,
}: {
  readonly row: MatrixRow;
  readonly milestones: readonly MatrixMilestone[];
}): ReactElement {
  const cells = milestones
    .map(({ id }) => cellForMilestone(row, id))
    .filter(hasMatrixSubmissionStatus);
  const approved = cells.filter(({ status }) => status === 'APPROVED').length;
  if (cells.length === 0)
    return <span className="text-muted-foreground">—</span>;

  return (
    <div
      role="progressbar"
      aria-label={`${row.displayName} 진행`}
      aria-valuemin={0}
      aria-valuemax={cells.length}
      aria-valuenow={approved}
      aria-valuetext={`${cells.length}단계 중 ${approved}단계 승인`}
      className="ml-auto h-1.5 w-14 overflow-hidden rounded-full bg-muted"
    >
      <div
        className="h-full rounded-full bg-primary"
        style={{ width: `${(approved / cells.length) * 100}%` }}
      />
    </div>
  );
}

type MatrixRowsProps = Pick<SubmissionMatrixViewProps, 'programId' | 'now'> & {
  readonly rows: readonly MatrixRow[];
  readonly milestones: readonly MatrixMilestone[];
};

function MatrixOverviewTable({
  rows,
  milestones,
  programId,
  now,
  sort,
  direction,
  onSort,
}: MatrixRowsProps &
  Pick<
    SubmissionMatrixViewProps,
    'sort' | 'direction' | 'onSort'
  >): ReactElement {
  const id = useId();
  const [expandedTeams, setExpandedTeams] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const toggle = (teamId: string) => {
    setExpandedTeams((current) => {
      const next = new Set(current);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  };
  const sortProps = (column: MatrixSort) => ({
    active: sort === column,
    direction,
    onSort: () => onSort(column),
  });

  return (
    <div className={TABLE_CARD}>
      <Table scrollRegionLabel="마일스톤 제출 현황 표">
        <TableHeader>
          <TableRow>
            <SubmissionSortHeader
              {...sortProps('team')}
              className={TEAM_COLUMN}
            >
              팀
            </SubmissionSortHeader>
            {milestones.map((milestone) => (
              <SubmissionSortHeader
                key={milestone.id}
                {...sortProps(`milestone:${milestone.id}`)}
                className="min-w-32 text-center"
              >
                <span className="grid gap-0.5 text-center">
                  <span className="text-table text-foreground">
                    {milestone.name}
                  </span>
                  <SubmissionDeadline dueAt={milestone.dueAt} />
                </span>
              </SubmissionSortHeader>
            ))}
            <SubmissionSortHeader
              {...sortProps('progress')}
              className="text-right"
            >
              진행
            </SubmissionSortHeader>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const expanded = expandedTeams.has(row.teamId);
            const detailsId = `${id}-${row.teamId}`;
            return (
              <Fragment key={row.teamId}>
                <TableRow>
                  <TableHead
                    scope="row"
                    className={cn(
                      TEAM_COLUMN,
                      'p-0 text-table tracking-normal',
                    )}
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      aria-expanded={expanded}
                      aria-controls={expanded ? detailsId : undefined}
                      aria-label={`${row.displayName} 단계별 상세`}
                      onClick={() => toggle(row.teamId)}
                      className="h-auto min-h-control w-full justify-start gap-2 px-4 py-3 whitespace-normal focus-visible:ring-inset"
                    >
                      <ChevronRight
                        aria-hidden="true"
                        className={cn(
                          'size-4 shrink-0',
                          expanded && 'rotate-90',
                        )}
                      />
                      <TeamIdentity
                        name={row.displayName}
                        leaderName={
                          row.applicationMode === 'TEAM' ? row.leaderName : null
                        }
                      />
                    </Button>
                  </TableHead>
                  {milestones.map((milestone) => (
                    <TableCell key={milestone.id} className="text-center">
                      <MatrixCellContent
                        programId={programId}
                        cell={cellForMilestone(row, milestone.id)}
                        milestone={milestone}
                        now={now}
                        iconOnly
                      />
                    </TableCell>
                  ))}
                  <TableCell>
                    <MatrixProgress row={row} milestones={milestones} />
                  </TableCell>
                </TableRow>
                {expanded ? (
                  <TableRow id={detailsId} className="bg-muted/40">
                    <TableCell
                      colSpan={milestones.length + 2}
                      className="px-4 py-3 whitespace-normal"
                    >
                      <dl className="grid gap-x-4 gap-y-2 lg:grid-cols-2">
                        {milestones.map((milestone) => (
                          <div
                            key={milestone.id}
                            className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-small"
                          >
                            <dt className="font-medium">{milestone.name}</dt>
                            <dd>
                              <MatrixCellContent
                                programId={programId}
                                cell={cellForMilestone(row, milestone.id)}
                                milestone={milestone}
                                now={now}
                                showSubmission
                              />
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function MatrixOverviewCards({
  rows,
  milestones,
  programId,
  now,
}: MatrixRowsProps): ReactElement {
  return (
    <ul className="grid gap-3 sm:hidden" aria-label="팀별 제출 현황">
      {rows.map((row) => (
        <li key={row.teamId} className={MOBILE_CARD}>
          <TeamIdentity
            name={row.displayName}
            leaderName={row.applicationMode === 'TEAM' ? row.leaderName : null}
            href={programTeamDetailHref(programId, row.teamId)}
          />
          <dl className="grid gap-2">
            {milestones.map((milestone) => (
              <div
                key={milestone.id}
                className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-0.5"
              >
                <dt className="min-w-0 break-words text-muted-foreground">
                  {milestone.name}
                </dt>
                <dd className="min-w-0">
                  <MatrixCellContent
                    programId={programId}
                    cell={cellForMilestone(row, milestone.id)}
                    milestone={milestone}
                    now={now}
                  />
                </dd>
              </div>
            ))}
          </dl>
        </li>
      ))}
    </ul>
  );
}

export function MatrixBody(
  props: SubmissionMatrixViewProps,
): ReactElement | null {
  if (props.isLoading) return <MatrixSkeleton />;
  if (props.data === null) return null;

  const { milestones, rows, page, pageSize, total } = props.data;
  if (milestones.length === 0) {
    return (
      <EmptyState
        title="마일스톤이 없습니다"
        description="프로그램에 마일스톤을 추가하면 제출 현황을 조회할 수 있습니다."
        action={
          <Button asChild variant="outline">
            <Link href={programEditHref(props.programId)}>마일스톤 추가</Link>
          </Button>
        }
      />
    );
  }

  const totalPages = matrixTotalPages(total, pageSize);
  if (rows.length === 0) {
    if (page > Math.max(1, totalPages)) {
      const lastPage = Math.max(1, totalPages);
      return (
        <EmptyState
          title="이 페이지에는 더 이상 팀이 없습니다"
          action={
            <Button
              type="button"
              variant="outline"
              onClick={() => props.onPageChange(lastPage)}
            >
              {lastPage}페이지로 이동
            </Button>
          }
        />
      );
    }
    if (props.status !== undefined || props.filterActive) {
      return (
        <EmptyState
          title={
            props.status !== undefined
              ? '조건에 맞는 팀이 없습니다'
              : '검색 결과가 없습니다'
          }
          action={
            <Button
              type="button"
              variant="outline"
              onClick={props.onResetFilters}
            >
              필터 초기화
            </Button>
          }
        />
      );
    }
    return (
      <EmptyState
        title="참여 중인 신청이 없습니다"
        description="승인된 신청이 생기면 여기에 표시됩니다."
      />
    );
  }

  const rowsProps = {
    rows,
    milestones,
    programId: props.programId,
    now: props.now,
  };
  return (
    <TooltipProvider>
      <SubmissionStatusLegend />
      <MatrixOverviewTable
        {...rowsProps}
        sort={props.sort}
        direction={props.direction}
        onSort={props.onSort}
      />
      <MatrixOverviewCards {...rowsProps} />
      <MatrixPagination
        page={page}
        totalPages={totalPages}
        onPageChange={props.onPageChange}
      />
    </TooltipProvider>
  );
}

const STAGE_COLUMNS = [
  ['team', '팀'],
  ['document', '서류'],
  ['status', '제출 상태'],
  ['submittedAt', '제출 시각'],
  ['reviewedAt', '최근 검토'],
] as const;
type StageSubmissionSort = (typeof STAGE_COLUMNS)[number][0];

interface StageSubmissionDocument {
  readonly id: string;
  readonly name: string;
}

interface StageSubmissionCell {
  readonly documentId: string;
  readonly isSubmitted: boolean;
  readonly status: Exclude<MatrixCell['status'], 'NOT_SUBMITTED'> | null;
  readonly revision: number | null;
  readonly submittedAt: string | null;
  readonly file: { readonly name: string } | null;
  readonly review: {
    readonly decision: Exclude<
      MatrixCell['status'],
      'NOT_SUBMITTED' | 'SUBMITTED'
    >;
    readonly reviewedAt: string;
  } | null;
}

interface StageSubmissionRow<TCell extends StageSubmissionCell> {
  readonly teamId: string;
  readonly teamName: string;
  readonly applicantName: string | null;
  readonly cells: readonly TCell[];
}

interface StageSubmissionTarget {
  readonly teamId: string;
  readonly documentId: string;
}

export interface StageSubmissionTableProps<TCell extends StageSubmissionCell> {
  readonly programId: string;
  readonly data: {
    readonly milestone: Pick<MatrixMilestone, 'dueAt'>;
    readonly documents: readonly StageSubmissionDocument[];
    readonly rows: readonly StageSubmissionRow<TCell>[];
  };
  readonly now: Date;
  readonly sort: StageSubmissionSort;
  readonly direction: 'asc' | 'desc';
  readonly onSort: (sort: StageSubmissionSort) => void;
  readonly isRefreshing?: boolean;
  readonly reviewTarget: StageSubmissionTarget | null;
  readonly onReviewOpen: (target: StageSubmissionTarget, cell: TCell) => void;
  readonly renderReview: (
    target: StageSubmissionTarget,
    cell: TCell,
  ) => ReactNode;
  readonly fileHref: (target: StageSubmissionTarget) => string;
  readonly downloadBehaviorHintId?: string;
}

const DESKTOP_SUBMISSION_LAYOUT = '(min-width: 40rem)';
function subscribeDesktopLayout(notify: () => void): () => void {
  const query = window.matchMedia?.(DESKTOP_SUBMISSION_LAYOUT);
  query?.addEventListener('change', notify);
  return () => query?.removeEventListener('change', notify);
}
function desktopSubmissionLayout(): boolean {
  return window.matchMedia?.(DESKTOP_SUBMISSION_LAYOUT).matches ?? true;
}
function serverSubmissionLayout(): boolean {
  return true;
}

function StageSubmissionStatus({
  cell,
  dueAt,
  now,
}: {
  readonly cell: StageSubmissionCell;
  readonly dueAt: string;
  readonly now: Date;
}): ReactElement {
  return (
    <SubmissionStatusMark
      status={cell.isSubmitted ? (cell.status ?? 'SUBMITTED') : 'NOT_SUBMITTED'}
      deadline={{ dueAt, now }}
      showOverdueDate
    />
  );
}

function StageTimestamp({
  value,
  detail,
}: {
  readonly value: string | null;
  readonly detail?: string;
}): ReactElement {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="grid gap-0.5">
      <time dateTime={value}>{formatSubmittedAt(value)}</time>
      {detail ? (
        <span className="text-small text-muted-foreground">{detail}</span>
      ) : null}
    </span>
  );
}

interface StageSubmissionEntry<TCell extends StageSubmissionCell> {
  readonly document: StageSubmissionDocument;
  readonly cell: TCell;
}

function isStageReviewOpen(
  reviewTarget: StageSubmissionTarget | null,
  target: StageSubmissionTarget,
): boolean {
  return (
    reviewTarget?.teamId === target.teamId &&
    reviewTarget.documentId === target.documentId
  );
}

function stageActions<TCell extends StageSubmissionCell>(
  props: StageSubmissionTableProps<TCell>,
  row: StageSubmissionRow<TCell>,
  { document, cell }: StageSubmissionEntry<TCell>,
): ReactElement {
  const target = { teamId: row.teamId, documentId: document.id };
  const open = isStageReviewOpen(props.reviewTarget, target);
  return (
    <div className="flex items-center justify-end gap-2">
      {cell.file !== null ? (
        <Button asChild variant="ghost" size="icon-xs">
          <a
            href={props.fileHref(target)}
            aria-label={`${row.teamName} ${document.name} 개별 파일 내려받기: ${cell.file.name}`}
            aria-describedby={props.downloadBehaviorHintId}
            title={cell.file.name}
          >
            <Download aria-hidden="true" />
          </a>
        </Button>
      ) : null}
      {cell.isSubmitted ? (
        <Button
          type="button"
          variant="outline"
          size="xs"
          aria-label={`${row.teamName} ${document.name} 검토`}
          aria-expanded={open}
          onClick={() => props.onReviewOpen(target, cell)}
        >
          검토
        </Button>
      ) : null}
      {cell.file === null && !cell.isSubmitted ? (
        <span className="text-muted-foreground">—</span>
      ) : null}
    </div>
  );
}

export function StageSubmissionTable<TCell extends StageSubmissionCell>(
  props: StageSubmissionTableProps<TCell>,
): ReactElement {
  const { milestone, documents, rows } = props.data;
  const showDocument = documents.length > 1;
  const columns = STAGE_COLUMNS.filter(
    ([column]) => column !== 'document' || showDocument,
  );
  const documentsById = new Map(
    documents.map((document) => [document.id, document]),
  );
  const groups = rows.flatMap((row) => {
    const entries = row.cells.flatMap((cell) => {
      const document = documentsById.get(cell.documentId);
      return document === undefined ? [] : [{ document, cell }];
    });
    const first = entries[0];
    return first === undefined
      ? []
      : [{ row, entries, key: `${row.teamId}/${first.document.id}` }];
  });
  const usesDesktopReviewSlot = useSyncExternalStore(
    subscribeDesktopLayout,
    desktopSubmissionLayout,
    serverSubmissionLayout,
  );
  const identity = (row: StageSubmissionRow<TCell>) => (
    <TeamIdentity
      name={row.teamName}
      leaderName={row.applicantName}
      href={programTeamDetailHref(props.programId, row.teamId)}
    />
  );
  const status = (cell: TCell) => (
    <StageSubmissionStatus
      cell={cell}
      dueAt={milestone.dueAt}
      now={props.now}
    />
  );

  return (
    <TooltipProvider>
      <div className={TABLE_CARD} aria-busy={props.isRefreshing}>
        <Table scrollRegionLabel="팀별 서류 제출 현황 표">
          <TableHeader>
            <TableRow>
              {columns.map(([column, label]) => (
                <SubmissionSortHeader
                  key={column}
                  active={props.sort === column}
                  direction={props.direction}
                  onSort={() => props.onSort(column)}
                  className={column === 'team' ? TEAM_COLUMN : undefined}
                >
                  {label}
                </SubmissionSortHeader>
              ))}
              <TableHead className="text-right">동작</TableHead>
            </TableRow>
          </TableHeader>
          {groups.map(({ row, entries, key }) => {
            const reviewEntry =
              usesDesktopReviewSlot && row.teamId === props.reviewTarget?.teamId
                ? entries.find(
                    ({ document }) =>
                      document.id === props.reviewTarget?.documentId,
                  )
                : undefined;
            return (
              <TableBody
                key={key}
                className="border-b border-border last:border-b-0"
              >
                {entries.map((entry, index) => {
                  const { cell, document } = entry;
                  return (
                    <TableRow key={document.id}>
                      {index === 0 ? (
                        <TableHead
                          scope="rowgroup"
                          rowSpan={entries.length}
                          className={cn(
                            TEAM_COLUMN,
                            'align-top text-table tracking-normal',
                          )}
                        >
                          {identity(row)}
                        </TableHead>
                      ) : null}
                      {showDocument ? (
                        <TableCell className="min-w-32 whitespace-normal">
                          {document.name}
                        </TableCell>
                      ) : null}
                      <TableCell>{status(cell)}</TableCell>
                      <TableCell>
                        <StageTimestamp
                          value={cell.submittedAt}
                          detail={
                            cell.revision === null
                              ? undefined
                              : `v${cell.revision}`
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <StageTimestamp
                          value={cell.review?.reviewedAt ?? null}
                          detail={
                            cell.review === null
                              ? undefined
                              : SUBMISSION_STATUS_LABELS[cell.review.decision]
                          }
                        />
                      </TableCell>
                      <TableCell>{stageActions(props, row, entry)}</TableCell>
                    </TableRow>
                  );
                })}
                {reviewEntry !== undefined ? (
                  <TableRow>
                    <TableCell colSpan={columns.length + 1}>
                      <div
                        data-testid="milestone-document-review-panel-viewport"
                        className="sticky left-0 w-[calc(100vw-4rem)] max-w-3xl"
                      >
                        {props.renderReview(
                          {
                            teamId: row.teamId,
                            documentId: reviewEntry.document.id,
                          },
                          reviewEntry.cell,
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            );
          })}
        </Table>
      </div>
      <ul
        className="grid gap-3 sm:hidden"
        aria-label="팀별 서류 제출 현황"
        aria-busy={props.isRefreshing}
      >
        {groups.map(({ row, entries, key }) => (
          <li key={key} className={MOBILE_CARD}>
            {identity(row)}
            {entries.map((entry) => {
              const { cell, document } = entry;
              const target = { teamId: row.teamId, documentId: document.id };
              return (
                <div
                  key={document.id}
                  className="grid gap-2 border-border [&+&]:border-t [&+&]:pt-3"
                >
                  {showDocument ? (
                    <span className="font-medium">{document.name}</span>
                  ) : null}
                  <dl className="grid gap-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-x-2">
                      <dt className="text-muted-foreground">제출 상태</dt>
                      <dd>{status(cell)}</dd>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-x-2">
                      <dt className="text-muted-foreground">제출 시각</dt>
                      <dd>
                        <StageTimestamp value={cell.submittedAt} />
                      </dd>
                    </div>
                  </dl>
                  {cell.isSubmitted || cell.file !== null
                    ? stageActions(props, row, entry)
                    : null}
                  {!usesDesktopReviewSlot &&
                  isStageReviewOpen(props.reviewTarget, target)
                    ? props.renderReview(target, cell)
                    : null}
                </div>
              );
            })}
          </li>
        ))}
      </ul>
    </TooltipProvider>
  );
}
