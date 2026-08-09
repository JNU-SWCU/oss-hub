/**
 * ZIP에 동봉하는 `제출현황.csv` — 수합 표를 **그대로**, 미제출까지 담는다.
 *
 * ZIP 본체는 「낸 것」만 담는다(안 낸 팀은 폴더가 없다). 그래서 이 파일이 없으면 받은 사람은
 * **누가 안 냈는지 알 수 없다** — 독촉이 이 기능의 절반이므로 현황표가 곧 절반이다.
 *
 * 세 가지를 Excel 때문에 지킨다. 셋 다 「그냥 쉼표로 이으면」 깨지는 것들이다.
 * 1. **UTF-8 BOM** — 없으면 Excel(Windows)이 한글을 지역 인코딩으로 읽어 전부 깨진다.
 * 2. **CRLF 줄바꿈** — RFC 4180이고, 옛 Excel은 LF만 있으면 한 줄로 읽는다.
 * 3. **수식 무력화** — 값이 `=`·`+`·`-`·`@`·탭·CR로 시작하면 Excel이 **수식으로 실행한다.**
 *    팀 이름은 학생이 정하는 값이므로 이것은 이론이 아니라 열린 문이다(CSV injection).
 */
import type {
  MilestoneDocumentArchiveCell,
  MilestoneDocumentArchiveCellState,
  MilestoneDocumentArchiveDocument,
  MilestoneDocumentArchiveManifestRow,
  MilestoneDocumentArchiveOmission,
} from './milestone-document-archive';

/** 다섯 갈래의 한국어 표기. 프런트 `MILESTONE_DOCUMENT_REVIEW_DISPLAY_LABELS`와 같은 말이다. */
const CELL_STATE_LABELS: Readonly<
  Record<MilestoneDocumentArchiveCellState, string>
> = {
  NOT_SUBMITTED: '미제출',
  PENDING: '검토 대기',
  APPROVED: '승인',
  CHANGES_REQUESTED: '보완 요청',
  REJECTED: '반려',
};

/** 담기지 않은 칸의 「ZIP 파일」 자리에 적는 말 — 빈 칸으로 두면 미제출과 구별되지 않는다. */
const OMISSION_LABELS: Readonly<
  Record<MilestoneDocumentArchiveOmission, string>
> = {
  FILE_UNAVAILABLE: '(첨부 보존 기한 만료)',
  CONTENT_UNAVAILABLE: '(내용 없음)',
};

/**
 * 이스케이프로 적는다 — 실제 U+FEFF 문자로 두면 **소스에서 눈에 보이지 않아** 에디터·포매터·
 * 복사붙여넣기 한 번에 조용히 사라지고, 사라져도 코드가 멀쩡해 보인다.
 */
const BOM = '\uFEFF';
const ROW_SEPARATOR = '\r\n';

/** Excel이 수식으로 읽기 시작하는 첫 글자들. 탭·CR은 눈에 안 보여 더 위험하다. */
const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@', '\t', '\r']);

export interface MilestoneDocumentArchiveManifestCsvInput {
  readonly documents: readonly MilestoneDocumentArchiveDocument[];
  readonly rows: readonly MilestoneDocumentArchiveManifestRow[];
}

/**
 * 열 구성: 팀 · 신청자 · 팀원, 그리고 서류마다 **세 칸**(상태 · 제출시각 · ZIP 파일).
 * 표의 한 칸이 화면에서 말하는 것이 정확히 그 셋이라서 그대로 옮긴다(배지 · 제출 시각 ·
 * 파일 링크). 「ZIP 파일」은 압축 안 경로를 그대로 적어, 현황표의 한 줄에서 실제 파일로
 * 바로 찾아갈 수 있게 한다.
 */
export function milestoneDocumentArchiveManifestCsv(
  input: MilestoneDocumentArchiveManifestCsvInput,
): string {
  const header = [
    '팀',
    '신청자',
    '팀원',
    ...input.documents.flatMap((document) => [
      `${document.name} 상태`,
      `${document.name} 제출시각`,
      `${document.name} ZIP 파일`,
    ]),
  ];

  const lines = [
    header,
    ...input.rows.map((row) => [
      row.team.teamName,
      row.team.applicantName ?? '',
      row.team.memberNicknames.join(', '),
      // 열 순서는 `documents`가 소유한다 — 칸 배열을 그대로 펴면 두 배열이 어긋난 날
      // 남의 서류 칸에 가서 앉는다.
      ...input.documents.flatMap((document) =>
        cellColumns(cellOf(row.cells, document.id)),
      ),
    ]),
  ];

  return (
    BOM +
    lines.map((line) => line.map(csvField).join(',')).join(ROW_SEPARATOR) +
    ROW_SEPARATOR
  );
}

function cellOf(
  cells: readonly MilestoneDocumentArchiveCell[],
  documentId: string,
): MilestoneDocumentArchiveCell | null {
  return cells.find((cell) => cell.documentId === documentId) ?? null;
}

function cellColumns(cell: MilestoneDocumentArchiveCell | null): string[] {
  if (cell === null) return ['', '', ''];
  return [
    CELL_STATE_LABELS[cell.state],
    cell.submittedAt === null ? '' : formatSeoulDateTime(cell.submittedAt),
    cell.path ?? (cell.omission === null ? '' : OMISSION_LABELS[cell.omission]),
  ];
}

/** `2026-08-09 14:30` — 서울 시각. 표가 보여 주는 것과 같은 자리까지만 적는다. */
function formatSeoulDateTime(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    // `hour12: false`가 아니라 `hourCycle`이다 — ICU 판에 따라 `hour12: false`는 h24로
    // 읽혀 자정이 `24:30`으로 찍힌다. 하필 날짜가 넘어가는 자리에서 터지는 종류다.
    hourCycle: 'h23',
  }).formatToParts(value);
  const at = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${at('year')}-${at('month')}-${at('day')} ${at('hour')}:${at('minute')}`;
}

/**
 * 한 칸을 CSV 값으로. 수식 무력화가 **따옴표보다 먼저**다 — 따옴표로 감싸도 Excel은 안쪽
 * 값을 그대로 수식으로 읽으므로, 감싸는 것만으로는 아무것도 막지 못한다.
 *
 * 앞에 붙이는 작은따옴표는 Excel에서 「이건 글자다」 표시라 화면에 보이지 않는다. 다른
 * 프로그램에서는 보이지만, 보이는 따옴표 하나가 남의 컴퓨터에서 수식이 도는 것보다 낫다.
 */
function csvField(value: string): string {
  const guarded = FORMULA_TRIGGERS.has(value.charAt(0)) ? `'${value}` : value;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}
