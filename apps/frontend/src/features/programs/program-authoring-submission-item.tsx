import { Check, Pencil, RefreshCw, Trash2, X } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatFileSize } from '@/lib/format-file-size';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { MilestoneDocumentUploadPolicy } from './milestone-document-api';
import { milestoneDocumentUploadRejection } from './milestone-document-upload-policy';

export type SubmissionItemValue = {
  readonly id: string;
  readonly name: string;
  readonly required: boolean;
  readonly templateFile: {
    readonly name: string;
    readonly size: number;
  } | null;
  readonly selectedFile?: File | null;
  readonly persistedTemplateFileName?: string | null;
};

export function ProgramAuthoringSubmissionItem({
  milestoneId,
  requirement,
  reorderHandle,
  onFileChange,
  onRemove,
  onRequiredChange,
  onNameChange,
  fileUpload,
  error,
  deleteLabel = '첨부파일 삭제',
  nameConfirmLabel = '제출물 이름 저장',
}: {
  readonly milestoneId: string;
  readonly requirement: SubmissionItemValue;
  readonly reorderHandle: ReactNode;
  readonly onFileChange: (
    milestoneId: string,
    requirementId: string,
    file: File | null,
  ) => void;
  readonly onRemove: (milestoneId: string, requirementId: string) => void;
  readonly onRequiredChange: (
    milestoneId: string,
    requirementId: string,
    required: boolean,
  ) => void;
  readonly onNameChange: (
    milestoneId: string,
    requirementId: string,
    name: string,
  ) => void;
  readonly fileUpload?: MilestoneDocumentUploadPolicy;
  readonly error?: string;
  readonly deleteLabel?: string;
  readonly nameConfirmLabel?: string;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editingName, setEditingName] = useState(false);
  const [originalName, setOriginalName] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const fileErrorId = `${milestoneId}-${requirement.id}-file-error`;
  const selectedFile = requirement.selectedFile ?? requirement.templateFile;
  const nameError =
    requirement.name.trim() === ''
      ? '제출 항목 이름을 입력해 주세요.'
      : requirement.name.trim().length > 200
        ? '제출 항목 이름은 200자 이하여야 합니다.'
        : null;
  const uploadLabel =
    selectedFile || requirement.persistedTemplateFileName
      ? '첨부파일 재업로드'
      : '첨부파일 업로드';

  function saveName() {
    if (nameError !== null) return;
    setEditingName(false);
    setOriginalName(null);
  }

  function cancelNameEdit() {
    if (originalName !== null)
      onNameChange(milestoneId, requirement.id, originalName);
    setEditingName(false);
    setOriginalName(null);
  }

  function selectFile(file: File | null) {
    const rejection =
      file === null || fileUpload === undefined
        ? null
        : milestoneDocumentUploadRejection(file, fileUpload);
    setSelectionError(rejection);
    if (file !== null && rejection === null)
      onFileChange(milestoneId, requirement.id, file);
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div
        aria-label={`${requirement.name || '새'} 제출 항목`}
        className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-2 rounded-card border border-border p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
        role="group"
      >
        <div className="row-span-2 shrink-0 self-start">{reorderHandle}</div>
        <div className="min-w-0">
          {editingName ? (
            <Input
              autoFocus
              data-keep-dialog-on-escape
              aria-label="파일 제출물 이름"
              aria-invalid={nameError !== null}
              value={requirement.name}
              onChange={(event) =>
                onNameChange(milestoneId, requirement.id, event.target.value)
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  saveName();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  event.nativeEvent.stopImmediatePropagation();
                  cancelNameEdit();
                }
              }}
            />
          ) : (
            <p className="truncate font-semibold">{requirement.name}</p>
          )}
          {editingName && nameError ? (
            <p className="mt-1 text-small text-destructive" role="alert">
              {nameError}
            </p>
          ) : null}
          {selectedFile || requirement.persistedTemplateFileName ? (
            <p className="mt-1 truncate text-small text-muted-foreground">
              {selectedFile
                ? `${requirement.name !== selectedFile.name ? `${selectedFile.name} · ` : ''}${formatFileSize(selectedFile.size)}`
                : requirement.persistedTemplateFileName}
            </p>
          ) : null}
          <label className="mt-2 flex w-fit items-center gap-2 text-small font-medium">
            <input
              type="checkbox"
              aria-label="필수 제출"
              checked={requirement.required}
              onChange={(event) =>
                onRequiredChange(
                  milestoneId,
                  requirement.id,
                  event.target.checked,
                )
              }
            />
            {requirement.required ? '필수 제출' : '선택 제출'}
          </label>
        </div>
        <div className="col-start-2 flex shrink-0 justify-end gap-1 sm:col-start-3 sm:row-start-1">
          {editingName ? (
            <>
              <IconAction
                label={nameConfirmLabel}
                disabled={nameError !== null}
                onClick={saveName}
              >
                <Check aria-hidden="true" />
              </IconAction>
              <IconAction
                label="제출물 이름 수정 취소"
                onClick={cancelNameEdit}
              >
                <X aria-hidden="true" />
              </IconAction>
            </>
          ) : (
            <>
              <IconAction
                label="제출물 이름 수정"
                onClick={() => {
                  setOriginalName(requirement.name);
                  setEditingName(true);
                }}
              >
                <Pencil aria-hidden="true" />
              </IconAction>
              <IconAction
                label={uploadLabel}
                onClick={() => fileInputRef.current?.click()}
              >
                <RefreshCw aria-hidden="true" />
              </IconAction>
              <input
                ref={fileInputRef}
                className="sr-only"
                aria-label={uploadLabel}
                aria-invalid={selectionError !== null}
                aria-describedby={selectionError ? fileErrorId : undefined}
                type="file"
                accept={fileUpload?.accept ?? '.pdf,.hwp,.jpg,.jpeg,.png,.zip'}
                onChange={(event) => {
                  selectFile(event.target.files?.[0] ?? null);
                  event.target.value = '';
                }}
              />
              {requirement.selectedFile ? (
                <IconAction
                  label="파일 선택 취소"
                  onClick={() => {
                    setSelectionError(null);
                    onFileChange(milestoneId, requirement.id, null);
                  }}
                >
                  <X aria-hidden="true" />
                </IconAction>
              ) : null}
              <IconAction
                label={deleteLabel}
                onClick={() => onRemove(milestoneId, requirement.id)}
              >
                <Trash2 aria-hidden="true" />
              </IconAction>
            </>
          )}
        </div>
        {selectionError || error ? (
          <p
            id={fileErrorId}
            role="alert"
            className="col-start-2 text-small text-destructive"
          >
            {selectionError ?? error}
          </p>
        ) : null}
      </div>
    </TooltipProvider>
  );
}

function IconAction({
  label,
  disabled = false,
  onClick,
  children,
}: {
  readonly label: string;
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
