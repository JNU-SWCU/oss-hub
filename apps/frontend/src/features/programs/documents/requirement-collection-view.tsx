import Link from 'next/link';
import type { ComponentType, ReactNode } from 'react';
import { EmptyState, PageBody, PageHeader, TeamSearchForm } from '@/components';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton, SkeletonBlock } from '@/components/ui/skeleton';
import { programEditHref } from '@/lib/program-route';
import {
  isCollectionProgramMismatch,
  requirementCollectionPageState,
  type RequirementCollectionLoadPhase,
} from './requirement-collection';
import {
  requirementCollectionArchiveHref,
  requirementCollectionDocumentArchiveHref,
  submissionFileHref,
} from './requirement-collection-api';
import type {
  RequirementCollection,
  RequirementCollectionArchiveGrouping,
  RequirementCollectionCell,
  RequirementCollectionSort,
  RequirementCollectionStatus,
  RequirementCollectionStatusCounts,
} from './requirement-collection-dto';
import {
  isSameRequirementReviewTarget,
  type RequirementReviewFormState,
  type RequirementReviewTarget,
} from './requirement-review';
import type { RequirementReviewDecision } from './requirement-review-dto';
import { RequirementReviewPanel } from './requirement-review-panel';
import { formatSeoulDate } from '../catalog/program-detail-format';
import { programHref } from '../program-paths';

const ARCHIVE_HINT_ID = 'milestone-document-collection-archive-hint';
const DOWNLOAD_BEHAVIOR_HINT_ID = 'milestone-document-download-behavior-hint';
const ARCHIVE_GROUPING_ID = 'milestone-document-collection-archive-grouping';

export interface RequirementCollectionPresentation {
  readonly Table: ComponentType<{
    readonly programId: string;
    readonly data: RequirementCollection;
    readonly now: Date;
    readonly sort: RequirementCollectionSort;
    readonly direction: 'asc' | 'desc';
    readonly onSort: (sort: RequirementCollectionSort) => void;
    readonly isRefreshing: boolean;
    readonly reviewTarget: RequirementReviewTarget | null;
    readonly onReviewOpen: (
      target: RequirementReviewTarget,
      cell: RequirementCollectionCell,
    ) => void;
    readonly renderReview: (
      target: RequirementReviewTarget,
      cell: RequirementCollectionCell,
    ) => ReactNode;
    readonly fileHref: (target: RequirementReviewTarget) => string;
    readonly downloadBehaviorHintId: string;
  }>;
  readonly StatusFilters: ComponentType<{
    readonly status?: RequirementCollectionStatus;
    readonly counts?: RequirementCollectionStatusCounts;
    readonly onStatusChange: (
      status: RequirementCollectionStatus | undefined,
    ) => void;
  }>;
}

export interface RequirementCollectionViewProps extends RequirementCollectionPresentation {
  readonly programId: string;
  readonly headerActions?: ReactNode;
  readonly data: RequirementCollection | null;
  readonly search: string;
  readonly searchQuery: string;
  readonly onSearchChange: (value: string) => void;
  readonly onSearch: () => void;
  readonly status?: RequirementCollectionStatus;
  readonly sort: RequirementCollectionSort;
  readonly direction: 'asc' | 'desc';
  readonly onStatusChange: (
    status: RequirementCollectionStatus | undefined,
  ) => void;
  readonly onSort: (sort: RequirementCollectionSort) => void;
  readonly loadPhase: RequirementCollectionLoadPhase;
  readonly errorMessage: string | null;
  readonly review:
    | (RequirementReviewFormState & {
        readonly cell: RequirementCollectionCell;
      })
    | null;
  readonly reviewNotice: string | null;
  readonly archiveGrouping: RequirementCollectionArchiveGrouping;
  readonly onArchiveGroupingChange: (
    grouping: RequirementCollectionArchiveGrouping,
  ) => void;
  readonly onResetFilters: () => void;
  readonly onPageChange: (page: number) => void;
  readonly onRetry: () => void;
  readonly onReviewOpen: (
    target: RequirementReviewTarget,
    cell: RequirementCollectionCell,
  ) => void;
  readonly onReviewClose: () => void;
  readonly onReviewDecisionChange: (
    decision: RequirementReviewDecision,
  ) => void;
  readonly onReviewCommentChange: (comment: string) => void;
  readonly onReviewSubmit: () => void;
  readonly onReviewHistoryMore: () => void;
}

function CollectionArchiveControls({
  data: { milestone, documents },
  archiveGrouping,
  onArchiveGroupingChange,
}: Pick<
  RequirementCollectionViewProps,
  'archiveGrouping' | 'onArchiveGroupingChange'
> & {
  readonly data: RequirementCollection;
}) {
  const describedBy = `${ARCHIVE_HINT_ID} ${DOWNLOAD_BEHAVIOR_HINT_ID}`;
  return (
    <div className="flex min-w-0 flex-col items-start gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        <Button asChild variant="outline">
          <a
            href={requirementCollectionArchiveHref(
              milestone.id,
              archiveGrouping,
            )}
            aria-describedby={describedBy}
          >
            마일스톤 전체 내려받기(ZIP)
          </a>
        </Button>
        <span className="flex min-w-0 items-center gap-2">
          <input
            id={ARCHIVE_GROUPING_ID}
            type="checkbox"
            checked={archiveGrouping === 'DOCUMENT'}
            onChange={(event) =>
              onArchiveGroupingChange(
                event.target.checked ? 'DOCUMENT' : 'TEAM',
              )
            }
          />
          <label
            htmlFor={ARCHIVE_GROUPING_ID}
            className="text-small font-semibold break-keep"
          >
            서류 종류별로 묶기
          </label>
        </span>
      </div>
      <ul aria-label="서류별 ZIP 내려받기" className="flex flex-wrap gap-2">
        {documents.map((document) => (
          <li key={document.id}>
            <Button asChild variant="ghost" size="xs">
              <a
                href={requirementCollectionDocumentArchiveHref(
                  milestone.id,
                  document.id,
                )}
                aria-label={`${document.name} 서류별 내려받기(ZIP)`}
                aria-describedby={describedBy}
              >
                {document.name} ZIP
              </a>
            </Button>
          </li>
        ))}
      </ul>
      <p
        id={ARCHIVE_HINT_ID}
        className="text-small text-muted-foreground break-keep"
      >
        검색·필터·페이지와 무관하게 이 마일스톤의 전체 팀을 담습니다.
      </p>
      <p
        id={DOWNLOAD_BEHAVIOR_HINT_ID}
        className="text-small text-muted-foreground break-keep"
      >
        다운로드 진행 상태는 브라우저에서 확인하세요. 실패하면 안내 화면이
        열립니다.
      </p>
    </div>
  );
}

function CollectionPagination({
  page,
  totalPages,
  onPageChange,
}: {
  readonly page: number;
  readonly totalPages: number;
  readonly onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav
      aria-label="서류 수합 페이지"
      className="flex items-center justify-center gap-3"
    >
      <Button
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        variant="outline"
      >
        이전
      </Button>
      <span className="text-small text-muted-foreground">
        {page} / {totalPages}
      </span>
      <Button
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        variant="outline"
      >
        다음
      </Button>
    </nav>
  );
}

function CollectionBody(props: RequirementCollectionViewProps) {
  if (props.loadPhase === 'skeleton') {
    return (
      <Skeleton
        label="서류 수합 표를 불러오는 중"
        className="flex flex-col gap-3 rounded-card border border-border p-card"
      >
        <SkeletonBlock className="h-4 w-1/3 rounded" />
        {[0, 1, 2, 3].map((row) => (
          <SkeletonBlock key={row} className="h-3 w-full rounded" />
        ))}
      </Skeleton>
    );
  }
  const data = props.data;
  if (data === null) return null;
  const { milestone, documents, rows, page, pageSize, total, filterCounts } =
    data;
  if (
    isCollectionProgramMismatch({
      programId: props.programId,
      milestoneProgramId: milestone.programId,
    })
  ) {
    return (
      <EmptyState
        title="이 프로그램에서 찾을 수 없는 마일스톤입니다"
        description="주소의 프로그램과 마일스톤이 서로 다릅니다. 프로그램 상세에서 마일스톤을 다시 골라 주세요."
        action={
          <Button asChild variant="link">
            <Link href={programHref(props.programId)}>프로그램 개요</Link>
          </Button>
        }
      />
    );
  }
  if (documents.length === 0) {
    return (
      <EmptyState
        title="이 마일스톤에는 등록된 제출 항목이 없습니다"
        description="프로그램 편집에서 제출 항목을 추가하면 팀별 제출 현황을 모아 볼 수 있습니다."
        action={
          <Button asChild variant="outline">
            <Link href={programEditHref(props.programId)}>제출 항목 추가</Link>
          </Button>
        }
      />
    );
  }

  const { totalPages, lastPage, outOfRange } = requirementCollectionPageState({
    page,
    total,
    pageSize,
  });
  const fileHref = ({ documentId, teamId }: RequirementReviewTarget) =>
    submissionFileHref(milestone.id, documentId, teamId);
  return (
    <>
      <props.StatusFilters
        status={props.status}
        counts={data.statusCounts}
        onStatusChange={props.onStatusChange}
      />
      <CollectionArchiveControls
        data={data}
        archiveGrouping={props.archiveGrouping}
        onArchiveGroupingChange={props.onArchiveGroupingChange}
      />
      {filterCounts.all === 0 && props.searchQuery === '' ? (
        <EmptyState
          title="아직 승인된 신청이 없습니다"
          description="대기 중인 신청을 먼저 확인해 주세요. 신청을 승인하면 팀이 이 표에 나타납니다."
          action={
            <Button asChild variant="outline">
              <Link href={programHref(props.programId, '/teams')}>
                신청 확인하기
              </Link>
            </Button>
          }
        />
      ) : total === 0 ? (
        <EmptyState
          title="조건에 맞는 제출 항목이 없습니다"
          action={
            <Button
              type="button"
              variant="outline"
              onClick={props.onResetFilters}
            >
              전체 보기
            </Button>
          }
        />
      ) : outOfRange ? (
        <EmptyState
          title="이 페이지에는 더 이상 제출 항목이 없습니다"
          description={`조건에 맞는 제출 항목이 ${total}개로 줄어 이 페이지가 사라졌습니다.`}
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
      ) : (
        <>
          <props.Table
            programId={props.programId}
            data={data}
            now={new Date()}
            sort={props.sort}
            direction={props.direction}
            onSort={props.onSort}
            isRefreshing={props.loadPhase === 'refreshing'}
            reviewTarget={props.review?.target ?? null}
            onReviewOpen={props.onReviewOpen}
            renderReview={(target) => {
              const review = props.review;
              if (
                review === null ||
                !isSameRequirementReviewTarget(review.target, target)
              )
                return null;
              const row = rows.find(({ teamId }) => teamId === target.teamId);
              const document = documents.find(
                ({ id }) => id === target.documentId,
              );
              if (row === undefined || document === undefined) return null;
              return (
                <RequirementReviewPanel
                  teamName={row.teamName}
                  documentName={document.name}
                  cell={review.cell}
                  fileHref={review.cell.file === null ? null : fileHref(target)}
                  decision={review.decision}
                  comment={review.comment}
                  isSubmitting={review.isSubmitting}
                  errorMessage={review.errorMessage}
                  history={review.history}
                  isHistoryLoading={review.isHistoryLoading}
                  historyError={review.historyError}
                  hasMoreHistory={review.historyNextCursor !== null}
                  historyIsComplete={review.historyIsComplete}
                  onHistoryMore={props.onReviewHistoryMore}
                  onDecisionChange={props.onReviewDecisionChange}
                  onCommentChange={props.onReviewCommentChange}
                  onSubmit={props.onReviewSubmit}
                  onClose={props.onReviewClose}
                />
              );
            }}
            fileHref={fileHref}
            downloadBehaviorHintId={DOWNLOAD_BEHAVIOR_HINT_ID}
          />
          <CollectionPagination
            page={page}
            totalPages={totalPages}
            onPageChange={props.onPageChange}
          />
        </>
      )}
    </>
  );
}

export function RequirementCollectionView(
  props: RequirementCollectionViewProps,
) {
  const data = props.data;
  const showMilestone =
    data !== null &&
    !isCollectionProgramMismatch({
      programId: props.programId,
      milestoneProgramId: data.milestone.programId,
    });
  return (
    <PageBody>
      <PageHeader
        title={
          showMilestone ? `서류 수합 — ${data.milestone.name}` : '서류 수합'
        }
        actions={props.headerActions}
        description={
          showMilestone ? (
            <span className="break-keep">
              {formatSeoulDate(data.milestone.dueAt)} 마감 · 서류{' '}
              {data.documents.length}종
            </span>
          ) : undefined
        }
      />
      <div className="flex min-w-0 flex-col gap-8">
        <TeamSearchForm
          inputId="collection-search"
          search={props.search}
          resettable={
            props.search.trim() !== '' ||
            props.searchQuery !== '' ||
            props.status !== undefined
          }
          onSearchChange={props.onSearchChange}
          onSearch={props.onSearch}
          onReset={props.onResetFilters}
        />
        {props.errorMessage !== null ? (
          <Alert variant="destructive">
            <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>{props.errorMessage}</span>
              <Button
                type="button"
                variant="outline"
                className="h-control"
                onClick={props.onRetry}
              >
                다시 시도
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {props.reviewNotice === null ? null : (
          <Alert data-testid="milestone-document-review-notice">
            <AlertDescription className="break-keep">
              {props.reviewNotice}
            </AlertDescription>
          </Alert>
        )}
        <CollectionBody {...props} />
      </div>
    </PageBody>
  );
}
