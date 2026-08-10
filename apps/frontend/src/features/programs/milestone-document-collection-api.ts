import { apiClient, apiPath } from '@/lib/api-client';
import type { MilestoneDocumentSubmissionStatus } from './milestone-document-api';
import type { MilestoneDocumentReviewDecision } from './milestone-document-review-api';
import type { SubmissionType } from './types';

/**
 * 교직원 서류 수합 표(`GET /milestones/:milestoneId/documents/collection`)의 응답 계약.
 * 원본은 백엔드 `milestone-documents/dto/milestone-document-collection-response.dto.ts`이며
 * 여기서는 그 모양을 그대로 옮기기만 한다 — 필드를 더하거나 이름을 바꾸지 않는다.
 */
export interface MilestoneDocumentCollectionMilestone {
  readonly id: string;
  /**
   * 이 마일스톤을 소유한 프로그램. 조회는 `milestoneId`만 보내므로 화면 경로의
   * 프로그램과 응답의 프로그램이 어긋날 수 있다 — 그 판정에 쓰는 값이다
   * (`collectionEmptyKind`의 `wrong-program`).
   */
  readonly programId: string;
  readonly name: string;
  /** ISO 8601. 화면은 `program-detail-format.ts`의 서울 시각 포매터로만 표시한다. */
  readonly dueAt: string;
}

/**
 * 표의 열 — 이 마일스톤이 요구하는 서류 항목. `sortOrder` 오름차순으로 온다.
 *
 * ⚠ 이 열만 `isRequired`다(ADR-004의 boolean `is`/`has`/`can` 접두사). 교직원·학생
 * 화면이 쓰는 `milestone-document-api.ts`의 `MilestoneDocument.required`는 **이미 발행된
 * 계약**이라 접두사 없이 그대로다 — 이 수합 표 응답만 발행 전이라 규칙에 맞춘다. 칸의
 * `submitted` → `isSubmitted`를 가른 것과 같은 기준이고, 이름이 비슷하다고 함께 바꾸면
 * 학생 화면과 「받을 서류」 편집이 조용히 깨진다.
 */
export interface MilestoneDocumentCollectionDocument {
  readonly id: string;
  readonly name: string;
  readonly isRequired: boolean;
  readonly sortOrder: number;
  readonly submissionType: SubmissionType;
}

/** `submissionType === 'FILE'`이고 만료되지 않은 첨부가 있을 때만 채워진다. */
export interface MilestoneDocumentCollectionFile {
  readonly name: string;
  readonly sizeBytes: number;
}

/**
 * 칸에 붙는 **최신 판정 한 건**. 아직 판정하지 않았거나 미제출이면 `null`이다.
 *
 * ⚠ 이건 **지난 지적을 보여 주는 값이지 지금 상태가 아니다**. 칸의 배지는 옆의
 * `status`로 정한다 — 판정 이력은 재제출로 되돌아가지 않으므로, 이 값으로 배지를
 * 정하면 보완 요청에 응해 **다시 낸 칸이 계속 「보완 요청」으로 남아** 교직원이 다시
 * 검토해야 할 건을 놓친다.
 *
 * ⚠ 표시값이지 업무 규칙도 아니다(백엔드 DTO의 같은 자리 주석과 같은 말이다).
 * 「미제출」 기준은 여전히 `isSubmitted`이고 필터·합계는 이 값을 보지 않는다 — 반려된
 * 서류를 미제출로 세기 시작하면 독촉 대상 집계가 조용히 뜻을 바꾼다.
 *
 * ⚠ 응답은 최신 한 건만 준다. 이력 전체를 주는 조회는 **없다** — 화면이 「지난 판정 목록」을
 * 그리고 싶어도 여기서 만들어 낼 수 없다.
 */
export interface MilestoneDocumentCollectionReview {
  /**
   * 판정 요청의 `expectedLatestReviewId`로 **그대로 되돌려 보내는** 값이다(칸의
   * `revision`이 `expectedRevision`이 되는 것과 짝이다). 표를 그린 뒤 다른 교직원이
   * 먼저 판정하면 서버가 이 값으로 알아채고 409(MSD_025)로 막는다 — 화면이 이 id를
   * 흘리면 그 검사가 통째로 무력해진다.
   */
  readonly id: string;
  readonly decision: MilestoneDocumentReviewDecision;
  readonly comment: string | null;
  readonly reviewedAt: string;
}

/**
 * 학생이 낸 **본문** — 파일이 아닌 두 제출 방식이 여기 실린다. 백엔드
 * `milestone-documents/domain/milestone-document-content.ts`의
 * `MilestoneDocumentSubmittedContent`와 같은 모양이다.
 *
 * ⚠ FILE 제출에는 이 값이 없다(`null`) — 파일은 옆의 `file`이 담당한다. 저장 시점에
 * `JsonNull`로 접히기 때문이라, 「파일 제출인데 본문이 있다」는 상태는 계약에 없다.
 *
 * ⚠ **잘려 오지 않는다.** 글은 최대 10,000자까지 그대로 실린다 — 「일부만 보고 승인」은
 * 「못 보고 승인」과 같은 사고라서 서버가 자르지 않기로 한 것이고, 잘린 뒤를 읽을 단건
 * 조회도 없다. 화면은 그 전문을 담을 자리를 마련해야 한다(패널의 스크롤 영역).
 */
export type MilestoneDocumentCollectionContent =
  { readonly type: 'TEXT'; readonly text: string };

/**
 * 표의 칸 — 미제출도 칸이 비지 않고 `isSubmitted: false`로 채워져 온다.
 *
 * ⚠ 이 칸만 `isSubmitted`다(ADR-004의 boolean `is`/`has`/`can` 접두사). 학생 화면이
 * 쓰는 `milestone-document-api.ts`의 `viewerSubmission.submitted`는 다른 계약이라
 * 그대로다 — 이름이 비슷하다고 함께 바꾸면 학생 화면이 조용히 깨진다.
 */
export interface MilestoneDocumentCollectionCell {
  readonly documentId: string;
  readonly isSubmitted: boolean;
  /**
   * 이 제출이 지금 어떤 상태인가 — **칸의 배지는 이 값으로 정한다**. 제출이 없으면 `null`.
   *
   * 값 집합은 학생 뷰 계약(`milestone-document-api.ts`의
   * `MilestoneDocumentSubmissionStatus`)과 같다. 같은 제출 행의 같은 상태라 이름만 다른
   * 두 벌을 만들지 않는다 — 이름이 갈린 `isSubmitted`/`submitted`와 달리 여기는 뜻도
   * 값도 하나다.
   *
   * ⚠ `SUBMITTED`는 「아직 아무도 안 봤다」와 「보완 요청을 받고 **다시 냈다**」 둘 다를
   * 뜻한다 — 재제출이 같은 제출 행을 덮어쓰며 상태를 되돌리기 때문이다. 그래서 「지난
   * 지적이 있었는가」는 이 값이 아니라 `review`로 본다.
   */
  readonly status: MilestoneDocumentSubmissionStatus | null;
  /**
   * 이 제출이 **몇 번째 제출본인가**. 제출이 없으면 `null`이고, 다시 낼 때마다 서버가
   * 올린다(`features/submissions`의 `MatrixCell.revision`과 같은 뜻·같은 이름이다).
   *
   * ⚠ 판정 요청의 `expectedRevision`으로 **그대로 되돌려 보내는** 값이다. 예전에는 이
   * 자리를 `submittedAt`이 맡았는데, 같은 초 안에 두 번 낸 재제출은 시각이 같아
   * 「바뀌지 않았다」로 통과했다 — 그때 교직원은 **자기가 읽은 것이 아닌 제출본**에
   * 판정을 붙인다. 번호는 다시 낼 때마다 반드시 달라지므로 그 구멍이 없다.
   *
   * ⚠ 화면에 숫자로 적지 마라. 학생·교직원에게 「제출본 3」은 아무 뜻이 없고,
   * `features/submissions`도 같은 이유로 내부 값으로만 쓴다(재제출 토스트 문구 참고).
   */
  readonly revision: number | null;
  readonly submittedAt: string | null;
  readonly file: MilestoneDocumentCollectionFile | null;
  /**
   * 글로 낸 제출의 본문. FILE 제출이거나 미제출이면 `null`이다.
   *
   * ⚠ **판정 화면은 이 값을 반드시 그려야 한다.** 이것을 그리지 않으면 제출 방식 세 가지
    * 중 글이 교직원에게 통째로 안 보이고, 그는 내용을 한 글자도 못 본 채
   * 승인·반려를 누른다.
   */
  readonly content: MilestoneDocumentCollectionContent | null;
  readonly review: MilestoneDocumentCollectionReview | null;
}

/** 표의 행 — 승인된 신청(= 팀) 하나. */
export interface MilestoneDocumentCollectionRow {
  readonly applicationId: string;
  readonly teamName: string;
  /** 프로필을 아직 채우지 않은 신청자는 `null`이다 — 대체 표기는 화면이 정한다. */
  readonly applicantName: string | null;
  readonly memberNicknames: readonly string[];
  readonly cells: readonly MilestoneDocumentCollectionCell[];
}

/**
 * 행 필터. 값은 그대로 `filter` 쿼리로 나가고 **거르는 일은 서버가 한다**
 * (백엔드 `milestone-documents/domain/milestone-document-collection-query.ts`).
 *
 * - `ALL` — 승인된 신청 전부.
 * - `HAS_MISSING` — **필수(`isRequired`) 서류** 중 하나라도 미제출인 팀. 선택 서류만
 *   빠뜨린 팀은 걸리지 않는다. 독촉 대상을 고르는 기준이라 그렇다.
 * - `ZERO_SUBMISSION` — 한 장도 내지 않은 팀. 필수·선택을 가리지 않는다.
 */
export type MilestoneDocumentCollectionFilter =
  'ALL' | 'HAS_MISSING' | 'ZERO_SUBMISSION';

export const MILESTONE_DOCUMENT_COLLECTION_FILTERS: readonly MilestoneDocumentCollectionFilter[] =
  ['ALL', 'HAS_MISSING', 'ZERO_SUBMISSION'];

/** 백엔드 기본값과 같은 값(`MILESTONE_DOCUMENT_COLLECTION_DEFAULT_PAGE_SIZE`). */
export const MILESTONE_DOCUMENT_COLLECTION_PAGE_SIZE = 20;

export interface MilestoneDocumentCollectionQueryInput {
  readonly page: number;
  readonly pageSize: number;
  readonly filter: MilestoneDocumentCollectionFilter;
}

/**
 * 필터 칩에 붙는 팀 수.
 *
 * ⚠ 이 값은 **필터·페이지와 무관하게 전체 승인 신청 기준**이다 — 필터를 바꾸기 전에
 * 몇 팀이 걸리는지 미리 보여 주려는 값이라 그래야 한다.
 */
export interface MilestoneDocumentCollectionFilterCounts {
  readonly all: number;
  readonly hasMissing: number;
  readonly zeroSubmission: number;
}

/**
 * 합계 행 한 칸 — 서류(열) 하나의 진척.
 *
 * ⚠ 여기도 **필터·페이지 이전의 전체 기준**이다. 마감을 판단하는 사람이 알고 싶은 것은
 * 지금 걸러 놓은 팀이 아니라 이 마일스톤 전체의 진척이며, 필터를 따라가게 만들면
 * `ZERO_SUBMISSION`에서 모든 열이 「제출 0」이 되어 뜻이 없어진다.
 */
export interface MilestoneDocumentCollectionDocumentTotal {
  readonly documentId: string;
  readonly submitted: number;
  readonly total: number;
}

export interface MilestoneDocumentCollection {
  readonly milestone: MilestoneDocumentCollectionMilestone;
  readonly documents: readonly MilestoneDocumentCollectionDocument[];
  /** ⚠ **페이지 한 장 분량**이다(기본 20건). 전체를 손에 쥔 것처럼 세면 틀린다. */
  readonly rows: readonly MilestoneDocumentCollectionRow[];
  readonly page: number;
  readonly pageSize: number;
  /** 필터 적용 후 행 수(페이지 자르기 전) — 페이지 수 계산은 이 값으로 한다. */
  readonly total: number;
  readonly filterCounts: MilestoneDocumentCollectionFilterCounts;
  readonly documentTotals: readonly MilestoneDocumentCollectionDocumentTotal[];
}

function documentsPath(milestoneId: string): string {
  return `milestones/${encodeURIComponent(milestoneId)}/documents`;
}

/** `page`·`pageSize`·`filter`는 언제나 함께 보낸다 — 서버 기본값에 기대지 않는다. */
export function buildMilestoneDocumentCollectionSearchParams(
  query: MilestoneDocumentCollectionQueryInput,
): URLSearchParams {
  const params = new URLSearchParams();
  params.set('page', String(query.page));
  params.set('pageSize', String(query.pageSize));
  params.set('filter', query.filter);
  return params;
}

/**
 * 교직원 전용 — 마일스톤 하나의 팀×서류 수합 표 **한 페이지**.
 *
 * 필터·집계는 전부 서버가 낸다. 응답의 `rows`만 보고 필터를 다시 걸거나 합계를 다시
 * 세면 안 된다 — 손에 있는 것은 한 페이지뿐이라 조용히 틀린 수가 나온다.
 */
export function getMilestoneDocumentCollection(
  milestoneId: string,
  query: MilestoneDocumentCollectionQueryInput,
): Promise<MilestoneDocumentCollection> {
  const params = buildMilestoneDocumentCollectionSearchParams(query);
  return apiClient<MilestoneDocumentCollection>(
    `${documentsPath(milestoneId)}/collection?${params.toString()}`,
  );
}

/**
 * `<a href>`로 바로 거는 제출 파일 다운로드 경로.
 * `apiPath`가 `/api/v1`의 유일한 소유자다(`milestone-document-api.ts`의
 * `milestoneDocumentTemplateHref`와 같은 패턴) — 여기서 경로를 손으로 잇지 않는다.
 */
export function milestoneDocumentSubmissionFileHref(
  milestoneId: string,
  documentId: string,
  applicationId: string,
): string {
  return apiPath(
    `${documentsPath(milestoneId)}/${encodeURIComponent(documentId)}/applications/${encodeURIComponent(applicationId)}/file`,
  );
}

/**
 * 전체 제출물 ZIP 안에서 **폴더를 무엇으로 가를지**.
 *
 * - `TEAM` — `팀/서류.pdf`. 한 팀의 서류가 한 자리에 모인다(팀 단위로 훑을 때).
 * - `DOCUMENT` — `서류/팀.pdf`. 같은 서류가 한 자리에 모인다(같은 항목을 연달아 볼 때).
 *
 * ⚠ **담는 파일은 둘이 똑같다** — 뒤집히는 것은 ZIP 안의 경로뿐이다. 이 값으로 무엇이
 * 들어가고 빠지는지가 달라진다고 읽히면, 교직원은 「서류 종류별」로 받은 ZIP을 일부만
 * 담긴 것으로 여긴다.
 */
export type MilestoneDocumentCollectionArchiveGrouping = 'TEAM' | 'DOCUMENT';

/**
 * `<a href>`로 바로 거는 **전체 제출물 ZIP** 경로. 교직원 전용이고, 브라우저가 세션
 * 쿠키를 실어 그대로 받는다(`milestoneDocumentSubmissionFileHref`와 같은 방식).
 *
 * `apiPath`가 `/api/v1`의 유일한 소유자다 — 여기서 경로를 손으로 잇지 않고, 쿼리도
 * 문자열을 붙이지 않고 `URLSearchParams`로 만든다(값에 든 특수문자를 흘리지 않는다).
 *
 * `groupBy`는 **언제나 싣는다**. 서버 기본값에 기대면 그 기본값이 바뀌는 날 화면은
 * 아무것도 고치지 않았는데 다른 구조의 ZIP을 내려준다 — 조회 쿼리에서
 * `page`·`pageSize`·`filter`를 늘 함께 싣는 것과 같은 규칙이다
 * (`buildMilestoneDocumentCollectionSearchParams`).
 *
 * ⚠ 이 ZIP은 **필터·페이지와 무관하게 마일스톤 전체 팀**을 담는다. 화면의 빠른 필터나
 * 지금 페이지를 따라가지 않으므로, 이 링크를 그리는 쪽은 그 사실을 사람에게 말해야
 * 한다 — 「필수 서류 미제출」로 걸러 놓고 받은 교직원은 그 팀들만 담겼다고 읽는다.
 */
export function milestoneDocumentCollectionArchiveHref(
  milestoneId: string,
  grouping: MilestoneDocumentCollectionArchiveGrouping,
): string {
  const params = new URLSearchParams();
  params.set('groupBy', grouping);
  return apiPath(
    `${documentsPath(milestoneId)}/collection/archive?${params.toString()}`,
  );
}

/**
 * `<a href>`로 바로 거는 **서류 한 종류 ZIP** 경로 — 그 서류만, 전 팀 것. 위의 전체
 * ZIP과 같은 endpoint이고 좁히는 것은 `documentId` 쿼리 하나다(ADR-004의 「리소스
 * 부분집합은 query parameter로」). 경로는 `apiPath`가, 쿼리는 `URLSearchParams`가
 * 만든다 — 여기서 `/api/v1`도 쿼리 문자열도 손으로 잇지 않는다.
 *
 * ⚠ **`groupBy`를 함께 싣지 않는다.** 전체 ZIP과 정반대의 규칙이라 눈에 띄어야 한다.
 * 서버는 둘이 함께 오면 400으로 막는다(무시하지 않는다) — 서류가 하나뿐인 ZIP에는
 * 묶는 방식이 없는데, 조용히 무시하면 「서류 종류별로 묶어 받았다」고 믿은 사람의
 * 오해가 응답으로 확인되지 않은 채 남기 때문이다. 그래서 이 함수는 폴더 구조를
 * 인자로 아예 받지 않는다 — 받을 수 있게 열어 두면 언젠가 실려 나간다.
 *
 * 담기는 파일은 ZIP **뿌리에 평평하게** 놓인다(서류가 하나라 폴더가 뜻이 없다).
 *
 * ⚠ 이 ZIP도 **필터·페이지를 따라가지 않고 전 팀**을 담는다 —
 * `milestoneDocumentCollectionArchiveHref`와 같다. 이 링크를 그리는 쪽은 전체 ZIP과
 * 같은 안내를 사람에게 붙여야 한다.
 *
 * 그 마일스톤에 없는 `documentId`면 404다. 화면은 표의 열(= 그 마일스톤의 서류)에서만
 * 이 링크를 만들므로 정상 동선에서는 나지 않는다.
 */
export function milestoneDocumentCollectionDocumentArchiveHref(
  milestoneId: string,
  documentId: string,
): string {
  const params = new URLSearchParams();
  params.set('documentId', documentId);
  return apiPath(
    `${documentsPath(milestoneId)}/collection/archive?${params.toString()}`,
  );
}
