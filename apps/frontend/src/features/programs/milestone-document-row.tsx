'use client';

import { Upload } from 'lucide-react';
import { useRef, type ChangeEvent, type ReactNode } from 'react';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import {
  milestoneDocumentTemplateHref,
  type MilestoneDocument,
} from './milestone-document-api';

interface MilestoneDocumentRowProps {
  readonly document: MilestoneDocument;
  readonly isBusy: boolean;
  readonly deleteRequested: boolean;
  readonly deleteDisabled: boolean;
  readonly errorMessage: string | null;
  readonly reorderHandle: ReactNode;
  readonly onEdit: (document: MilestoneDocument) => void;
  readonly onRequestDelete: (document: MilestoneDocument) => void;
  readonly onCancelDelete: () => void;
  readonly onConfirmDelete: () => void;
  readonly onTemplateFile: (document: MilestoneDocument, file: File) => void;
}

export function MilestoneDocumentRow({
  document,
  isBusy,
  deleteRequested,
  deleteDisabled,
  errorMessage,
  reorderHandle,
  onEdit,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
  onTemplateFile,
}: MilestoneDocumentRowProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) onTemplateFile(document, file);
  }

  return (
    <div className="grid gap-3 rounded-control border border-border/70 bg-background p-3">
      <div className="grid gap-2 sm:flex sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {reorderHandle}
          <span
            className="min-w-0 flex-1 break-words text-small font-semibold"
            title={document.name}
          >
            {document.name}
            {document.required ? (
              <span aria-label="필수" className="ml-0.5 text-destructive">
                *
              </span>
            ) : null}
          </span>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
          {document.hasTemplateFile && document.templateFileName ? (
            <a
              className="min-w-0 max-w-full truncate text-small underline underline-offset-2 sm:max-w-56"
              href={milestoneDocumentTemplateHref(
                document.milestoneId,
                document.id,
              )}
              title={document.templateFileName}
              download={document.templateFileName}
            >
              {document.templateFileName}
            </a>
          ) : null}
          <StatusBadge
            variant={document.hasTemplateFile ? 'approved' : 'closed'}
          >
            {document.hasTemplateFile ? '양식 있음' : '양식 없음'}
          </StatusBadge>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
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
          disabled={isBusy || deleteDisabled}
          title={
            deleteDisabled
              ? '마일스톤에는 제출 항목이 하나 이상 필요합니다.'
              : undefined
          }
          onClick={() => onRequestDelete(document)}
        >
          삭제
        </Button>
      </div>
      {deleteRequested ? (
        <div className="flex flex-wrap items-center justify-end gap-2 rounded-card border border-border bg-muted/40 px-3 py-2">
          <p className="mr-auto text-small text-muted-foreground">
            {document.name} 제출 항목을 삭제합니다. 되돌릴 수 없습니다.
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
        <p role="alert" className="text-small text-destructive">
          {errorMessage} 문제를 확인한 뒤 다시 시도해 주세요.
        </p>
      ) : null}
    </div>
  );
}
