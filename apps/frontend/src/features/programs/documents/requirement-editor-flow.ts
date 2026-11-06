import type { UpdateEditableRequirementInput } from '../authoring/dto';
import type { Requirement, PreparedRequirementUpload } from './requirement-dto';
import { MAX_REQUIREMENTS_PER_MILESTONE } from '../authoring/program-authoring-graph-validation';

export type LocalRequirement = {
  readonly id: string | null;
  readonly localId: string;
  readonly name: string;
  readonly required: boolean;
  readonly sortOrder: number;
  readonly persistedTemplateFileName: string | null;
  readonly selectedFile: File | null;
};

export type LocalRequirements = {
  readonly baseline: readonly LocalRequirement[];
  readonly current: readonly LocalRequirement[];
};

export function toLocalRequirements(
  documents: readonly Requirement[],
): LocalRequirements {
  const current = documents.map((document) => ({
    id: document.id,
    localId: document.id,
    name: document.name,
    required: document.required,
    sortOrder: document.sortOrder,
    persistedTemplateFileName: document.templateFileName,
    selectedFile: null,
  }));
  return { baseline: current, current };
}

export function isLocalRequirementsDirty(
  documents: LocalRequirements,
): boolean {
  return !sameLocalDocuments(documents.baseline, documents.current);
}

export function updateLocalRequirement(
  documents: LocalRequirements,
  localId: string,
  patch: Partial<Pick<LocalRequirement, 'name' | 'required' | 'selectedFile'>>,
): LocalRequirements {
  return {
    ...documents,
    current: documents.current.map((document) =>
      document.localId === localId ? { ...document, ...patch } : document,
    ),
  };
}

export function addLocalRequirement(
  documents: LocalRequirements,
  localId: string,
): LocalRequirements {
  return {
    ...documents,
    current: [
      ...documents.current,
      {
        id: null,
        localId,
        name: '',
        required: true,
        sortOrder: documents.current.length + 1,
        persistedTemplateFileName: null,
        selectedFile: null,
      },
    ],
  };
}

export function reorderLocalRequirements(
  documents: LocalRequirements,
  localIds: readonly string[],
): LocalRequirements {
  const byId = new Map(
    documents.current.map((document) => [document.localId, document]),
  );
  const requestedIds = new Set(localIds);
  if (
    byId.size !== documents.current.length ||
    localIds.length !== documents.current.length ||
    requestedIds.size !== documents.current.length ||
    [...requestedIds].some((localId) => !byId.has(localId))
  ) {
    return documents;
  }
  return {
    ...documents,
    current: localIds.map((localId, index) => ({
      ...byId.get(localId)!,
      sortOrder: index + 1,
    })),
  };
}

export function removeLocalRequirement(
  documents: LocalRequirements,
  localId: string,
): LocalRequirements {
  return {
    ...documents,
    current: documents.current
      .filter((document) => document.localId !== localId)
      .map((document, index) => ({ ...document, sortOrder: index + 1 })),
  };
}

export function buildLocalRequirementInputs(
  documents: LocalRequirements,
  uploads: readonly PreparedRequirementUpload[],
): readonly UpdateEditableRequirementInput[] {
  const uploadsByLocalId = new Map(
    uploads.map((upload) => [upload.localId, upload.uploadId]),
  );
  return documents.current.map((document) => ({
    id: document.id,
    name: document.name.trim(),
    required: document.required,
    ...(uploadsByLocalId.has(document.localId)
      ? { templateUploadId: uploadsByLocalId.get(document.localId) }
      : {}),
  }));
}

export function validateLocalRequirements(
  documents: LocalRequirements,
): string | null {
  if (documents.current.length > MAX_REQUIREMENTS_PER_MILESTONE)
    return `제출 항목은 최대 ${MAX_REQUIREMENTS_PER_MILESTONE}개입니다.`;
  if (documents.baseline.length > 0 && documents.current.length === 0) {
    return '마일스톤에는 제출 항목이 하나 이상 필요합니다. 새 항목을 만든 뒤 기존 항목을 삭제해 주세요.';
  }
  return documents.current.some(
    (document) =>
      document.name.trim() === '' || document.name.trim().length > 200,
  )
    ? '제출 항목 이름은 1~200자로 입력해 주세요.'
    : null;
}

function sameLocalDocuments(
  left: readonly LocalRequirement[],
  right: readonly LocalRequirement[],
): boolean {
  return (
    left.length === right.length &&
    left.every((document, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        document.id === other.id &&
        document.name === other.name &&
        document.required === other.required &&
        document.sortOrder === other.sortOrder &&
        document.persistedTemplateFileName ===
          other.persistedTemplateFileName &&
        document.selectedFile === other.selectedFile
      );
    })
  );
}
