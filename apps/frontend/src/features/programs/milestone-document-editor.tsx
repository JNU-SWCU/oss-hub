'use client';

import { ChevronDown, ChevronRight, Upload } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import { StatusBadge } from '@/components';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  createMilestoneDocument,
  deleteMilestoneDocument,
  listMilestoneDocuments,
  reorderMilestoneDocuments,
  updateMilestoneDocument,
  uploadMilestoneDocumentTemplate,
  type MilestoneDocument,
} from './milestone-document-api';
import {
  buildMilestoneDocumentInput,
  emptyMilestoneDocumentForm,
  milestoneDocumentErrorMessage,
  milestoneDocumentSaveSortOrder,
  milestoneDocumentSubmissionTypeLocked,
  planMilestoneDocumentOrder,
  removeMilestoneDocumentFromList,
  sortMilestoneDocuments,
  SUBMISSION_TYPE_CHOICES,
  SUBMISSION_TYPE_LOCKED_MESSAGE,
  submissionTypeLabel,
  toMilestoneDocumentForm,
  updateMilestoneDocumentEditor,
  upsertMilestoneDocumentInList,
  validateMilestoneDocumentForm,
  type MilestoneDocumentEditor,
  type MilestoneDocumentField,
} from './milestone-document-editor-flow';

export type MilestoneDocumentEditorState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed' }
  | {
      readonly kind: 'ready';
      readonly documents: readonly MilestoneDocument[];
    };

const LOAD_FAILED_MESSAGE = '제출 서류를 불러오지 못했습니다.';
const SAVE_FAILED_MESSAGE = '서류를 저장하지 못했습니다. 다시 시도해 주세요.';
const DELETE_FAILED_MESSAGE = '서류를 삭제하지 못했습니다. 다시 시도해 주세요.';
const MOVE_FAILED_MESSAGE = '순서를 바꾸지 못했습니다. 다시 시도해 주세요.';
const TEMPLATE_FAILED_MESSAGE = '양식을 올리지 못했습니다. 다시 시도해 주세요.';

interface MilestoneDocumentEditorBodyProps {
  readonly milestoneId: string;
  readonly expanded: boolean;
  readonly state: MilestoneDocumentEditorState;
  readonly editor: MilestoneDocumentEditor;
  readonly deleteTargetId: string | null;
  readonly isBusy: boolean;
  readonly rowError: {
    readonly documentId: string;
    readonly message: string;
  } | null;
  readonly onToggle: () => void;
  readonly onRetry: () => void;
  readonly onAdd: () => void;
  readonly onEdit: (document: MilestoneDocument) => void;
  readonly onCancelEditor: () => void;
  readonly onFieldChange: (
    field: MilestoneDocumentField,
    value: string | boolean,
  ) => void;
  readonly onSaveEditor: (event: React.FormEvent<HTMLFormElement>) => void;
  readonly onRequestDelete: (document: MilestoneDocument) => void;
  readonly onCancelDelete: () => void;
  readonly onConfirmDelete: () => void;
  readonly onMove: (documentId: string, direction: 'up' | 'down') => void;
  readonly onTemplateFile: (document: MilestoneDocument, file: File) => void;
}

/** 순수 렌더 본문 — 컨테이너의 fetch/상태 관리와 분리해 정적 렌더로 테스트한다. */
export function MilestoneDocumentEditorBody({
  milestoneId,
  expanded,
  state,
  editor,
  deleteTargetId,
  isBusy,
  rowError,
  onToggle,
  onRetry,
  onAdd,
  onEdit,
  onCancelEditor,
  onFieldChange,
  onSaveEditor,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
  onMove,
  onTemplateFile,
}: MilestoneDocumentEditorBodyProps) {
  const panelId = `milestone-${milestoneId}-documents`;
  const documents = state.kind === 'ready' ? state.documents : [];

  return (
    <div className="grid gap-3 border-t border-border/50 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="px-2"
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={onToggle}
        >
          {expanded ? (
            <ChevronDown aria-hidden />
          ) : (
            <ChevronRight aria-hidden />
          )}
          받을 서류
          {expanded && state.kind === 'ready' ? ` ${documents.length}개` : ''}
        </Button>
        {expanded && state.kind === 'ready' ? (
          <Button type="button" size="sm" variant="outline" onClick={onAdd}>
            항목 추가
          </Button>
        ) : null}
      </div>
      {/* 접힌 패널은 내용을 그리지 않는다 — 아직 불러오지도 않은 목록의 잔해를 남기지 않기 위해서다. */}
      <div id={panelId} hidden={!expanded} className="grid gap-3">
        {!expanded ? null : (
          <>
            {state.kind === 'loading' ? (
              <p className="text-small text-muted-foreground">불러오는 중…</p>
            ) : null}
            {state.kind === 'failed' ? (
              <div className="grid gap-2 text-small text-muted-foreground">
                <p>{LOAD_FAILED_MESSAGE}</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="w-fit"
                  onClick={onRetry}
                >
                  다시 시도
                </Button>
              </div>
            ) : null}
            {editor.mode === 'closed' ? null : (
              <MilestoneDocumentForm
                milestoneId={milestoneId}
                editor={editor}
                isBusy={isBusy}
                onCancel={onCancelEditor}
                onFieldChange={onFieldChange}
                onSave={onSaveEditor}
              />
            )}
            {state.kind === 'ready' && documents.length === 0 ? (
              <p className="text-small text-muted-foreground">
                아직 등록한 서류가 없습니다.
              </p>
            ) : null}
            {state.kind === 'ready' && documents.length > 0 ? (
              <ul
                className="grid gap-2"
                data-testid="milestone-document-editor-rows"
              >
                {documents.map((document, index) => (
                  <MilestoneDocumentRow
                    key={document.id}
                    document={document}
                    isFirst={index === 0}
                    isLast={index === documents.length - 1}
                    isBusy={isBusy}
                    deleteRequested={deleteTargetId === document.id}
                    errorMessage={
                      rowError?.documentId === document.id
                        ? rowError.message
                        : null
                    }
                    onEdit={onEdit}
                    onRequestDelete={onRequestDelete}
                    onCancelDelete={onCancelDelete}
                    onConfirmDelete={onConfirmDelete}
                    onMove={onMove}
                    onTemplateFile={onTemplateFile}
                  />
                ))}
              </ul>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * 마일스톤 카드 하나의 「받을 서류」 등록 블록.
 *
 * 목록은 펼칠 때 불러온다 — 마일스톤이 많은 프로그램에서 카드 수만큼 미리
 * 조회하면 편집 화면 첫 렌더가 그만큼 느려지기 때문이다.
 */
export function MilestoneDocumentEditorSection({
  milestoneId,
  defaultExpanded = false,
}: {
  readonly milestoneId: string;
  /** 저장 직후 새로 마운트되는 카드만 펼친 채로 시작한다 — 이후 토글은 카드가 스스로 기억한다. */
  readonly defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [state, setState] = useState<MilestoneDocumentEditorState>({
    kind: 'loading',
  });
  const [editor, setEditor] = useState<MilestoneDocumentEditor>({
    mode: 'closed',
  });
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [rowError, setRowError] = useState<{
    readonly documentId: string;
    readonly message: string;
  } | null>(null);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      setState({
        kind: 'ready',
        documents: sortMilestoneDocuments(
          await listMilestoneDocuments(milestoneId),
        ),
      });
    } catch {
      setState({ kind: 'failed' });
    }
  }, [milestoneId]);

  useEffect(() => {
    if (!expanded) return;
    void load();
  }, [expanded, load]);

  const documents = state.kind === 'ready' ? state.documents : [];

  const applyDocuments = (next: readonly MilestoneDocument[]) => {
    setState({ kind: 'ready', documents: next });
  };

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (editor.mode === 'closed') return;
    const form = editor.form;
    const errors = validateMilestoneDocumentForm(form);
    if (errors.name !== undefined) {
      setEditor({ ...editor, errors });
      return;
    }
    const input = buildMilestoneDocumentInput(
      form,
      milestoneDocumentSaveSortOrder(documents, form.id),
    );
    setIsBusy(true);
    setRowError(null);
    try {
      const saved =
        form.id === null
          ? await createMilestoneDocument(milestoneId, input)
          : await updateMilestoneDocument(milestoneId, form.id, input);
      applyDocuments(upsertMilestoneDocumentInList(documents, saved));
      setEditor({ mode: 'closed' });
    } catch (error: unknown) {
      setEditor((current) =>
        current.mode === 'closed'
          ? current
          : {
              ...current,
              errors: {
                general: milestoneDocumentErrorMessage(
                  error,
                  SAVE_FAILED_MESSAGE,
                ),
              },
            },
      );
    } finally {
      setIsBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (deleteTargetId === null) return;
    setIsBusy(true);
    setRowError(null);
    try {
      await deleteMilestoneDocument(milestoneId, deleteTargetId);
      applyDocuments(
        removeMilestoneDocumentFromList(documents, deleteTargetId),
      );
      setDeleteTargetId(null);
    } catch (error: unknown) {
      setRowError({
        documentId: deleteTargetId,
        message: milestoneDocumentErrorMessage(error, DELETE_FAILED_MESSAGE),
      });
    } finally {
      setIsBusy(false);
    }
  };

  const move = async (documentId: string, direction: 'up' | 'down') => {
    const documentIds = planMilestoneDocumentOrder(
      documents,
      documentId,
      direction,
    );
    if (documentIds === null) return;
    setIsBusy(true);
    setRowError(null);
    try {
      // 전체 순서를 **한 번의 요청으로** 보낸다. 두 항목을 각각 PATCH하면 한쪽만
      // 성공했을 때 sortOrder가 같아지고, 그 뒤로 「위로」가 영영 먹지 않는다.
      //
      // 응답을 그대로 목록으로 삼는다(낙관적 갱신 X) — sortOrder는 서버가 1부터 다시
      // 매기므로, 우리가 계산한 값으로 화면을 갱신하면 다음 이동의 기준이 서버와
      // 조용히 어긋난다.
      applyDocuments(
        sortMilestoneDocuments(
          await reorderMilestoneDocuments(milestoneId, documentIds),
        ),
      );
    } catch (error: unknown) {
      setRowError({
        documentId,
        message: milestoneDocumentErrorMessage(error, MOVE_FAILED_MESSAGE),
      });
    } finally {
      setIsBusy(false);
    }
  };

  const uploadTemplate = async (document: MilestoneDocument, file: File) => {
    setIsBusy(true);
    setRowError(null);
    try {
      await uploadMilestoneDocumentTemplate(milestoneId, document.id, file);
      applyDocuments(
        upsertMilestoneDocumentInList(documents, {
          ...document,
          hasTemplateFile: true,
        }),
      );
    } catch (error: unknown) {
      setRowError({
        documentId: document.id,
        message: milestoneDocumentErrorMessage(error, TEMPLATE_FAILED_MESSAGE),
      });
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <MilestoneDocumentEditorBody
      milestoneId={milestoneId}
      expanded={expanded}
      state={state}
      editor={editor}
      deleteTargetId={deleteTargetId}
      isBusy={isBusy}
      rowError={rowError}
      onToggle={() => setExpanded((value) => !value)}
      onRetry={() => void load()}
      onAdd={() => {
        setEditor({
          mode: 'create',
          form: emptyMilestoneDocumentForm(),
          errors: {},
          // 아직 없는 항목에 제출이 있을 수 없다.
          submissionTypeLocked: false,
        });
        setDeleteTargetId(null);
      }}
      onEdit={(document) => {
        setEditor({
          mode: 'edit',
          form: toMilestoneDocumentForm(document),
          errors: {},
          submissionTypeLocked: milestoneDocumentSubmissionTypeLocked(document),
        });
        setDeleteTargetId(null);
      }}
      onCancelEditor={() => setEditor({ mode: 'closed' })}
      onFieldChange={(field, value) =>
        setEditor((current) =>
          updateMilestoneDocumentEditor(current, field, value),
        )
      }
      onSaveEditor={(event) => void save(event)}
      onRequestDelete={(document) => {
        setRowError(null);
        setDeleteTargetId(document.id);
      }}
      onCancelDelete={() => setDeleteTargetId(null)}
      onConfirmDelete={() => void confirmDelete()}
      onMove={(documentId, direction) => void move(documentId, direction)}
      onTemplateFile={(document, file) => void uploadTemplate(document, file)}
    />
  );
}

function MilestoneDocumentRow({
  document,
  isFirst,
  isLast,
  isBusy,
  deleteRequested,
  errorMessage,
  onEdit,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
  onMove,
  onTemplateFile,
}: {
  readonly document: MilestoneDocument;
  readonly isFirst: boolean;
  readonly isLast: boolean;
  readonly isBusy: boolean;
  readonly deleteRequested: boolean;
  readonly errorMessage: string | null;
  readonly onEdit: (document: MilestoneDocument) => void;
  readonly onRequestDelete: (document: MilestoneDocument) => void;
  readonly onCancelDelete: () => void;
  readonly onConfirmDelete: () => void;
  readonly onMove: (documentId: string, direction: 'up' | 'down') => void;
  readonly onTemplateFile: (document: MilestoneDocument, file: File) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    onTemplateFile(document, file);
  }

  return (
    <li className="grid gap-1" data-testid="milestone-document-editor-row">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-small">
          {document.name}
          {document.required ? (
            <span aria-label="필수" className="ml-0.5 text-destructive">
              *
            </span>
          ) : null}
        </span>
        <StatusBadge variant="recruiting">
          {submissionTypeLabel(document.submissionType)}
        </StatusBadge>
        <StatusBadge variant={document.hasTemplateFile ? 'approved' : 'closed'}>
          {document.hasTemplateFile ? '양식 있음' : '양식 없음'}
        </StatusBadge>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isBusy}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload aria-hidden />
          {document.hasTemplateFile ? '양식 교체' : '양식 올리기'}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          className="sr-only"
          aria-label={`${document.name} 양식 파일 선택`}
          onChange={handleFile}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isBusy}
          onClick={() => onEdit(document)}
        >
          수정
        </Button>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={isBusy}
          onClick={() => onRequestDelete(document)}
        >
          삭제
        </Button>
        {/*
         * 순서 바꾸기는 드래그가 아니라 버튼 두 개다 — 드래그 손잡이는 키보드·화면 읽기
         * 도구 사용자가 쓸 수 없어 같은 결함으로 QA를 반복해 받았다. 버튼은 그대로 동작한다.
         */}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={isBusy || isFirst}
          aria-label={`${document.name} 위로`}
          onClick={() => onMove(document.id, 'up')}
        >
          위로
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={isBusy || isLast}
          aria-label={`${document.name} 아래로`}
          onClick={() => onMove(document.id, 'down')}
        >
          아래로
        </Button>
      </div>
      {deleteRequested ? (
        <div className="flex flex-wrap items-center justify-end gap-2 rounded-card border border-border bg-muted/40 px-3 py-2">
          <p className="mr-auto text-small text-muted-foreground">
            {document.name} 서류를 삭제합니다. 되돌릴 수 없습니다.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isBusy}
            onClick={onCancelDelete}
          >
            취소
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={isBusy}
            onClick={onConfirmDelete}
          >
            삭제 확정
          </Button>
        </div>
      ) : null}
      {errorMessage ? (
        <p className="text-small text-destructive">{errorMessage}</p>
      ) : null}
    </li>
  );
}

function MilestoneDocumentForm({
  milestoneId,
  editor,
  isBusy,
  onCancel,
  onFieldChange,
  onSave,
}: {
  readonly milestoneId: string;
  readonly editor: Exclude<
    MilestoneDocumentEditor,
    { readonly mode: 'closed' }
  >;
  readonly isBusy: boolean;
  readonly onCancel: () => void;
  readonly onFieldChange: (
    field: MilestoneDocumentField,
    value: string | boolean,
  ) => void;
  readonly onSave: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const nameId = `milestone-${milestoneId}-document-name`;
  const requiredId = `milestone-${milestoneId}-document-required`;
  const typeId = `milestone-${milestoneId}-document-submission-type`;
  const typeLockId = `${typeId}-locked`;

  return (
    <form
      className="grid gap-3 rounded-card border border-border p-3"
      onSubmit={onSave}
    >
      <p className="text-small font-bold">
        {editor.mode === 'create' ? '서류 추가' : '서류 수정'}
      </p>
      <Field>
        <FieldLabel htmlFor={nameId}>서류명 *</FieldLabel>
        <Input
          id={nameId}
          value={editor.form.name}
          onChange={(event) => onFieldChange('name', event.target.value)}
        />
        <FieldError>{editor.errors.name}</FieldError>
      </Field>
      <Field orientation="horizontal">
        <input
          id={requiredId}
          type="checkbox"
          checked={editor.form.required}
          onChange={(event) => onFieldChange('required', event.target.checked)}
        />
        <FieldLabel htmlFor={requiredId}>
          필수 제출 — 끄면 선택 제출이 됩니다
        </FieldLabel>
      </Field>
      <Field>
        <FieldLabel htmlFor={typeId}>제출 방식</FieldLabel>
        {/*
         * 제출이 이미 들어온 항목은 선택을 잠근다 — 서버도 409(MSD_016)로 막지만,
         * 눌러 본 뒤에 실패로 알게 하면 왜 안 되는지가 남지 않는다. 이름·필수 여부는
         * 제출이 있어도 고칠 수 있으므로 이 필드만 잠근다.
         */}
        <Select
          id={typeId}
          value={editor.form.submissionType}
          disabled={editor.submissionTypeLocked}
          aria-describedby={
            editor.submissionTypeLocked ? typeLockId : undefined
          }
          onChange={(event) =>
            onFieldChange('submissionType', event.target.value)
          }
        >
          {SUBMISSION_TYPE_CHOICES.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </Select>
        {editor.submissionTypeLocked ? (
          <FieldDescription id={typeLockId}>
            {SUBMISSION_TYPE_LOCKED_MESSAGE}
          </FieldDescription>
        ) : null}
      </Field>
      <FieldError>{editor.errors.general}</FieldError>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onCancel}
          disabled={isBusy}
        >
          취소
        </Button>
        <Button type="submit" size="sm" disabled={isBusy}>
          {isBusy ? '저장 중…' : '저장'}
        </Button>
      </div>
    </form>
  );
}
