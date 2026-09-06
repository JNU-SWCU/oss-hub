'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { EditableMilestoneDocument } from './api';
import type {
  MilestoneDocument,
  MilestoneDocumentUploadPolicy,
} from './milestone-document-api';
import { listMilestoneDocuments } from './milestone-document-api';
import { requireMilestoneDocumentList } from './milestone-document-list-response';
import {
  addLocalMilestoneDocument,
  removeLocalMilestoneDocument,
  reorderLocalMilestoneDocuments,
  updateLocalMilestoneDocument,
  type LocalMilestoneDocuments,
} from './milestone-document-editor-flow';
import { MAX_REQUIREMENTS_PER_MILESTONE } from './program-authoring-graph-validation';
import { ProgramAuthoringSubmissionItem } from './program-authoring-submission-item';
import { ProgramAuthoringSortableAttachments } from './program-authoring-sortable-attachments';
import { MilestoneDocumentRow } from './milestone-document-row';

export type MilestoneDocumentEditorState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed' }
  | {
      readonly kind: 'ready';
      readonly documents: readonly MilestoneDocument[];
      readonly fileUpload: MilestoneDocumentUploadPolicy;
    };

export function ReadOnlyMilestoneDocuments({
  milestoneId,
  canonicalDocuments,
}: {
  readonly milestoneId: string;
  readonly canonicalDocuments?: readonly EditableMilestoneDocument[];
}) {
  const [state, setState] = useState<MilestoneDocumentEditorState>({
    kind: 'loading',
  });
  const requestIdRef = useRef(0);
  const load = useCallback(async () => {
    const requestId = (requestIdRef.current += 1);
    setState({ kind: 'loading' });
    try {
      const { documents, fileUpload } = requireMilestoneDocumentList(
        await listMilestoneDocuments(milestoneId),
      );
      if (requestId !== requestIdRef.current) return;
      setState({
        kind: 'ready',
        documents: [...documents].sort(
          (left, right) => left.sortOrder - right.sortOrder,
        ),
        fileUpload,
      });
    } catch {
      if (requestId === requestIdRef.current) setState({ kind: 'failed' });
    }
  }, [milestoneId]);
  useEffect(() => {
    if (canonicalDocuments !== undefined) {
      requestIdRef.current += 1;
      return;
    }
    void load();
    return () => {
      requestIdRef.current += 1;
    };
  }, [canonicalDocuments, load]);
  const documents =
    canonicalDocuments ?? (state.kind === 'ready' ? state.documents : null);
  if (documents === null)
    return state.kind === 'failed' ? (
      <div className="flex items-center gap-2 text-small text-muted-foreground">
        <span>제출 항목을 불러오지 못했습니다.</span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void load()}
        >
          다시 시도
        </Button>
      </div>
    ) : (
      <p className="text-small text-muted-foreground">제출 항목 불러오는 중…</p>
    );
  if (documents.length === 0)
    return (
      <p className="text-small text-muted-foreground">제출 항목이 없습니다.</p>
    );
  return (
    <ul className="grid gap-1">
      {[...documents]
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .map((document) => (
          <MilestoneDocumentRow
            key={document.id}
            milestoneId={milestoneId}
            document={document}
          />
        ))}
    </ul>
  );
}

export function LocalMilestoneDocumentsEditor({
  milestoneId,
  documents,
  fileUpload,
  onChange,
}: {
  readonly milestoneId: string;
  readonly documents: LocalMilestoneDocuments;
  readonly fileUpload: MilestoneDocumentUploadPolicy;
  readonly onChange: (documents: LocalMilestoneDocuments) => void;
}) {
  const pendingDeletionNames = documents.baseline
    .filter(
      (baseline) =>
        baseline.id !== null &&
        !documents.current.some(
          (document) => document.localId === baseline.localId,
        ),
    )
    .map((document) => document.name);

  return (
    <div className="grid gap-3">
      <p className="text-small font-semibold">제출 항목</p>
      <ProgramAuthoringSortableAttachments
        milestoneId={milestoneId}
        requirements={documents.current.map((document) => ({
          ...document,
          id: document.localId,
        }))}
        onReorder={(localIds) =>
          onChange(reorderLocalMilestoneDocuments(documents, localIds))
        }
      >
        {(document, reorderHandle) => (
          <ProgramAuthoringSubmissionItem
            milestoneId={milestoneId}
            requirement={{
              ...document,
              id: document.localId,
              templateFile: null,
              selectedFile: document.selectedFile,
              persistedTemplateFileName: document.persistedTemplateFileName,
            }}
            fileUpload={fileUpload}
            error={
              document.name.trim() === ''
                ? '제출 항목 이름을 입력해 주세요.'
                : document.name.trim().length > 200
                  ? '제출 항목 이름은 200자 이하여야 합니다.'
                  : undefined
            }
            deleteLabel="제출 항목 삭제"
            reorderHandle={reorderHandle}
            onNameChange={(_, localId, name) =>
              onChange(
                updateLocalMilestoneDocument(documents, localId, { name }),
              )
            }
            onRequiredChange={(_, localId, required) =>
              onChange(
                updateLocalMilestoneDocument(documents, localId, { required }),
              )
            }
            onFileChange={(_, localId, selectedFile) =>
              onChange(
                updateLocalMilestoneDocument(documents, localId, {
                  selectedFile,
                }),
              )
            }
            onRemove={(_, localId) =>
              onChange(removeLocalMilestoneDocument(documents, localId))
            }
          />
        )}
      </ProgramAuthoringSortableAttachments>
      {pendingDeletionNames.length > 0 ? (
        <p className="text-small text-muted-foreground">
          <span className="font-semibold">저장 시 삭제:</span>{' '}
          {pendingDeletionNames.join(', ')}
        </p>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() =>
          onChange(addLocalMilestoneDocument(documents, crypto.randomUUID()))
        }
        disabled={documents.current.length >= MAX_REQUIREMENTS_PER_MILESTONE}
      >
        제출 항목 추가
      </Button>
      <p className="text-small text-muted-foreground">
        허용 형식: {fileUpload.formatLabel} · 최대 {fileUpload.maxLabel}
      </p>
    </div>
  );
}
