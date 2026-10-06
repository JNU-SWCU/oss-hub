import type {
  MilestoneDocumentArchiveCell,
  MilestoneDocumentArchiveCellState,
  MilestoneDocumentArchiveDocument,
  MilestoneDocumentArchiveManifestRow,
  MilestoneDocumentArchiveOmission,
} from './milestone-document-archive';

const CELL_STATE_LABELS: Readonly<
  Record<MilestoneDocumentArchiveCellState, string>
> = {
  NOT_SUBMITTED: '미제출',
  PENDING: '검토 대기',
  APPROVED: '승인',
  CHANGES_REQUESTED: '보완 요청',
  REJECTED: '반려',
};

const OMISSION_LABELS: Readonly<
  Record<MilestoneDocumentArchiveOmission, string>
> = {
  FILE_UNAVAILABLE: '(첨부를 가져올 수 없음)',
  CONTENT_UNAVAILABLE: '(내용 없음)',
  CONTENT_AND_FILE_UNAVAILABLE: '(내용 없음 · 첨부를 가져올 수 없음)',
  SUBMISSION_UNAVAILABLE: '(제출 내용을 가져올 수 없음)',
};

const BOM = '\uFEFF';
const ROW_SEPARATOR = '\r\n';

const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@', '\t', '\r']);

export interface MilestoneDocumentArchiveManifestCsvInput {
  readonly documents: readonly MilestoneDocumentArchiveDocument[];
  readonly rows: readonly MilestoneDocumentArchiveManifestRow[];
}

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

function formatSeoulDateTime(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',

    hourCycle: 'h23',
  }).formatToParts(value);
  const at = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${at('year')}-${at('month')}-${at('day')} ${at('hour')}:${at('minute')}`;
}

function csvField(value: string): string {
  const guarded = FORMULA_TRIGGERS.has(value.charAt(0)) ? `'${value}` : value;
  return /[",\r\n]/.test(guarded)
    ? `"${guarded.replace(/"/g, '""')}"`
    : guarded;
}
