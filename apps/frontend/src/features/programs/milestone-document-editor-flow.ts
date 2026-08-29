import { ApiError } from '@/lib/api-client';
import type {
  MilestoneDocument,
  UpsertMilestoneDocumentInput,
} from './milestone-document-api';

/**
 * 교직원 「제출 항목」 등록 UI의 순수 로직.
 *
 * 정렬·sortOrder 계산·폼 검증은 컴포넌트가 아니라 여기 있다
 * (`features/programs/AGENTS.md` — flow 모듈의 순수 로직은 컴포넌트와 분리).
 */

export interface MilestoneDocumentForm {
  /** 수정 중이면 대상 서류 id, 새로 추가하는 중이면 `null`. */
  readonly id: string | null;
  readonly name: string;
  readonly required: boolean;
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
  };
}

export function toMilestoneDocumentForm(
  document: MilestoneDocument,
): MilestoneDocumentForm {
  return {
    id: document.id,
    name: document.name,
    required: document.required,
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
    case 'name':
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

/**
 * 생성·수정 두 endpoint가 같은 본문을 받는다(전체 교체) — sortOrder는 호출부가 정한다.
 *
 * ⚠ 다만 그 값이 자리를 정하는 것은 **생성뿐**이다. 수정 요청의 sortOrder는 서버가
 * 무시하고, 순서는 `PATCH .../documents/order`가 소유한다. 본문 shape이 같아 함께 실을 뿐이다.
 */
export function buildMilestoneDocumentInput(
  form: MilestoneDocumentForm,
  sortOrder: number,
): UpsertMilestoneDocumentInput {
  return {
    name: form.name.trim(),
    required: form.required,
    sortOrder,
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
 * 저장에 실을 sortOrder. 새 항목은 맨 뒤에 붙고, 수정은 원래 값을 그대로 다시 싣는다.
 *
 * **수정으로는 순서가 움직이지 않는다** — 서버가 수정 요청의 sortOrder를 무시하기
 * 때문이다(순서는 `PATCH .../documents/order`가 소유한다). 원래 값을 싣는 것은 본문
 * shape을 맞추기 위해서다. 다른 값을 실어 자리를 옮기려 들면 응답은 성공인데 순서는
 * 그대로인 자리가 된다.
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
 * 없다. 응답을 그대로 갈아 끼우면 값이 `undefined`가 되어 화면에서 제출 현황이 사라진다.
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

/** 드래그한 항목을 놓은 위치로 옮긴 뒤, 이 마일스톤 제출 항목 전체의 id를 돌려준다. */
export function planMilestoneDocumentOrder(
  documents: readonly MilestoneDocument[],
  activeDocumentId: string,
  overDocumentId: string,
): readonly string[] | null {
  const sorted = sortMilestoneDocuments(documents);
  const activeIndex = sorted.findIndex(
    (document) => document.id === activeDocumentId,
  );
  const overIndex = sorted.findIndex(
    (document) => document.id === overDocumentId,
  );
  if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) {
    return null;
  }

  const documentIds = sorted.map((document) => document.id);
  const [moved] = documentIds.splice(activeIndex, 1);
  if (moved === undefined) return null;
  documentIds.splice(overIndex, 0, moved);
  return documentIds;
}

/** 실패 문구는 서버가 준 detail을 그대로 보여 주고, 없으면 화면 기본 문구로 떨어진다. */
export function milestoneDocumentErrorMessage(
  error: unknown,
  fallback: string,
): string {
  return error instanceof ApiError ? error.problem.detail : fallback;
}
