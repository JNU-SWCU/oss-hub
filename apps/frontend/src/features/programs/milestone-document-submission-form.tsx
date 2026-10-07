import { FileText, FileUp, Send } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { MilestoneDocumentUploadPolicy } from './milestone-document-api';
import {
  milestoneDocumentUploadHint,
  milestoneDocumentUploadRejection,
} from './milestone-document-upload-policy';
import { useMilestoneDocumentFileCheck } from './use-milestone-document-file-check';

export function MilestoneDocumentSubmissionForm({
  documentName,
  documentId,
  fileUpload,
  currentFileName,
  isResubmission = false,
  submitting,
  fileRejection = null,
  onCancel,
  onSubmit,
}: {
  readonly documentName: string;
  readonly documentId: string;

  readonly fileUpload: MilestoneDocumentUploadPolicy;

  readonly currentFileName: string | null;
  readonly isResubmission?: boolean;
  readonly submitting: boolean;

  readonly fileRejection?: {
    readonly file: File;
    readonly message: string;
  } | null;
  readonly onCancel: () => void;
  readonly onSubmit: (input: {
    readonly text: string | null;
    readonly file: File | null;
  }) => Promise<boolean>;
}) {
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [rejectedFile, setRejectedFile] = useState<{
    readonly name: string;
    readonly reason: string;
  } | null>(null);
  const fileCheck = useMilestoneDocumentFileCheck(file);
  const fileVerdict =
    (fileRejection !== null && fileRejection.file === file
      ? fileRejection.message
      : null) ?? fileCheck.message;
  const fileError = rejectedFile?.reason ?? fileVerdict;
  const hasText = text.trim().length > 0;
  const hasFile = file !== null;
  const helpId = `${documentId}-submission-help`;
  const fileHelpId = `${documentId}-submission-file-help`;
  const fileErrorId = `${documentId}-submission-file-error`;
  const currentFileHelpId = `${documentId}-submission-current-file`;

  const fileDescribedBy = [
    helpId,
    fileHelpId,
    ...(currentFileName === null ? [] : [currentFileHelpId]),
    ...(fileError === null ? [] : [fileErrorId]),
  ].join(' ');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || rejectedFile !== null || (!hasText && !hasFile)) return;
    const saved = await onSubmit({ text: hasText ? text.trim() : null, file });
    if (!saved) return;
    setText('');
    setFile(null);
    setRejectedFile(null);
  }

  return (
    <form
      className="grid gap-4 rounded-card border border-primary/25 bg-primary/5 p-4"
      onSubmit={(event) => void handleSubmit(event)}
    >
      <div
        id={helpId}
        className="grid gap-1 break-keep text-small text-muted-foreground"
      >
        <span>내용이나 파일을 하나 이상 추가해 주세요.</span>
        <span>둘 다 추가해도 됩니다.</span>
      </div>
      <Field>
        <FieldLabel htmlFor={`${documentId}-submission-text`}>
          내용 <span className="font-normal text-muted-foreground">(선택)</span>
        </FieldLabel>
        <textarea
          id={`${documentId}-submission-text`}
          aria-describedby={helpId}
          value={text}
          placeholder="제출할 내용이나 설명을 적어 주세요."
          className={cn(
            'min-h-28 rounded-control border border-input bg-background p-3 text-body',
            'outline-none focus-visible:border-ring focus-visible:ring-3',
            'focus-visible:ring-ring/50',
          )}
          maxLength={10_000}
          onChange={(event) => setText(event.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${documentId}-submission-file`}>
          파일 <span className="font-normal text-muted-foreground">(선택)</span>
        </FieldLabel>
        <Input
          id={`${documentId}-submission-file`}
          type="file"
          accept={fileUpload.accept}
          aria-label={`${documentName} 제출 파일 선택`}
          aria-invalid={fileError !== null}
          aria-describedby={fileDescribedBy}
          onChange={(event) => {
            const selected = event.target.files?.[0] ?? null;
            const rejection =
              selected === null
                ? null
                : milestoneDocumentUploadRejection(selected, fileUpload);

            if (rejection !== null) event.target.value = '';
            setFile(rejection === null ? selected : null);
            setRejectedFile(
              rejection === null || selected === null
                ? null
                : { name: selected.name, reason: rejection },
            );

            fileCheck.start(rejection === null ? selected : null);
          }}
        />
        {fileCheck.checking ? (
          <FieldDescription role="status" aria-live="polite">
            파일 확인 중…
          </FieldDescription>
        ) : null}
        {fileVerdict === null ? null : (
          <FieldError id={fileErrorId}>{fileVerdict}</FieldError>
        )}
        {rejectedFile === null ? null : (
          <div className="grid min-w-0 gap-2 rounded-control border border-destructive/35 bg-destructive/5 p-3">
            <span
              className="break-all text-small font-medium"
              title={rejectedFile.name}
            >
              {rejectedFile.name}
            </span>
            <FieldError id={fileErrorId}>{rejectedFile.reason}</FieldError>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-fit"
              disabled={submitting}
              onClick={() => setRejectedFile(null)}
            >
              파일 없이 계속
            </Button>
          </div>
        )}
        <FieldDescription
          id={fileHelpId}
          className="grid min-w-0 gap-1 break-keep"
        >
          {file === null ? (
            <span>필요한 경우 파일을 함께 첨부할 수 있습니다.</span>
          ) : (
            <span className="flex min-w-0 max-w-full items-center gap-2 font-medium text-foreground">
              <FileUp className="size-4" aria-hidden="true" />
              <span
                className="min-w-0 break-all [overflow-wrap:anywhere]"
                title={file.name}
              >
                {file.name}
              </span>
            </span>
          )}

          <span>{milestoneDocumentUploadHint(fileUpload)}</span>
        </FieldDescription>
        {currentFileName === null ? null : (
          <FieldDescription
            id={currentFileHelpId}
            className="min-w-0 grid gap-1 break-keep"
          >
            <span className="flex min-w-0 max-w-full items-center gap-2">
              <FileText className="size-4 shrink-0" aria-hidden="true" />
              <span className="shrink-0 font-medium text-foreground">
                기존 제출 파일
              </span>
              <span
                className="min-w-0 break-all [overflow-wrap:anywhere]"
                title={currentFileName}
              >
                {currentFileName}
              </span>
            </span>

            {hasFile ? null : (
              <span className="text-foreground">
                새 파일을 고르지 않으면 이 파일은 이번 제출에서 빠집니다. 그대로
                두려면 같은 파일을 다시 첨부해 주세요.
              </span>
            )}
          </FieldDescription>
        )}
      </Field>
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          disabled={submitting}
          onClick={onCancel}
        >
          취소
        </Button>
        <Button
          type="submit"
          disabled={
            submitting || rejectedFile !== null || (!hasText && !hasFile)
          }
        >
          <Send aria-hidden="true" />
          {submitting ? '제출하는 중…' : isResubmission ? '다시 제출' : '제출'}
        </Button>
      </div>
    </form>
  );
}
