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
    };

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

export function upsertMilestoneDocumentInList(
  documents: readonly MilestoneDocument[],
  saved: MilestoneDocument,
): readonly MilestoneDocument[] {
  const exists = documents.some((document) => document.id === saved.id);
  return sortMilestoneDocuments(
    exists
      ? documents.map((document) =>
          document.id === saved.id ? saved : document,
        )
      : [...documents, saved],
  );
}

export function removeMilestoneDocumentFromList(
  documents: readonly MilestoneDocument[],
  documentId: string,
): readonly MilestoneDocument[] {
  return documents.filter((document) => document.id !== documentId);
}

export interface MilestoneDocumentMoveRequest {
  readonly documentId: string;
  readonly input: UpsertMilestoneDocumentInput;
}

export interface MilestoneDocumentMovePlan {
  /** 이웃과 sortOrder를 맞바꾸므로 두 항목 모두 PATCH 대상이다. */
  readonly requests: readonly MilestoneDocumentMoveRequest[];
  /** 요청이 모두 성공했을 때의 목록 — 화면은 이 값으로 갈아 끼운다. */
  readonly documents: readonly MilestoneDocument[];
}

/**
 * 「위로」·「아래로」의 계산. 이웃과 sortOrder를 맞바꾼 결과와 두 건의 PATCH 본문을 함께 돌려준다.
 *
 * 끝(맨 위에서 위로, 맨 아래에서 아래로)이거나 두 항목의 sortOrder가 같아
 * 맞바꿔도 순서가 그대로면 `null` — 보낼 요청이 없다는 뜻이다.
 */
export function planMilestoneDocumentMove(
  documents: readonly MilestoneDocument[],
  documentId: string,
  direction: 'up' | 'down',
): MilestoneDocumentMovePlan | null {
  const sorted = sortMilestoneDocuments(documents);
  const index = sorted.findIndex((document) => document.id === documentId);
  if (index < 0) return null;

  const neighborIndex = direction === 'up' ? index - 1 : index + 1;
  const moved = sorted[index];
  const neighbor = sorted[neighborIndex];
  if (moved === undefined || neighbor === undefined) return null;
  if (moved.sortOrder === neighbor.sortOrder) return null;

  const swapped = new Map<string, MilestoneDocument>([
    [moved.id, { ...moved, sortOrder: neighbor.sortOrder }],
    [neighbor.id, { ...neighbor, sortOrder: moved.sortOrder }],
  ]);

  return {
    requests: [moved.id, neighbor.id].map((id) => {
      const document = swapped.get(id) as MilestoneDocument;
      return {
        documentId: id,
        input: {
          name: document.name,
          required: document.required,
          sortOrder: document.sortOrder,
          submissionType: document.submissionType,
        },
      };
    }),
    documents: sortMilestoneDocuments(
      sorted.map((document) => swapped.get(document.id) ?? document),
    ),
  };
}

/** 실패 문구는 서버가 준 detail을 그대로 보여 주고, 없으면 화면 기본 문구로 떨어진다. */
export function milestoneDocumentErrorMessage(
  error: unknown,
  fallback: string,
): string {
  return error instanceof ApiError ? error.problem.detail : fallback;
}
