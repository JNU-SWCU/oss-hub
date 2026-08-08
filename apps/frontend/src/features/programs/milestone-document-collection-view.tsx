import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';
import { EmptyState, PageBody, PageHeader } from '@/components';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
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
  MILESTONE_DOCUMENT_COLLECTION_FILTER_LABELS,
  milestoneDocumentCollectionPageState,
} from './milestone-document-collection';
import {
  MILESTONE_DOCUMENT_COLLECTION_FILTERS,
  milestoneDocumentSubmissionFileHref,
  type MilestoneDocumentCollection,
  type MilestoneDocumentCollectionCell,
  type MilestoneDocumentCollectionDocument,
  type MilestoneDocumentCollectionFilter,
  type MilestoneDocumentCollectionFilterCounts,
  type MilestoneDocumentCollectionRow,
} from './milestone-document-collection-api';
import {
  formatSeoulDate,
  formatSeoulShortDateTime,
} from './program-detail-format';

const SECTION_BODY = 'flex min-w-0 flex-col gap-8';
const TABLE_CARD = 'min-w-0 overflow-hidden rounded-card border border-border';
/**
 * 첫 열(팀)은 가로로 스크롤해도 남는다 — 열이 밀려 나가면 어느 팀의 칸을 보고
 * 있는지 알 수 없다. 배경색을 함께 주지 않으면 밑을 지나가는 칸이 비쳐 보인다
 * (`features/submissions/components/submission-matrix-view.tsx`와 같은 방식).
 */
const STICKY_TEAM_CELL = 'sticky left-0 z-10 min-w-48 bg-background';
const SCROLL_HINT_ID = 'milestone-document-collection-scroll-hint';

const FILTER_BUTTON_BASE =
  'h-control rounded-control px-4 text-small font-semibold transition-colors';

export interface MilestoneDocumentCollectionViewProps {
  readonly programId: string;
  readonly data: MilestoneDocumentCollection | null;
  readonly filter: MilestoneDocumentCollectionFilter;
  readonly isLoading: boolean;
  readonly errorMessage: string | null;
  readonly onFilterChange: (filter: MilestoneDocumentCollectionFilter) => void;
  readonly onPageChange: (page: number) => void;
  readonly onRetry: () => void;
}

/** 열 머리글 — 서류명 + 필수 표시(`milestone-document-list.tsx`의 `DocumentName`과 같은 표기). */
function DocumentHeader({
  document,
}: {
  readonly document: MilestoneDocumentCollectionDocument;
}): ReactElement {
  return (
    <span>
      {document.name}
      {document.required ? (
        <span aria-label="필수" className="ml-0.5 text-destructive">
          *
        </span>
      ) : null}
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

/**
 * 제출 칸. FILE 유형이고 첨부가 살아 있을 때만 파일명이 다운로드 링크가 된다 —
 * TEXT·저장소 릴리스 제출은 내려받을 것이 없고, FILE이어도 보존 기한이 지난
 * 첨부는 `file`이 비어 온다(백엔드 계약).
 */
function CollectionCellContent({
  cell,
  milestoneId,
  documentId,
  applicationId,
}: {
  readonly cell: MilestoneDocumentCollectionCell;
  readonly milestoneId: string;
  readonly documentId: string;
  readonly applicationId: string;
}): ReactElement {
  if (!cell.submitted) {
    return <span className="text-small text-muted-foreground">미제출</span>;
  }
  if (cell.file === null) {
    return (
      <span className="flex flex-col items-start gap-0.5">
        <span className="text-small">제출됨</span>
        <SubmittedAt submittedAt={cell.submittedAt} />
      </span>
    );
  }
  return (
    <span className="flex flex-col items-start gap-0.5">
      {/* 파일명은 길어도 열 폭을 밀지 않게 자르고, 전체 이름은 title로 남긴다. */}
      <a
        href={milestoneDocumentSubmissionFileHref(
          milestoneId,
          documentId,
          applicationId,
        )}
        title={cell.file.name}
        className="block max-w-56 truncate text-small font-medium underline underline-offset-2 hover:opacity-80"
      >
        {cell.file.name}
      </a>
      <SubmittedAt submittedAt={cell.submittedAt} />
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

/**
 * 필터 칩. 붙는 팀 수는 서버가 준 `filterCounts` 그대로다 — 화면에 있는 것은 한
 * 페이지뿐이라 여기서 세면 「전체 20팀」 같은 페이지 크기가 그대로 튀어나온다.
 */
function CollectionFilterButtons({
  filterCounts,
  filter,
  onFilterChange,
}: {
  readonly filterCounts: MilestoneDocumentCollectionFilterCounts;
  readonly filter: MilestoneDocumentCollectionFilter;
  readonly onFilterChange: (filter: MilestoneDocumentCollectionFilter) => void;
}): ReactElement {
  return (
    <div role="group" aria-label="빠른 필터" className="flex flex-wrap gap-2">
      {MILESTONE_DOCUMENT_COLLECTION_FILTERS.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={filter === option}
          className={
            filter === option
              ? `${FILTER_BUTTON_BASE} bg-secondary text-foreground`
              : `${FILTER_BUTTON_BASE} bg-card text-muted-foreground border border-border`
          }
          onClick={() => onFilterChange(option)}
        >
          {MILESTONE_DOCUMENT_COLLECTION_FILTER_LABELS[option]}{' '}
          {collectionFilterCountFor(filterCounts, option)}팀
        </button>
      ))}
    </div>
  );
}

/**
 * 페이지 이동. 제출 현황 표(`features/submissions/components/submission-matrix-view.tsx`의
 * `MatrixPagination`)와 같은 모양·같은 문구를 쓴다 — 같은 종류의 표를 두 벌의 조작으로
 * 만들지 않는다. 한 페이지에 다 들어가면 그리지 않는다.
 */
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

function CollectionTable({
  data,
}: {
  readonly data: MilestoneDocumentCollection;
}): ReactElement {
  const { milestone, documents, rows, documentTotals } = data;

  return (
    <div className={TABLE_CARD}>
      <Table
        scrollRegionLabel="팀별 서류 수합 표"
        scrollRegionDescribedBy={SCROLL_HINT_ID}
      >
        <TableHeader>
          <TableRow>
            <TableHead className={STICKY_TEAM_CELL}>팀</TableHead>
            {documents.map((document) => (
              <TableHead key={document.id} className="min-w-40">
                <DocumentHeader document={document} />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.applicationId}>
              <TableCell className={STICKY_TEAM_CELL}>
                <TeamCellContent row={row} />
              </TableCell>
              {documents.map((document) => (
                <TableCell key={document.id} className="min-w-40">
                  <CollectionCellContent
                    cell={collectionCellFor(row, document.id)}
                    milestoneId={milestone.id}
                    documentId={document.id}
                    applicationId={row.applicationId}
                  />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
        {/*
         * 합계는 열(documents)을 따라 그린다 — `documentTotals` 순서를 그대로 믿고
         * 그리면 두 배열의 순서가 어긋났을 때 합계가 남의 열에 가서 앉는다.
         * 분모는 이 페이지가 아니라 마일스톤 전체 팀 수다(서버가 그렇게 낸다).
         */}
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
  if (props.isLoading) {
    return (
      <div
        aria-busy="true"
        aria-label="서류 수합 표를 불러오는 중"
        className="flex flex-col gap-3 rounded-card border border-border p-card"
      >
        <span className="bg-muted h-4 w-1/3 animate-pulse rounded" />
        {[0, 1, 2, 3].map((row) => (
          <span
            key={row}
            className="bg-muted h-3 w-full animate-pulse rounded"
          />
        ))}
      </div>
    );
  }
  if (props.data === null) return null;

  const { documents, rows, page, pageSize, total, filterCounts } = props.data;
  const empty = collectionEmptyKind({
    documentCount: documents.length,
    applicationCount: filterCounts.all,
    filteredCount: total,
  });

  if (empty === 'no-documents') {
    return (
      <EmptyState
        title="이 마일스톤에는 등록된 서류 항목이 없습니다"
        description="프로그램 편집에서 서류 항목을 추가하면 팀별 제출 현황을 모아 볼 수 있습니다."
        action={
          <Button asChild variant="outline">
            <Link href={programEditHref(props.programId)}>
              프로그램 편집에서 서류 항목 추가
            </Link>
          </Button>
        }
      />
    );
  }
  if (empty === 'no-applications') {
    return (
      <EmptyState
        title="아직 승인된 신청이 없습니다"
        description="신청이 승인되면 팀이 이 표에 나타납니다."
      />
    );
  }

  const filterButtons = (
    <CollectionFilterButtons
      filterCounts={filterCounts}
      filter={props.filter}
      onFilterChange={props.onFilterChange}
    />
  );

  // 필터에 아무도 안 걸린 경우 — 「승인된 신청이 없다」와 다른 상황이라 필터 칩은
  // 그대로 두고 되돌릴 길만 준다.
  if (empty === 'no-filter-results') {
    return (
      <>
        {filterButtons}
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

  /*
   * 보고 있던 페이지가 결과 밖으로 밀려난 경우 — 팀들이 제출을 마쳐 「필수 서류 미제출」이
   * 2페이지에서 1페이지로 줄면 응답은 빈 2페이지로 온다. 페이지 이동 UI는 한 페이지짜리
   * 결과에서 그리지 않으므로, 여기서 내려앉을 길을 주지 않으면 빈 표에 갇힌다.
   */
  if (outOfRange) {
    return (
      <>
        {filterButtons}
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
      {filterButtons}
      {/*
       * 「이 페이지 N팀(조건에 맞는 전체 M팀)」 — 표에 보이는 것이 전부가 아님을
       * 먼저 말한다(제출 현황 표의 같은 자리와 같은 문장 틀).
       */}
      <p id={SCROLL_HINT_ID} className="text-small text-muted-foreground">
        이 페이지 {rows.length}팀(조건에 맞는 전체 {total}팀) · 표를 좌우로
        스크롤할 수 있습니다.
      </p>
      <CollectionTable data={props.data} />
      <CollectionPagination
        page={page}
        totalPages={totalPages}
        onPageChange={props.onPageChange}
      />
    </>
  );
}

/**
 * 서류 수합 화면의 표시 전담부. 조회·상태는 컨테이너
 * (`milestone-document-collection-screen.tsx`)가 갖고 여기는 props만 그린다 —
 * 정적 렌더로 문구·링크를 검증할 수 있게 하려는 분리다.
 */
export function MilestoneDocumentCollectionView(
  props: MilestoneDocumentCollectionViewProps,
) {
  const milestone = props.data?.milestone ?? null;
  return (
    <PageBody>
      <PageHeader
        title={
          milestone === null ? '서류 수합' : `서류 수합 — ${milestone.name}`
        }
        description={
          milestone === null ? undefined : (
            <span className="break-keep">
              {formatSeoulDate(milestone.dueAt)} 마감 · 팀별 제출 여부와 제출
              시각을 확인합니다.
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
        <CollectionBody {...props} />
      </div>
    </PageBody>
  );
}
