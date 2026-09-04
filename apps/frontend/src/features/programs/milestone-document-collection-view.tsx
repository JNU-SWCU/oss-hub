import Link from 'next/link';
import { Fragment, type ReactElement, type ReactNode } from 'react';
import { EmptyState, PageBody, PageHeader, StatusBadge } from '@/components';
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
import { programApplicantsHref, programEditHref } from '@/lib/program-route';
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
/**
 * 첫 열(팀)은 가로로 스크롤해도 남는다 — 열이 밀려 나가면 어느 팀의 칸을 보고
 * 있는지 알 수 없다. 배경색을 함께 주지 않으면 밑을 지나가는 칸이 비쳐 보인다
 * (`features/submissions/components/submission-matrix-view.tsx`와 같은 방식).
 */
const STICKY_TEAM_CELL = 'sticky left-0 z-10 min-w-48 bg-background';
const SCROLL_HINT_ID = 'milestone-document-collection-scroll-hint';
/**
 * ZIP 링크가 가리키는 설명. 표 위 안내문(`SCROLL_HINT_ID`)과 **다른 문단**이다 —
 * 그쪽은 「지금 보고 있는 표」가 페이지 한 장임을 말하고, 이쪽은 「받는 ZIP」이 그
 * 표와 무관하다는 정반대의 사실을 말한다. 한 문단에 붙이면 둘이 섞여 읽힌다.
 *
 * ⚠ 이 화면의 **두 내려받기가 함께** 가리킨다 — 조작 줄의 전체 ZIP과 표 열 머리글의
 * 서류별 ZIP(`DocumentHeader`). 서류별 버튼이 생겼을 때 문구를 손대지 않은 이유는,
 * 이 한 줄이 말하는 사실(「빠른 필터·페이지를 따라가지 않고 전 팀을 담는다」)이 **둘
 * 모두에 그대로 맞는 말**이기 때문이다. 좁아지는 것은 담는 팀이 아니라 서류 종류이고,
 * 그건 버튼 자신이 서류 이름으로 말한다. 여기에 「전체 ZIP은…, 서류별은…」을 덧붙이면
 * 정작 이 문단이 막으려던 오해(걸러 놓은 팀만 담긴다는 오독)가 긴 문장에 묻힌다.
 */
const ARCHIVE_HINT_ID = 'milestone-document-collection-archive-hint';
const DOWNLOAD_BEHAVIOR_HINT_ID = 'milestone-document-download-behavior-hint';
const ARCHIVE_GROUPING_ID = 'milestone-document-collection-archive-grouping';

const FILTER_BUTTON_BASE =
  'h-control rounded-control px-4 text-small font-semibold transition-colors';

export interface MilestoneDocumentCollectionViewProps {
  readonly programId: string;
  readonly data: MilestoneDocumentCollection | null;
  readonly filter: MilestoneDocumentCollectionFilter;
  /**
   * 뼈대를 그릴지, 있는 표를 그대로 두고 뒤에서 갱신할지
   * (`milestoneDocumentCollectionLoadPhase`가 정한다 — 그 판정을 여기서 다시 하지 않는다).
   */
  readonly loadPhase: MilestoneDocumentCollectionLoadPhase;
  readonly errorMessage: string | null;
  /** 지금 열려 있는 판정 패널. 닫혀 있으면 `null`. */
  readonly review: MilestoneDocumentReviewFormState | null;
  /**
   * 판정이 저장되지 않고 버려졌음을 알리는 문구. 패널을 닫아 버린 뒤에도 **무슨 일이
   * 났는지** 말할 자리가 필요해서 표 쪽에 둔다(패널 안 오류 문구와 다른 자리다).
   */
  readonly reviewNotice: string | null;
  /**
   * 전체 제출물 ZIP의 폴더 구조. **조회 조건이 아니다** — 이 값이 바뀌어도 표는 그대로고
   * 내려받기 링크의 `groupBy`만 바뀐다(컨테이너가 `useState`로만 들고 있는 이유다).
   */
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

/**
 * 서류 한 종류 ZIP 버튼의 아이콘 — 「받침으로 내려오는 화살표」.
 *
 * 인라인으로 그린다. 이 저장소에 있는 아이콘 묶음(`app/_shell/shell-icons.tsx`)은
 * 셸 전용이고 features는 app을 import할 수 없으며(`eslint.config.mjs`의 단방향 의존
 * 규칙), 거기에 받침 화살표도 없다. 아이콘 하나를 위해 라이브러리를 새로 들이지
 * 않는다 — 대신 그 묶음과 같은 표기(viewBox 24·stroke 1.7·round)를 써서 나중에
 * 공용으로 올릴 때 모양이 어긋나지 않게 한다.
 *
 * `aria-hidden`이다. 무엇을 받는지는 감싸는 `<a>`의 `aria-label`이 말한다 —
 * 아이콘까지 읽히면 같은 말이 두 번 들린다.
 */
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

/**
 * 열 머리글 — 서류명 + 필수 표시(`milestone-document-list.tsx`의 `DocumentName`과 같은
 * 표기) + **그 서류만 받는 ZIP 버튼**.
 *
 * 왜 열 머리글인가 — 「사업계획서만 전 팀 것을 모아 심사위원에게」가 실제 동선인데,
 * 그 전에는 47팀의 칸을 하나씩 눌러야 했다. 열 머리글은 「이 열 = 이 서류」가 이미
 * 서 있는 자리라 무엇을 받는지 따로 설명할 필요가 없다.
 *
 * ⚠ **호버로 나타내지 않는다.** 항상 보이되 작게(24px 안팎) 둔다 — 호버로 숨기면
 * 키보드·터치 사용자에게는 없는 기능이 되고, 그런 지적이 이 저장소의 접근성 QA에
 * 이미 여러 번 올라왔다.
 */
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
      {/*
       * 전체 ZIP 링크와 **같은 이유로 `download` 속성을 쓰지 않는다** — 붙이면
       * 브라우저가 응답 본문을 상태 코드와 무관하게 파일로 저장해, 401·403·404가
       * 나도 교직원은 오류 대신 오류 JSON이 담긴 파일을 받는다(위
       * `CollectionArchiveControls`의 같은 주석 참고). 성공 응답은 서버의
       * `Content-Disposition: attachment`가 그대로 내려받게 한다.
       *
       * 아이콘만 있는 버튼이라 `aria-label`에 **서류 이름을 넣는다**. 열이 여러 개고
       * 머리글마다 같은 버튼이 서므로, 「내려받기」만 있으면 스크린리더에서 47개의
       * 같은 이름이 늘어서 어느 서류인지 고를 수 없다.
       *
       * 설명은 전체 ZIP과 같은 문단(`ARCHIVE_HINT_ID`)을 가리킨다 — 이 ZIP도 빠른
       * 필터·페이지를 따라가지 않고 전 팀을 담으므로 그 한 줄이 그대로 맞는 말이다.
       * 표가 서는 화면에는 그 문단이 언제나 함께 있다(둘 다 같은 갈래에서 그려진다).
       */}
      {/*
       * ⚠ 공용 `Button`을 지나야 한다 — 직접 그린 24px 링크로 뒀더니 **터치 타깃이 24×24**가
       * 되고 초점 표시도 이 저장소의 것과 달랐다. `button.tsx`가 「조작 가능한 사각형은 전부
       * 44px이고 그 아래로 내려가면 터치 타깃 최소치가 깨진다」를 못박고 있고, 액션 트리거는
       * 전부 이 프리미티브를 기반으로 한다(`docs/design.md`의 Button 절).
       *
       * `icon-xs`는 **누를 수 있는 자리만 44px**로 넓히고 배경이 없어(`ghost`) 머리글에서 서류
       * 이름을 밀어내지 않는다. 보이는 아이콘은 `size-5`(20px)로 따로 잡았다 — 이 변형의
       * 기본값 16px 은 서류 이름에 딸린 장식처럼 읽혀 있는 줄 모르고 지나치고, 24px 은 열이
       * 여러 개일 때 서류 이름보다 아이콘이 먼저 눈에 들어온다. 세 크기를 실제 화면으로 놓고
       * 고른 값이다.
       */}
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

/**
 * 제출 칸. 배지는 제출 여부가 아니라 **판정까지 접은 다섯 갈래**를 말한다
 * (미제출 · 검토 대기 · 승인 · 보완 요청 · 반려). 색은 전부 기존 `StatusBadge` 변형이다.
 *
 * ⚠ 배지가 바뀌어도 **필터·합계는 그대로다**. 「미제출」 기준은 여전히 「제출 행이 없다」이고
 * 그 셈은 서버가 한다 — 반려된 칸을 미제출로 세기 시작하면 독촉 대상이 조용히 달라진다.
 *
 * 제출된 칸만 눌러 판정을 연다. 미제출 칸을 눌러 봐야 서버는 404(MSD_022)만 돌려주므로
 * 누를 수 있는 것처럼 보이게 하지 않는다.
 *
 * 파일명 링크는 버튼 **밖**에 둔다 — `<button>` 안의 `<a>`는 유효하지 않은 마크업이고,
 * 실제로도 내려받기와 판정 열기는 서로 다른 행동이다. FILE 유형이고 첨부가 살아 있을
 * 때만 링크가 붙는다(TEXT는 내려받을 것이 없고, 보존 기한이 지난 첨부는
 * `file`이 비어 온다 — 백엔드 계약).
 */
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
        <button
          type="button"
          aria-expanded={isReviewOpen}
          aria-label={`${teamName} ${documentName} 검토`}
          className="flex flex-col items-start gap-0.5 rounded-control text-left hover:opacity-80"
          /*
           * 판정을 묶어 둘 버전을 **이 순간의 칸에서** 떠 온다. 저장할 때 다시 읽으면
           * 그때의 최신값이 실려 서버의 대조가 언제나 통과하고, 그 사이 학생이 다시 낸
           * 내용이 못 본 채로 승인된다.
           */
          onClick={() =>
            onReviewOpen(
              { applicationId, documentId },
              milestoneDocumentReviewVersionOf(cell),
            )
          }
        >
          {badge}
          <SubmittedAt submittedAt={cell.submittedAt} />
        </button>
      ) : (
        badge
      )}
      {cell.file === null ? null : (
        // 파일명은 길어도 열 폭을 밀지 않게 자르고, 전체 이름은 title로 남긴다.
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
 * 전체 제출물 ZIP 조작 — 내려받기 링크 하나와 폴더 구조 토글 하나.
 *
 * 토글을 바꾸면 링크의 `href`가 그 자리에서 바뀐다. **담기는 파일은 같고 ZIP 안의 경로만
 * 뒤집힌다** — 조회를 다시 부르지 않는 이유이자, 이 토글을 조회 조건 옆에 두면서도
 * 필터 칩과 다른 무리로 묶어 그리는 이유다.
 */
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
          {/*
           * 앱 안의 이동이 아니라 **파일을 받는 링크**라 `next/link`가 아니라 평범한
           * `<a>`다. 라우터가 가로채면 이 경로를 화면 전환으로 다루려 들어 응답이
           * 파일로 떨어지지 않는다.
           *
           * ⚠ **`download` 속성을 일부러 안 쓴다.** 그 속성이 붙으면 브라우저가 응답
           * 본문을 **상태 코드와 무관하게** 파일로 저장한다 — 세션이 만료되거나(401)
           * 권한이 사라지거나(403) 마일스톤이 없어지면(404) 교직원은 오류 대신
           * **오류 JSON이 담긴 파일**을 받고 무엇이 잘못됐는지 영영 모른다. 속성이
           * 없어도 성공 응답은 서버의 `Content-Disposition: attachment`가 그대로
           * 내려받게 하므로 정상 동선은 똑같다. 같은 화면의 제출 파일 링크도 같은 방식이다.
           */}
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
        {/*
         * 라벨을 `htmlFor`로 묶어 스크린리더가 「무엇을 켜는가」를 읽게 한다 — 체크박스만
         * 두면 「선택 안 함」만 들린다. 표기는 이 저장소의 다른 체크박스와 같은 모양이다
         * (`milestone-document-editor.tsx`의 「필수 제출」).
         */}
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
      {/*
       * ZIP이 화면과 다른 것을 담는다는 사실은 **받기 전에** 말해야 한다. 「필수 서류
       * 미제출」로 걸러 놓은 교직원은 눈앞의 표가 곧 받을 것이라고 읽으므로, 이 한 줄이
       * 없으면 전체가 담긴 ZIP을 독촉 대상 명단으로 오해한 채 배포한다.
       */}
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
        진행 상태와 완료 여부는 브라우저에서 확인합니다. 요청이 실패하면 오류
        응답을 파일로 저장하지 않고 안내 화면을 엽니다.
      </p>
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

/**
 * 판정 패널을 **표 안에**, 방금 누른 팀의 행 바로 아래에 편다. 다른 화면으로 넘기지
 * 않는 것이 이 기능의 요구다 — 교직원은 여러 건을 연달아 처리하는데, 표를 떠나면
 * 어디까지 봤는지 잃는다. `colSpan`으로 열 전체를 덮어 판정 칸이 남의 열에 앉지 않게 한다.
 */
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
  // 열이 사라진 뒤(서류 항목 삭제·필터 재조회) 남은 선택은 그릴 자리가 없다.
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
    /*
     * 갱신 중임을 `aria-busy`로만 말한다. 표는 자리를 지키고 새 값이 도착하면 조용히
     * 바뀌어 끼워진다 — 여기서 눈에 보이는 것을 더하거나 빼면 그것이 곧 layout 변화라,
     * 판정할 때마다 표가 흔들리지 않게 하려던 일을 스스로 되돌린다.
     */
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
  /*
   * 뼈대는 **그릴 표가 없을 때만** 그린다. 갱신 중(`refreshing`)에 여기로 들어오면
   * 판정 한 건마다 표가 통째로 사라졌다 다시 서고, 그때 가로 스크롤은 처음으로,
   * 세로 위치는 표 높이를 따라 흔들린다 — 교직원은 보던 행과 열을 잃는다.
   */
  if (props.loadPhase === 'skeleton') {
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

  const { milestone, documents, rows, page, pageSize, total, filterCounts } =
    props.data;
  const empty = collectionEmptyKind({
    programId: props.programId,
    milestoneProgramId: milestone.programId,
    documentCount: documents.length,
    applicationCount: filterCounts.all,
    filteredCount: total,
  });

  /*
   * 경로의 프로그램과 응답의 프로그램이 다른 경우 — 조회는 `milestoneId`만 보내므로
   * 서버는 남의 프로그램 마일스톤이어도 순순히 표를 돌려준다. 그대로 그리면 B의 팀
   * 목록이 A의 화면 껍데기(좌측 패널·「프로그램 편집」 링크) 아래에 앉아 교직원이 남의
   * 프로그램 현황을 A의 것으로 읽는다. 표는 물론 필터 칩도 그리지 않는다 — 조작할 표가
   * 없는데 「전체 47팀」 같은 수가 남으면 그 수마저 A의 것으로 읽힌다.
   */
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
            <Link href={programApplicantsHref(props.programId)}>
              신청 확인하기
            </Link>
          </Button>
        }
      />
    );
  }

  /*
   * 빠른 필터와 ZIP 조작은 같은 줄에 선다. 좁은 화면(375·320px)에서는 `flex-col`로
   * 쌓아 가로로 넘치지 않게 한다 — 두 무리를 한 줄에 붙들어 두면 표가 아니라 조작 줄
   * 때문에 화면 전체가 좌우로 흔들린다.
   *
   * ⚠ 여기가 ZIP 조작의 **시작점이자 경계**다. 위에서 이미 돌아간 세 빈 상태
   * (`wrong-program`·`no-documents`·`no-applications`)에는 이 줄이 아예 그려지지 않는다 —
   * `wrong-program`은 남의 프로그램 것이고, 나머지 둘은 받아 봐야 **현황표 한 장뿐인 ZIP**
   * (서류 항목이 없거나 팀이 없다)이라 교직원이 기대한 것과 다르다.
   * 반대로 아래의 `no-filter-results`·`outOfRange`는 **필터 결과만 비었을 뿐 표는 있는**
   * 경우라 이 줄을 그대로 남긴다 — ZIP은 필터를 따라가지 않으므로 여전히 온전하고,
   * 오히려 「지금 조건에는 아무도 없다」를 본 사람이 전체를 받아 보려는 자리다.
   */
  const collectionToolbar = (
    <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <CollectionFilterButtons
        filterCounts={filterCounts}
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

  // 필터에 아무도 안 걸린 경우 — 「승인된 신청이 없다」와 다른 상황이라 필터 칩은
  // 그대로 두고 되돌릴 길만 준다.
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

  /*
   * 보고 있던 페이지가 결과 밖으로 밀려난 경우 — 팀들이 제출을 마쳐 「필수 서류 미제출」이
   * 2페이지에서 1페이지로 줄면 응답은 빈 2페이지로 온다. 페이지 이동 UI는 한 페이지짜리
   * 결과에서 그리지 않으므로, 여기서 내려앉을 길을 주지 않으면 빈 표에 갇힌다.
   */
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
      {/*
       * 「이 페이지 N팀(조건에 맞는 전체 M팀)」 — 표에 보이는 것이 전부가 아님을
       * 먼저 말한다(제출 현황 표의 같은 자리와 같은 문장 틀).
       */}
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

/**
 * 서류 수합 화면의 표시 전담부. 조회·상태는 컨테이너
 * (`milestone-document-collection-screen.tsx`)가 갖고 여기는 props만 그린다 —
 * 정적 렌더로 문구·링크를 검증할 수 있게 하려는 분리다.
 */
export function MilestoneDocumentCollectionView(
  props: MilestoneDocumentCollectionViewProps,
) {
  /*
   * 다른 프로그램의 마일스톤이면 머리말에서도 이름·마감을 지운다. 본문만 막고 제목을
   * 그대로 두면 A의 화면이 「서류 수합 — B의 마일스톤」을 달게 되는데, 그것이 바로
   * 이 화면이 사람을 속이던 지점이다.
   */
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
        {/*
         * 저장되지 않고 버려진 판정을 알리는 자리. 패널을 닫은 뒤에 띄우므로 패널 안
         * 오류 문구와 자리를 나눠 가진다 — 같은 자리에 두면 패널이 닫히는 순간 문구도
         * 함께 사라져, 교직원은 판정이 저장된 줄 안다.
         */}
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
