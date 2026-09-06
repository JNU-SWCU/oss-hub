import { createHash } from 'node:crypto';
import type { ProgramMilestoneEditView } from './program-editor.types';

export type ProgramMilestoneFingerprintDocument = {
  readonly id: string;
  readonly name: string;
  readonly required: boolean;
  readonly sortOrder: number;
  readonly updatedAt: Date;
  readonly storageKey: string | null;
};

export type ProgramMilestoneFingerprintInput = {
  readonly operation: ProgramMilestoneEditView['operation'];
  readonly milestone: ProgramMilestoneEditView['milestone'] & {
    readonly updatedAt: Date;
  };
  readonly documents: readonly ProgramMilestoneFingerprintDocument[];
};

export function fingerprintProgramMilestoneEdit(
  input: ProgramMilestoneFingerprintInput,
): string {
  const documents = [...input.documents]
    .sort((left, right) =>
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
    )
    .map((document) => [
      document.id,
      document.name,
      document.required,
      document.sortOrder,
      document.updatedAt.toISOString(),
      document.storageKey === null
        ? null
        : ['storage-key', document.storageKey],
    ]);
  const payload = [
    1,
    [
      input.operation.startAt.toISOString(),
      input.operation.endAt.toISOString(),
    ],
    [
      input.milestone.id,
      input.milestone.name,
      input.milestone.startAt.toISOString(),
      input.milestone.dueAt.toISOString(),
      input.milestone.submissionType,
      input.milestone.instructions,
      input.milestone.updatedAt.toISOString(),
    ],
    documents,
  ];
  return createHash('sha256')
    .update(JSON.stringify(payload), 'utf8')
    .digest('hex');
}

export function preflightProgramMilestoneEditDocuments(
  documents: readonly {
    readonly id: string | null;
    readonly templateUploadId?: string;
  }[],
): void {
  if (documents.length > 20) {
    throw new ProgramMilestoneEditValidationError('documents', 'MAX_SIZE');
  }
  assertDistinct(
    documents.flatMap((document, index) =>
      document.id === null ? [] : [{ value: document.id, index }],
    ),
    'id',
    'DUPLICATE_DOCUMENT_ID',
  );
  assertDistinct(
    documents.flatMap((document, index) =>
      document.templateUploadId === undefined
        ? []
        : [{ value: document.templateUploadId, index }],
    ),
    'templateUploadId',
    'DUPLICATE_UPLOAD_TOKEN',
  );
}

function assertDistinct(
  values: readonly { readonly value: string; readonly index: number }[],
  field: string,
  code: string,
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value.value)) {
      throw new ProgramMilestoneEditValidationError(
        `documents[${value.index}].${field}`,
        code,
      );
    }
    seen.add(value.value);
  }
}

export class ProgramMilestoneEditValidationError extends Error {
  override readonly name = 'ProgramMilestoneEditValidationError';

  constructor(
    readonly field: string,
    readonly code: string,
  ) {
    super('Program milestone edit documents are invalid.');
  }
}
