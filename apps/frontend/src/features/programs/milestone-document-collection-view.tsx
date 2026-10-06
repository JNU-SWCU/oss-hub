import {
  DOCUMENT_DELIVERY_LABELS,
  DOCUMENT_DELIVERY_VARIANTS,
} from '@/lib/document-delivery';
import Link from 'next/link';
import { Fragment, type ReactElement, type ReactNode } from 'react';
import {
  EmptyState,
  FilterChip,
  FilterChipGroup,
  PageBody,
  PageHeader,
  StatusBadge,
} from '@/components';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton, SkeletonBlock } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { programEditHref } from '@/lib/program-route';
import {
  collectionCellFor,
  collectionDocumentTotalFor,
  collectionEmptyKind,
  collectionFilterCountFor,
  collectionRowMemberSummary,
  isCollectionProgramMismatch,
  MILESTONE_DOCUMENT_COLLECTION_FILTER_LABELS,
  milestoneDocumentCollectionPageState,
  type MilestoneDocumentCollectionLoadPhase,
} from './milestone-document-collection';
import {
  MILESTONE_DOCUMENT_COLLECTION_FILTERS,
  milestoneDocumentCollectionArchiveHref,
  milestoneDocumentCollectionDocumentArchiveHref,
  milestoneDocumentSubmissionFileHref,
  type MilestoneDocumentCollection,
  type MilestoneDocumentCollectionArchiveGrouping,
  type MilestoneDocumentCollectionCell,
  type MilestoneDocumentCollectionDocument,
  type MilestoneDocumentCollectionFilter,
  type MilestoneDocumentCollectionFilterCounts,
  type MilestoneDocumentDeliveryCounts,
  type MilestoneDocumentCollectionRow,
} from './milestone-document-collection-api';
import {
  isSameMilestoneDocumentReviewTarget,
  MILESTONE_DOCUMENT_REVIEW_DISPLAY_LABELS,
  MILESTONE_DOCUMENT_REVIEW_DISPLAY_VARIANTS,
  milestoneDocumentCellDisplay,
  milestoneDocumentReviewVersionOf,
  type MilestoneDocumentReviewFormState,
  type MilestoneDocumentReviewTarget,
  type MilestoneDocumentReviewVersion,
} from './milestone-document-review';
import type { MilestoneDocumentReviewDecision } from './milestone-document-review-api';
import { MilestoneDocumentReviewPanel } from './milestone-document-review-panel';
import {
  formatSeoulDate,
  formatSeoulShortDateTime,
} from './program-detail-format';
import { programHref } from './program-paths';

const SECTION_BODY = 'flex min-w-0 flex-col gap-8';
const TABLE_CARD = 'min-w-0 overflow-hidden rounded-card border border-border';

const STICKY_TEAM_CELL = 'sticky left-0 z-10 min-w-48 bg-background';
const SCROLL_HINT_ID = 'milestone-document-collection-scroll-hint';

const ARCHIVE_HINT_ID = 'milestone-document-collection-archive-hint';
const DOWNLOAD_BEHAVIOR_HINT_ID = 'milestone-document-download-behavior-hint';
const ARCHIVE_GROUPING_ID = 'milestone-document-collection-archive-grouping';

export interface MilestoneDocumentCollectionViewProps {
  readonly programId: string;
  readonly data: MilestoneDocumentCollection | null;
  readonly filter: MilestoneDocumentCollectionFilter;

  readonly loadPhase: MilestoneDocumentCollectionLoadPhase;
  readonly errorMessage: string | null;

  readonly review: MilestoneDocumentReviewFormState | null;

  readonly reviewNotice: string | null;

  readonly archiveGrouping: MilestoneDocumentCollectionArchiveGrouping;
  readonly onArchiveGroupingChange: (
    grouping: MilestoneDocumentCollectionArchiveGrouping,
  ) => void;
  readonly onFilterChange: (filter: MilestoneDocumentCollectionFilter) => void;
  readonly onPageChange: (page: number) => void;
  readonly onRetry: () => void;
  readonly onReviewOpen: (
    target: MilestoneDocumentReviewTarget,
    version: MilestoneDocumentReviewVersion | null,
  ) => void;
  readonly onReviewClose: () => void;
  readonly onReviewDecisionChange: (
    decision: MilestoneDocumentReviewDecision,
  ) => void;
  readonly onReviewCommentChange: (comment: string) => void;
  readonly onReviewResubmissionDueAtChange: (resubmissionDueAt: string) => void;
  readonly onReviewSubmit: () => void;
  readonly onReviewHistoryMore: () => void;
}

function DocumentArchiveIcon(): ReactElement {
  return (
    <svg
      aria-hidden
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5"
    >
      <path d="M12 4v10" />
      <path d="M8 10.5 12 14l4-3.5" />
      <path d="M5 18h14" />
    </svg>
  );
}

function DocumentHeader({
  document,
  milestoneId,
}: {
  readonly document: MilestoneDocumentCollectionDocument;
  readonly milestoneId: string;
}): ReactElement {
  return (
    <span className="flex items-center gap-1">
      <span>
        {document.name}
        {document.isRequired ? (
          <span aria-label="필수" className="ml-0.5 text-destructive">
            *
          </span>
        ) : null}
      </span>

      <Button asChild variant="ghost" size="icon-xs">
        <a
          href={milestoneDocumentCollectionDocumentArchiveHref(
            milestoneId,
            document.id,
          )}
          aria-label={`${document.name} 서류별 내려받기(ZIP)`}
          title={`${document.name} 서류별 내려받기(ZIP)`}
          aria-describedby={`${ARCHIVE_HINT_ID} ${DOWNLOAD_BEHAVIOR_HINT_ID}`}
        >
          <DocumentArchiveIcon />
        </a>
      </Button>
    </span>
  );
}

function SubmittedAt({
  submittedAt,
}: {
  readonly submittedAt: string | null;
}): ReactElement | null {
  if (submittedAt === null) return null;
  return (
    <span className="text-small text-muted-foreground">
      {formatSeoulShortDateTime(submittedAt)}
    </span>
  );
}

function CollectionCellContent({
  cell,
  milestoneId,
  documentId,
  applicationId,
  teamName,
  documentName,
  isReviewOpen,
  onReviewOpen,
}: {
  readonly cell: MilestoneDocumentCollectionCell;
  readonly milestoneId: string;
  readonly documentId: string;
  readonly applicationId: string;
  readonly teamName: string;
  readonly documentName: string;
  readonly isReviewOpen: boolean;
  readonly onReviewOpen: (
    target: MilestoneDocumentReviewTarget,
    version: MilestoneDocumentReviewVersion | null,
  ) => void;
}): ReactElement {
  const display = milestoneDocumentCellDisplay(cell);
  const badge = (
    <StatusBadge variant={MILESTONE_DOCUMENT_REVIEW_DISPLAY_VARIANTS[display]}>
      {MILESTONE_DOCUMENT_REVIEW_DISPLAY_LABELS[display]}
    </StatusBadge>
  );

  return (
    <span className="flex flex-col items-start gap-0.5">
      {cell.isSubmitted ? (
        <Button
          type="button"
          variant="bare"
          size="content"
          aria-expanded={isReviewOpen}
          aria-label={`${teamName} ${documentName} 검토`}
          className="flex flex-col items-start gap-0.5 rounded-control text-left whitespace-nowrap hover:opacity-80"

          onClick={() =>
            onReviewOpen(
              { applicationId, documentId },
              milestoneDocumentReviewVersionOf(cell),
            )
          }
        >
          {badge}
          <SubmittedAt submittedAt={cell.submittedAt} />
        </Button>
      ) : (
        badge
      )}
      {cell.file === null ? null : (
        <a
          href={milestoneDocumentSubmissionFileHref(
            milestoneId,
            documentId,
            applicationId,
          )}
          aria-label={`${teamName} ${documentName} 개별 파일 내려받기: ${cell.file.name}`}
          aria-describedby={DOWNLOAD_BEHAVIOR_HINT_ID}
          title={cell.file.name}
          className="block max-w-56 truncate text-small font-medium underline underline-offset-2 hover:opacity-80"
        >
          {cell.file.name}
        </a>
      )}
    </span>
  );
}

function TeamCellContent({
  row,
}: {
  readonly row: MilestoneDocumentCollectionRow;
}): ReactElement {
  const members = collectionRowMemberSummary(row);
  return (
    <span className="flex flex-col gap-0.5">
      <span className="font-semibold">{row.teamName}</span>
      {members === null ? null : (
        <span className="text-small text-muted-foreground">{members}</span>
      )}
    </span>
  );
}

function CollectionFilterButtons({
  filterCounts,
  deliveryCounts,
  filter,
  onFilterChange,
}: {
  readonly filterCounts: MilestoneDocumentCollectionFilterCounts;
  readonly deliveryCounts: MilestoneDocumentDeliveryCounts;
  readonly filter: MilestoneDocumentCollectionFilter;
  readonly onFilterChange: (filter: MilestoneDocumentCollectionFilter) => void;
}): ReactElement {
  return (
    <FilterChipGroup aria-label="필수 서류 제출 상태">
      <p className="w-full text-small font-semibold">필수 서류 제출 상태</p>
      {MILESTONE_DOCUMENT_COLLECTION_FILTERS.map((option) => (
        <FilterChip
          key={option}
          pressed={filter === option}
          onClick={() => onFilterChange(option)}
        >
          {MILESTONE_DOCUMENT_COLLECTION_FILTER_LABELS[option]}{' '}
          {collectionFilterCountFor(filterCounts, option, deliveryCounts)}팀
        </FilterChip>
      ))}
    </FilterChipGroup>
  );
}

function CollectionArchiveControls({
  milestoneId,
  archiveGrouping,
  onArchiveGroupingChange,
}: {
  readonly milestoneId: string;
  readonly archiveGrouping: MilestoneDocumentCollectionArchiveGrouping;
  readonly onArchiveGroupingChange: (
    grouping: MilestoneDocumentCollectionArchiveGrouping,
  ) => void;
}): ReactElement {
  return (
    <div className="flex min-w-0 flex-col items-start gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        <Button asChild variant="outline">
          <a
            href={milestoneDocumentCollectionArchiveHref(
              milestoneId,
              archiveGrouping,
            )}
            aria-describedby={`${ARCHIVE_HINT_ID} ${DOWNLOAD_BEHAVIOR_HINT_ID}`}
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

      <p
        id={ARCHIVE_HINT_ID}
        className="text-small text-muted-foreground break-keep"
      >
        빠른 필터·페이지와 무관하게 이 마일스톤의 전체 팀을 담습니다.
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
}): ReactElement | null {
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

function ReviewPanelRow({
  data,
  row,
  review,
  onReviewClose,
  onReviewDecisionChange,
  onReviewCommentChange,
  onReviewResubmissionDueAtChange,
  onReviewSubmit,
  onReviewHistoryMore,
}: {
  readonly data: MilestoneDocumentCollection;
  readonly row: MilestoneDocumentCollectionRow;
  readonly review: MilestoneDocumentReviewFormState;
  readonly onReviewClose: () => void;
  readonly onReviewDecisionChange: (
    decision: MilestoneDocumentReviewDecision,
  ) => void;
  readonly onReviewCommentChange: (comment: string) => void;
  readonly onReviewResubmissionDueAtChange: (resubmissionDueAt: string) => void;
  readonly onReviewSubmit: () => void;
  readonly onReviewHistoryMore: () => void;
}): ReactElement | null {
  const { milestone, documents } = data;
  const document = documents.find(
    (candidate) => candidate.id === review.target.documentId,
  );

  if (document === undefined) return null;
  const cell = collectionCellFor(row, document.id);

  return (
    <TableRow>
      <TableCell colSpan={documents.length + 1}>
        <div
          data-testid="milestone-document-review-panel-viewport"
          className="sticky left-0 w-[calc(100vw-4rem)] sm:max-w-3xl"
        >
          <MilestoneDocumentReviewPanel
            teamName={row.teamName}
            documentName={document.name}
            cell={cell}
            fileHref={
              cell.file === null
                ? null
                : milestoneDocumentSubmissionFileHref(
                    milestone.id,
                    document.id,
                    row.applicationId,
                  )
            }
            decision={review.decision}
            comment={review.comment}
            resubmissionDueAt={review.resubmissionDueAt}
            isSubmitting={review.isSubmitting}
            errorMessage={review.errorMessage}
            history={review.history}
            isHistoryLoading={review.isHistoryLoading}
            historyError={review.historyError}
            hasMoreHistory={review.historyNextCursor !== null}
            historyIsComplete={review.historyIsComplete}
            onHistoryMore={onReviewHistoryMore}
            onDecisionChange={onReviewDecisionChange}
            onCommentChange={onReviewCommentChange}
            onResubmissionDueAtChange={onReviewResubmissionDueAtChange}
            onSubmit={onReviewSubmit}
            onClose={onReviewClose}
          />
        </div>
      </TableCell>
    </TableRow>
  );
}

function CollectionTable({
  data,
  loadPhase,
  review,
  onReviewOpen,
  onReviewClose,
  onReviewDecisionChange,
  onReviewCommentChange,
  onReviewResubmissionDueAtChange,
  onReviewSubmit,
  onReviewHistoryMore,
}: {
  readonly data: MilestoneDocumentCollection;
  readonly loadPhase: MilestoneDocumentCollectionLoadPhase;
  readonly review: MilestoneDocumentReviewFormState | null;
  readonly onReviewOpen: (
    target: MilestoneDocumentReviewTarget,
    version: MilestoneDocumentReviewVersion | null,
  ) => void;
  readonly onReviewClose: () => void;
  readonly onReviewDecisionChange: (
    decision: MilestoneDocumentReviewDecision,
  ) => void;
  readonly onReviewCommentChange: (comment: string) => void;
  readonly onReviewResubmissionDueAtChange: (resubmissionDueAt: string) => void;
  readonly onReviewSubmit: () => void;
  readonly onReviewHistoryMore: () => void;
}): ReactElement {
  const { milestone, documents, rows, documentTotals } = data;

  return (
    <div className={TABLE_CARD} aria-busy={loadPhase === 'refreshing'}>
      <Table
        scrollRegionLabel="팀별 서류 수합 표"
        scrollRegionDescribedBy={SCROLL_HINT_ID}
      >
        <TableHeader>
          <TableRow>
            <TableHead className={STICKY_TEAM_CELL}>팀</TableHead>
            {documents.map((document) => (
              <TableHead key={document.id} className="min-w-40">
                <DocumentHeader
                  document={document}
                  milestoneId={milestone.id}
                />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const openReview =
              review !== null &&
              review.target.applicationId === row.applicationId
                ? review
                : null;
            return (
              <Fragment key={row.applicationId}>
                <TableRow>
                  <TableCell className={STICKY_TEAM_CELL}>
                    <TeamCellContent row={row} />
                    <StatusBadge
                      variant={DOCUMENT_DELIVERY_VARIANTS[row.deliveryStatus]}
                    >
                      {DOCUMENT_DELIVERY_LABELS[row.deliveryStatus]}
                    </StatusBadge>
                  </TableCell>
                  {documents.map((document) => (
                    <TableCell key={document.id} className="min-w-40">
                      <CollectionCellContent
                        cell={collectionCellFor(row, document.id)}
                        milestoneId={milestone.id}
                        documentId={document.id}
                        applicationId={row.applicationId}
                        teamName={row.teamName}
                        documentName={document.name}
                        isReviewOpen={
                          openReview !== null &&
                          isSameMilestoneDocumentReviewTarget(
                            openReview.target,
                            {
                              applicationId: row.applicationId,
                              documentId: document.id,
                            },
                          )
                        }
                        onReviewOpen={onReviewOpen}
                      />
                    </TableCell>
                  ))}
                </TableRow>
                {openReview === null ? null : (
                  <ReviewPanelRow
                    data={data}
                    row={row}
                    review={openReview}
                    onReviewClose={onReviewClose}
                    onReviewDecisionChange={onReviewDecisionChange}
                    onReviewCommentChange={onReviewCommentChange}
                    onReviewResubmissionDueAtChange={
                      onReviewResubmissionDueAtChange
                    }
                    onReviewSubmit={onReviewSubmit}
                    onReviewHistoryMore={onReviewHistoryMore}
                  />
                )}
              </Fragment>
            );
          })}
        </TableBody>

        <TableFooter>
          <TableRow>
            <TableCell className={STICKY_TEAM_CELL}>합계</TableCell>
            {documents.map((document) => {
              const total = collectionDocumentTotalFor(
                documentTotals,
                document.id,
              );
              return (
                <TableCell key={document.id} className="min-w-40">
                  제출 {total.submitted} / 전체 {total.total}
                </TableCell>
              );
            })}
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}

function CollectionBody(
  props: MilestoneDocumentCollectionViewProps,
): ReactNode {
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
  if (props.data === null) return null;

  const { milestone, documents, rows, page, pageSize, total, filterCounts } =
    props.data;
  const empty = collectionEmptyKind({
    programId: props.programId,
    milestoneProgramId: milestone.programId,
    documentCount: documents.length,
    applicationCount: filterCounts.all,
    filteredCount: total,
  });

  if (empty === 'wrong-program') {
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

  if (empty === 'no-documents') {
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
  if (empty === 'no-applications') {
    return (
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
    );
  }

  const collectionToolbar = (
    <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <CollectionFilterButtons
        filterCounts={filterCounts}
        deliveryCounts={props.data.deliveryCounts}
        filter={props.filter}
        onFilterChange={props.onFilterChange}
      />
      <CollectionArchiveControls
        milestoneId={milestone.id}
        archiveGrouping={props.archiveGrouping}
        onArchiveGroupingChange={props.onArchiveGroupingChange}
      />
    </div>
  );

  if (empty === 'no-filter-results') {
    return (
      <>
        {collectionToolbar}
        <EmptyState
          title="조건에 맞는 팀이 없습니다"
          description="빠른 필터를 바꿔 다시 확인해 보세요."
          action={
            <Button
              type="button"
              variant="outline"
              onClick={() => props.onFilterChange('ALL')}
            >
              전체 보기
            </Button>
          }
        />
      </>
    );
  }

  const { totalPages, lastPage, outOfRange } =
    milestoneDocumentCollectionPageState({ page, total, pageSize });

  if (outOfRange) {
    return (
      <>
        {collectionToolbar}
        <EmptyState
          title="이 페이지에는 더 이상 팀이 없습니다"
          description={`조건에 맞는 팀이 ${total}팀으로 줄어 이 페이지가 사라졌습니다.`}
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
      </>
    );
  }

  return (
    <>
      {collectionToolbar}

      <p
        id={SCROLL_HINT_ID}
        className="break-keep text-small text-muted-foreground"
      >
        이 페이지 {rows.length}팀(조건에 맞는 전체 {total}팀) · 표는 좌우로{' '}
        <span className="whitespace-nowrap">스크롤해 확인하세요.</span>
      </p>
      <CollectionTable
        data={props.data}
        loadPhase={props.loadPhase}
        review={props.review}
        onReviewOpen={props.onReviewOpen}
        onReviewClose={props.onReviewClose}
        onReviewDecisionChange={props.onReviewDecisionChange}
        onReviewCommentChange={props.onReviewCommentChange}
        onReviewResubmissionDueAtChange={props.onReviewResubmissionDueAtChange}
        onReviewSubmit={props.onReviewSubmit}
        onReviewHistoryMore={props.onReviewHistoryMore}
      />
      <CollectionPagination
        page={page}
        totalPages={totalPages}
        onPageChange={props.onPageChange}
      />
    </>
  );
}

export function MilestoneDocumentCollectionView(
  props: MilestoneDocumentCollectionViewProps,
) {
  const milestone =
    props.data !== null &&
    !isCollectionProgramMismatch({
      programId: props.programId,
      milestoneProgramId: props.data.milestone.programId,
    })
      ? props.data.milestone
      : null;
  return (
    <PageBody>
      <PageHeader
        title={
          milestone === null ? '서류 수합' : `서류 수합 — ${milestone.name}`
        }
        description={
          milestone === null ? undefined : (
            <span className="break-keep">
              {formatSeoulDate(milestone.dueAt)} 마감
            </span>
          )
        }
      />
      <div className={SECTION_BODY}>
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
