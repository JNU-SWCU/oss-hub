import { ApiError } from '@/lib/api-client';
import type {
  MilestoneDocument,
  UpsertMilestoneDocumentInput,
} from './milestone-document-api';
import type { SubmissionType } from './types';

/**
 * 교직원 「받을 서류」 등록 UI의 순수 로직.
 *
 * 정렬·sortOrder 계산·폼 검증은 컴포넌트가 아니라 여기 있다
 * (`features/programs/AGENTS.md` — flow 모듈의 순수 로직은 컴포넌트와 분리).
 */

/**
 * 제출 방식의 화면 표기. 교직원 화면은 내부 구현 용어를 쓰지 않으므로(#355)
 * `FILE`·`TEXT`·`REPOSITORY_RELEASE`를 그대로 노출하지 않는다.
 */
const SUBMISSION_TYPE_LABELS = {
  FILE: '파일',
  TEXT: '글로 작성',
  REPOSITORY_RELEASE: 'GitHub 릴리스',
} as const satisfies Record<SubmissionType, string>;

const DEFAULT_SUBMISSION_TYPE = 'FILE' satisfies SubmissionType;

export function submissionTypeLabel(type: SubmissionType): string {
  return SUBMISSION_TYPE_LABELS[type];
}

/** 폼 `<select>`가 그릴 선택지 — 값은 계약(enum), 라벨은 사람이 읽는 말이다. */
export const SUBMISSION_TYPE_CHOICES: readonly {
  readonly value: SubmissionType;
  readonly label: string;
}[] = (
  [
    'FILE',
    'TEXT',
    'REPOSITORY_RELEASE',
  ] as const satisfies readonly SubmissionType[]
).map((value) => ({ value, label: SUBMISSION_TYPE_LABELS[value] }));

export function toSubmissionType(value: string): SubmissionType {
  switch (value) {
    case 'FILE':
      return 'FILE';
    case 'TEXT':
      return 'TEXT';
    case 'REPOSITORY_RELEASE':
      return 'REPOSITORY_RELEASE';
    default:
      return DEFAULT_SUBMISSION_TYPE;
  }
}

export interface MilestoneDocumentForm {
  /** 수정 중이면 대상 서류 id, 새로 추가하는 중이면 `null`. */
  readonly id: string | null;
  readonly name: string;
  readonly required: boolean;
  readonly submissionType: SubmissionType;
}

export type MilestoneDocumentField = Exclude<keyof MilestoneDocumentForm, 'id'>;

export interface MilestoneDocumentFormErrors {
  readonly name?: string;
  readonly general?: string;
}

export type MilestoneDocumentEditor =
  | { readonly mode: 'closed' }
  | {
      readonly mode: 'create' | 'edit';
      readonly form: MilestoneDocumentForm;
      readonly errors: MilestoneDocumentFormErrors;
      /**
       * 제출이 이미 들어온 항목인가. 참이면 제출 방식 선택을 잠근다.
       * 아직 만들지 않은 항목에는 제출이 있을 수 없으므로 create는 언제나 거짓이다.
       */
      readonly submissionTypeLocked: boolean;
    };

export const SUBMISSION_TYPE_LOCKED_MESSAGE =
  '이미 제출된 서류가 있어 제출 방식은 바꿀 수 없습니다.';

/**
 * 이 항목의 제출 방식을 잠가야 하는가 — 팀 제출이 한 건이라도 있으면 잠근다.
 * 백엔드도 같은 조건을 409(MSD_016)로 막는다. 화면이 미리 막는 것은 안내이고,
 * 실제 방어는 서버다 — 둘 다 필요하다.
 *
 * `teamSubmissionCount`는 **교직원 뷰에서만** 채워진다(`GET .../documents` 계약).
 * 값이 없으면 잠그지 않는다: 이 편집 화면은 교직원 전용이라 값이 없다는 것은
 * 「제출이 없다」가 아니라 「모른다」이고, 모를 때 화면이 먼저 막으면 멀쩡한 항목까지
 * 고칠 수 없게 된다.
 */
export function milestoneDocumentSubmissionTypeLocked(
  document: MilestoneDocument,
): boolean {
  return (document.teamSubmissionCount?.submitted ?? 0) > 0;
}

export function emptyMilestoneDocumentForm(): MilestoneDocumentForm {
  return {
    id: null,
    name: '',
    required: true,
    submissionType: DEFAULT_SUBMISSION_TYPE,
  };
}

export function toMilestoneDocumentForm(
  document: MilestoneDocument,
): MilestoneDocumentForm {
  return {
    id: document.id,
    name: document.name,
    required: document.required,
    submissionType: document.submissionType,
  };
}

export function updateMilestoneDocumentEditor(
  editor: MilestoneDocumentEditor,
  field: MilestoneDocumentField,
  value: string | boolean,
): MilestoneDocumentEditor {
  if (editor.mode === 'closed') return editor;
  // 잠긴 항목은 폼 상태에서도 제출 방식이 움직이지 않는다. `disabled`는 화면의 안내일
  // 뿐이라 프로그램적으로 값이 들어오면 그대로 통과해 409를 부르는 요청이 만들어진다.
  if (field === 'submissionType' && editor.submissionTypeLocked) return editor;
  return {
    ...editor,
    errors: {},
    form: updateMilestoneDocumentForm(editor.form, field, value),
  };
}

function updateMilestoneDocumentForm(
  form: MilestoneDocumentForm,
  field: MilestoneDocumentField,
  value: string | boolean,
): MilestoneDocumentForm {
  switch (field) {
    case 'required':
      return typeof value === 'boolean' ? { ...form, required: value } : form;
    case 'submissionType':
      return typeof value === 'string'
        ? { ...form, submissionType: toSubmissionType(value) }
        : form;
    default:
      return typeof value === 'string' ? { ...form, name: value } : form;
  }
}

export const DOCUMENT_NAME_REQUIRED_MESSAGE = '서류명을 입력해 주세요.';

export function validateMilestoneDocumentForm(
  form: MilestoneDocumentForm,
): MilestoneDocumentFormErrors {
  return form.name.trim().length === 0
    ? { name: DOCUMENT_NAME_REQUIRED_MESSAGE }
    : {};
}

/** 생성·수정 두 endpoint가 같은 본문을 받는다(전체 교체) — sortOrder는 호출부가 정한다. */
export function buildMilestoneDocumentInput(
  form: MilestoneDocumentForm,
  sortOrder: number,
): UpsertMilestoneDocumentInput {
  return {
    name: form.name.trim(),
    required: form.required,
    sortOrder,
    submissionType: form.submissionType,
  };
}

/** 목록은 언제나 sortOrder 오름차순 — 값이 같으면 id로 안정 정렬한다(sortMilestones와 같은 기준). */
export function sortMilestoneDocuments(
  documents: readonly MilestoneDocument[],
): readonly MilestoneDocument[] {
  return [...documents].sort((a, b) => {
    const bySortOrder = a.sortOrder - b.sortOrder;
    if (bySortOrder !== 0) return bySortOrder;
    return a.id.localeCompare(b.id);
  });
}

/** 새 항목은 기존 최대 sortOrder + 1. 항목이 없으면 첫 값은 1이다. */
export function nextMilestoneDocumentSortOrder(
  documents: readonly MilestoneDocument[],
): number {
  return documents.reduce(
    (max, document) => Math.max(max, document.sortOrder + 1),
    1,
  );
}

/**
 * 저장에 실을 sortOrder. 새 항목은 맨 뒤에 붙이고, 수정은 원래 자리를 지킨다 —
 * 수정 endpoint가 전체 교체라 sortOrder를 빠뜨리면 순서가 통째로 흐트러진다.
 */
export function milestoneDocumentSaveSortOrder(
  documents: readonly MilestoneDocument[],
  documentId: string | null,
): number {
  if (documentId === null) return nextMilestoneDocumentSortOrder(documents);
  const existing = documents.find((document) => document.id === documentId);
  return existing?.sortOrder ?? nextMilestoneDocumentSortOrder(documents);
}

/**
 * 갱신 응답 하나를 기존 항목 위에 겹친다 — **응답에 없는 `teamSubmissionCount`는 지우지 않는다.**
 *
 * 이 값은 목록 조회(`GET .../documents`)에서만 채워지고 생성·수정·재정렬 응답에는 아예
 * 없다. 응답을 그대로 갈아 끼우면 값이 `undefined`가 되고,
 * `milestoneDocumentSubmissionTypeLocked`는 「모른다」를 「제출 없음」과 구분하지 못해
 * 잠금이 풀린다 — 이름만 바꾼 뒤 다시 「수정」을 열면 제출 방식이 열려 있고, 바꿔서
 * 저장해야 그제서야 서버 409(MSD_016)로 막히는 자리였다.
 *
 * 제출 수는 서류를 고치거나 순서를 바꾼다고 달라지지 않으므로 손에 있던 값이 그대로
 * 진실이다. 응답이 값을 **주었다면** 그 값이 이긴다(서버가 더 최신이다).
 */
export function mergeMilestoneDocument(
  previous: MilestoneDocument | undefined,
  saved: MilestoneDocument,
): MilestoneDocument {
  if (previous === undefined) return saved;
  if (saved.teamSubmissionCount !== undefined) return saved;
  if (previous.teamSubmissionCount === undefined) return saved;
  return { ...saved, teamSubmissionCount: previous.teamSubmissionCount };
}

export function upsertMilestoneDocumentInList(
  documents: readonly MilestoneDocument[],
  saved: MilestoneDocument,
): readonly MilestoneDocument[] {
  const exists = documents.some((document) => document.id === saved.id);
  return sortMilestoneDocuments(
    exists
      ? documents.map((document) =>
          document.id === saved.id
            ? mergeMilestoneDocument(document, saved)
            : document,
        )
      : [...documents, saved],
  );
}

/**
 * 목록을 통째로 갈아 끼우는 응답(재정렬)을 기존 목록 위에 겹친다.
 *
 * sortOrder·이름 등 응답이 준 값은 그대로 진실로 삼되(서버가 1부터 다시 매긴다),
 * 응답에 실리지 않는 `teamSubmissionCount`만 id로 짝지어 지켜 낸다 —
 * `mergeMilestoneDocument`와 같은 이유다.
 */
export function mergeMilestoneDocumentList(
  previous: readonly MilestoneDocument[],
  saved: readonly MilestoneDocument[],
): readonly MilestoneDocument[] {
  return saved.map((document) =>
    mergeMilestoneDocument(
      previous.find((candidate) => candidate.id === document.id),
      document,
    ),
  );
}

export function removeMilestoneDocumentFromList(
  documents: readonly MilestoneDocument[],
  documentId: string,
): readonly MilestoneDocument[] {
  return documents.filter((document) => document.id !== documentId);
}

/**
 * 「위로」·「아래로」의 계산 — 바뀐 순서대로 나열한 **이 마일스톤 서류 전체**의 id 배열.
 *
 * 부분이 아니라 전체를 돌려주는 이유는 재정렬 endpoint가 전체 집합을 요구하기 때문이다
 * (`reorderMilestoneDocuments`, 불일치는 400 MSD_019). 끝(맨 위에서 위로, 맨 아래에서
 * 아래로)이거나 목록에 없는 id면 `null` — 보낼 요청이 없다는 뜻이다.
 *
 * ⚠ sortOrder가 이웃과 **같아도** 자리를 바꾼다. 옛 구현은 그때 `null`을 돌려 아무 일도
 * 하지 않았는데, 두 항목을 각각 PATCH하다 한쪽만 성공해 sortOrder가 겹친 목록이 정확히
 * 그 상태였다 — 한 번 어긋나면 「위로」가 영영 먹지 않는 덫이었다. 이제는 순서를 통째로
 * 보내고 서버가 1부터 다시 매기므로, 같은 값이야말로 빠져나올 수 있어야 하는 상태다.
 */
export function planMilestoneDocumentOrder(
  documents: readonly MilestoneDocument[],
  documentId: string,
  direction: 'up' | 'down',
): readonly string[] | null {
  const sorted = sortMilestoneDocuments(documents);
  const index = sorted.findIndex((document) => document.id === documentId);
  if (index < 0) return null;

  const neighborIndex = direction === 'up' ? index - 1 : index + 1;
  if (neighborIndex < 0 || neighborIndex >= sorted.length) return null;

  const documentIds = sorted.map((document) => document.id);
  const moved = documentIds[index] as string;
  documentIds[index] = documentIds[neighborIndex] as string;
  documentIds[neighborIndex] = moved;
  return documentIds;
}

/** 실패 문구는 서버가 준 detail을 그대로 보여 주고, 없으면 화면 기본 문구로 떨어진다. */
export function milestoneDocumentErrorMessage(
  error: unknown,
  fallback: string,
): string {
  return error instanceof ApiError ? error.problem.detail : fallback;
}
