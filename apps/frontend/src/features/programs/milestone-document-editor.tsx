'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
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
  mergeMilestoneDocumentList,
  milestoneDocumentErrorMessage,
  milestoneDocumentSaveSortOrder,
  removeMilestoneDocumentFromList,
  sortMilestoneDocuments,
  toMilestoneDocumentForm,
  updateMilestoneDocumentEditor,
  upsertMilestoneDocumentInList,
  validateMilestoneDocumentForm,
  type MilestoneDocumentEditor,
  type MilestoneDocumentField,
} from './milestone-document-editor-flow';
import { MilestoneDocumentSortableList } from './milestone-document-sortable-list';
import { ProgramRequirementEditor } from './program-requirement-editor';

export type MilestoneDocumentEditorState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed' }
  | {
      readonly kind: 'ready';
      readonly documents: readonly MilestoneDocument[];
    };

const LOAD_FAILED_MESSAGE = '제출 항목을 불러오지 못했습니다.';
const SAVE_FAILED_MESSAGE =
  '제출 항목을 저장하지 못했습니다. 다시 시도해 주세요.';
const DELETE_FAILED_MESSAGE =
  '제출 항목을 삭제하지 못했습니다. 다시 시도해 주세요.';
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
  readonly onReorder: (
    documentIds: readonly string[],
    activeDocumentId: string,
  ) => Promise<boolean>;
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
  onReorder,
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
          제출 항목
          {expanded && state.kind === 'ready' ? ` ${documents.length}개` : ''}
        </Button>
        {expanded && state.kind === 'ready' ? (
          <Button type="button" size="sm" variant="outline" onClick={onAdd}>
            제출 항목 추가
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
              <div className="grid gap-1 text-small text-muted-foreground">
                <p className="font-semibold text-foreground">
                  아직 제출 항목이 없습니다.
                </p>
                <p>
                  학생이 제출할 수 있도록 위의 ‘제출 항목 추가’를 눌러 첫 항목을
                  만드세요.
                </p>
              </div>
            ) : null}
            {state.kind === 'ready' && documents.length > 0 ? (
              <>
                <div className="grid gap-1 rounded-card border border-primary/20 bg-primary/5 px-3 py-2 text-small">
                  <p className="font-semibold">학생 화면 안내</p>
                  <p className="text-muted-foreground break-keep">
                    학생은 내용이나 파일 중 하나 이상을 추가해 제출합니다. 둘 다
                    추가할 수도 있습니다.
                  </p>
                </div>
                <MilestoneDocumentSortableList
                  milestoneId={milestoneId}
                  documents={documents}
                  isBusy={isBusy}
                  deleteTargetId={deleteTargetId}
                  rowError={rowError}
                  onReorder={onReorder}
                  onEdit={onEdit}
                  onRequestDelete={onRequestDelete}
                  onCancelDelete={onCancelDelete}
                  onConfirmDelete={onConfirmDelete}
                  onTemplateFile={onTemplateFile}
                />
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * 마일스톤 카드 하나의 「제출 항목」 등록 블록.
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
  /**
   * 목록 조회는 겹칠 수 있다 — 첫 요청이 끝나기 전에 패널을 접었다 다시 펴면 두 번
   * 나가고, 늦게 도착한 **옛 응답이 최신 상태를 덮는다.** 그러면 화면에 이미 사라진
   * 행이 남고, 그 목록으로 순서를 바꾸면 전체 집합이 서버와 달라 400(MSD_019)이 난다.
   * 마지막으로 보낸 요청의 번호만 기억해 두고 그 답만 받는다
   * (`milestone-document-collection-screen.tsx`의 `requestIdRef`와 같은 방식).
   *
   * 번호를 올리는 것은 조회만이 아니다 — 변경이 끝나는 자리(`settleMutation`)에서도
   * 올린다. 조회끼리만 막으면 변경 도중에 나간 조회가 그 변경을 덮어 버린다.
   */
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = (requestIdRef.current += 1);
    setState({ kind: 'loading' });
    try {
      const documents = await listMilestoneDocuments(milestoneId);
      if (requestId !== requestIdRef.current) return;
      setState({ kind: 'ready', documents: sortMilestoneDocuments(documents) });
    } catch {
      // 실패도 똑같이 막는다 — 늦게 온 옛 실패가 최신 성공을 오류 화면으로 덮으면
      // 교직원은 멀쩡히 있는 서류 목록을 「불러오지 못했습니다」로 본다.
      if (requestId !== requestIdRef.current) return;
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

  /**
   * 변경(저장·삭제·순서 바꾸기·양식 올리기)이 끝나는 자리 — 그때 날아가 있던 목록
   * 조회를 전부 낡은 것으로 만든다.
   *
   * 조회끼리만 막아서는 부족했다. 변경이 진행되는 동안 패널을 접었다 다시 펴면 그
   * 조회는 **변경 이전** 목록을 읽어 오고, 늦게 도착해 「최신 요청」의 자격으로 방금의
   * 결과를 덮는다 — 방금 만든 항목이나 방금 고친 이름이 다시 불러오기 전까지 화면에서
   * 사라진다. 그 목록으로 순서를 바꾸면 전체 집합이 서버와 달라 400(MSD_019)까지 간다.
   *
   * **성공·실패를 가리지 않는다**(`finally`에서 부른다). 변경이 끝나기 전에 나간 조회는
   * 어느 쪽이든 「변경을 반영한 답인지 알 수 없는 사진」이고, 우리 손에는 방금 서버가
   * 준 목록(성공)이거나 변경이 없었다는 사실(실패)이 있다.
   */
  const settleMutation = () => {
    requestIdRef.current += 1;
    // 방금 무효로 만든 조회가 켜 둔 「불러오는 중…」은 여기서 끈다 — 그 답을 받지 않기로
    // 했으므로 그대로 두면 패널이 영영 「불러오는 중…」에 멈춘다. 성공 경로는 이미
    // `applyDocuments`로 목록을 써 뒀으므로 이 되돌림은 실패 경로에만 걸린다.
    setState((current) =>
      current.kind === 'loading' ? { kind: 'ready', documents } : current,
    );
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
      settleMutation();
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
      settleMutation();
    }
  };

  const reorder = async (
    documentIds: readonly string[],
    activeDocumentId: string,
  ): Promise<boolean> => {
    setIsBusy(true);
    setRowError(null);
    try {
      // 전체 순서를 **한 번의 요청으로** 보낸다. 두 항목을 각각 PATCH하면 한쪽만
      // 성공했을 때 sortOrder가 같아지고, 그 뒤로 「위로」가 영영 먹지 않는다.
      //
      // 응답을 그대로 목록으로 삼는다(낙관적 갱신 X) — sortOrder는 서버가 1부터 다시
      // 매기므로, 우리가 계산한 값으로 화면을 갱신하면 다음 이동의 기준이 서버와
      // 조용히 어긋난다.
      //
      // 다만 재정렬 응답에는 `teamSubmissionCount`가 실리지 않는다(목록 조회에서만
      // 채워진다). 그대로 덮으면 모든 행의 제출 현황이 사라지므로, 그 값만 id로
      // 짝지어 지킨다.
      applyDocuments(
        sortMilestoneDocuments(
          mergeMilestoneDocumentList(
            documents,
            await reorderMilestoneDocuments(milestoneId, documentIds),
          ),
        ),
      );
      return true;
    } catch (error: unknown) {
      setRowError({
        documentId: activeDocumentId,
        message: milestoneDocumentErrorMessage(error, MOVE_FAILED_MESSAGE),
      });
      return false;
    } finally {
      setIsBusy(false);
      settleMutation();
    }
  };

  const uploadTemplate = async (document: MilestoneDocument, file: File) => {
    setIsBusy(true);
    setRowError(null);
    try {
      const uploaded = await uploadMilestoneDocumentTemplate(
        milestoneId,
        document.id,
        file,
      );
      applyDocuments(
        upsertMilestoneDocumentInList(documents, {
          ...document,
          hasTemplateFile: true,
          templateFileName: uploaded.fileName,
        }),
      );
    } catch (error: unknown) {
      setRowError({
        documentId: document.id,
        message: milestoneDocumentErrorMessage(error, TEMPLATE_FAILED_MESSAGE),
      });
    } finally {
      setIsBusy(false);
      settleMutation();
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
        });
        setDeleteTargetId(null);
      }}
      onEdit={(document) => {
        setEditor({
          mode: 'edit',
          form: toMilestoneDocumentForm(document),
          errors: {},
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
      onReorder={reorder}
      onTemplateFile={(document, file) => void uploadTemplate(document, file)}
    />
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
  return (
    <form
      className="grid gap-3 rounded-card border border-border p-3"
      onSubmit={onSave}
    >
      <p className="text-small font-bold">
        {editor.mode === 'create' ? '제출 항목 추가' : '제출 항목 수정'}
      </p>
      <ProgramRequirementEditor
        idPrefix={`milestone-${milestoneId}-document`}
        value={editor.form}
        errors={{ name: editor.errors.name, general: editor.errors.general }}
        onNameChange={(name) => onFieldChange('name', name)}
        onRequiredChange={(required) => onFieldChange('required', required)}
      />
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
