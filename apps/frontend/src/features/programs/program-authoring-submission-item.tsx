import { Check, Pencil, RefreshCw, Trash2, X } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ProgramAuthoringRequirement } from './program-authoring-model';

export function ProgramAuthoringSubmissionItem({
  milestoneId,
  requirement,
  reorderHandle,
  onFileChange,
  onRemove,
  onRequiredChange,
  onNameChange,
}: {
  readonly milestoneId: string;
  readonly requirement: ProgramAuthoringRequirement;
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
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(requirement.name);

  function saveName() {
    const name = nameDraft.trim();
    if (name === '') return;
    onNameChange(milestoneId, requirement.id, name);
    setEditingName(false);
  }

  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-2 rounded-card border border-border p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
      <div className="row-span-2 shrink-0 self-start">{reorderHandle}</div>
      <div className="min-w-0">
        {editingName ? (
          <Input
            autoFocus
            aria-label="파일 제출물 이름"
            value={nameDraft}
            onChange={(event) => setNameDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                saveName();
              }
              if (event.key === 'Escape') {
                setNameDraft(requirement.name);
                setEditingName(false);
              }
            }}
          />
        ) : (
          <p className="truncate font-semibold">{requirement.name}</p>
        )}
        {requirement.templateFile ? (
          <p className="mt-1 truncate text-small text-muted-foreground">
            {requirement.name !== requirement.templateFile.name
              ? `${requirement.templateFile.name} · `
              : ''}
            {formatFileSize(requirement.templateFile.size)}
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
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="제출물 이름 저장"
              title="이름 저장"
              disabled={nameDraft.trim() === ''}
              onClick={saveName}
            >
              <Check aria-hidden="true" />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="제출물 이름 수정 취소"
              title="수정 취소"
              onClick={() => {
                setNameDraft(requirement.name);
                setEditingName(false);
              }}
            >
              <X aria-hidden="true" />
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="제출물 이름 수정"
              title="제출물 이름 수정"
              onClick={() => {
                setNameDraft(requirement.name);
                setEditingName(true);
              }}
            >
              <Pencil aria-hidden="true" />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="첨부파일 재업로드"
              title="첨부파일 재업로드"
              onClick={() => fileInputRef.current?.click()}
            >
              <RefreshCw aria-hidden />
            </Button>
            <input
              ref={fileInputRef}
              className="sr-only"
              aria-label="첨부파일 재업로드"
              type="file"
              accept=".pdf,.hwp,.jpg,.jpeg,.png,.zip"
              onChange={(event) => {
                onFileChange(
                  milestoneId,
                  requirement.id,
                  event.target.files?.[0] ?? null,
                );
                event.target.value = '';
              }}
            />
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="첨부파일 삭제"
              title="첨부파일 삭제"
              onClick={() => onRemove(milestoneId, requirement.id)}
            >
              <Trash2 aria-hidden />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function formatFileSize(size: number): string {
  return `${(size / 1024).toFixed(size >= 1024 * 1024 ? 1 : 0)} ${
    size >= 1024 * 1024 ? 'MiB' : 'KiB'
  }`;
}
