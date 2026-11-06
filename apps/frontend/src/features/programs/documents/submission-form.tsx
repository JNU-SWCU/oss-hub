'use client';

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
import type {
  RequirementUploadPolicy,
  RequirementSubmissionType,
} from './requirement-dto';
import {
  requirementUploadHint,
  requirementUploadRejection,
} from './requirement-upload-policy';
import { useRequirementFileCheck } from './use-requirement-file-check';

export function SubmissionForm({
  documentName,
  documentId,
  submissionType = 'FILE_OR_TEXT',
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
  readonly submissionType?: RequirementSubmissionType;

  readonly fileUpload: RequirementUploadPolicy;

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
    readonly comment?: string;
  }) => Promise<boolean>;
}) {
  const [text, setText] = useState('');
  const [comment, setComment] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [rejectedFile, setRejectedFile] = useState<{
    readonly name: string;
    readonly reason: string;
  } | null>(null);
  const fileCheck = useRequirementFileCheck(file);
  const fileVerdict =
    (fileRejection !== null && fileRejection.file === file
      ? fileRejection.message
      : null) ?? fileCheck.message;
  const fileError = rejectedFile?.reason ?? fileVerdict;
  const hasText = text.trim().length > 0;
  const hasFile = file !== null;
  const acceptsText = submissionType !== 'FILE';
  const acceptsFile = submissionType !== 'TEXT';
  const hasContent = (acceptsText && hasText) || (acceptsFile && hasFile);
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
    if (submitting || rejectedFile !== null || !hasContent) return;
    const saved = await onSubmit({
      text: acceptsText && hasText ? text.trim() : null,
      file: acceptsFile ? file : null,
      ...(comment.trim() ? { comment: comment.trim() } : {}),
    });
    if (!saved) return;
    setText('');
    setComment('');
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
        <span>
          {
            (
              {
                FILE: '파일을 선택해 주세요.',
                TEXT: '제출할 내용을 입력해 주세요.',
                FILE_OR_TEXT:
                  '내용이나 파일을 하나 이상 추가해 주세요. 둘 다 추가해도 됩니다.',
              } satisfies Record<RequirementSubmissionType, string>
            )[submissionType]
          }
        </span>
      </div>
      {acceptsText ? (
        <Field>
          <FieldLabel htmlFor={`${documentId}-submission-text`}>
            내용{' '}
            <span className="font-normal text-muted-foreground">
              {submissionType === 'TEXT' ? '(필수)' : '(선택)'}
            </span>
          </FieldLabel>
          <textarea
            id={`${documentId}-submission-text`}
            aria-describedby={helpId}
            value={text}
            required={submissionType === 'TEXT'}
            disabled={submitting}
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
      ) : null}
      {acceptsFile ? (
        <Field>
          <FieldLabel htmlFor={`${documentId}-submission-file`}>
            파일{' '}
            <span className="font-normal text-muted-foreground">
              {submissionType === 'FILE' ? '(필수)' : '(선택)'}
            </span>
          </FieldLabel>
          <Input
            id={`${documentId}-submission-file`}
            type="file"
            required={submissionType === 'FILE'}
            disabled={submitting}
            accept={fileUpload.accept}
            aria-label={`${documentName} 제출 파일 선택`}
            aria-invalid={fileError !== null}
            aria-describedby={fileDescribedBy}
            onChange={(event) => {
              const selected = event.target.files?.[0] ?? null;
              const rejection =
                selected === null
                  ? null
                  : requirementUploadRejection(selected, fileUpload);

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
                {submissionType === 'FILE' ? '선택 초기화' : '파일 없이 계속'}
              </Button>
            </div>
          )}
          <FieldDescription
            id={fileHelpId}
            className="grid min-w-0 gap-1 break-keep"
          >
            {file === null ? (
              <span>
                {submissionType === 'FILE'
                  ? '제출할 파일을 선택해 주세요.'
                  : '필요한 경우 파일을 함께 첨부할 수 있습니다.'}
              </span>
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

            <span>{requirementUploadHint(fileUpload)}</span>
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
                  새 파일을 고르지 않으면 이 파일은 이번 제출에서 빠집니다.
                  그대로 두려면 같은 파일을 다시 첨부해 주세요.
                </span>
              )}
            </FieldDescription>
          )}
        </Field>
      ) : null}
      <Field>
        <FieldLabel htmlFor={`${documentId}-submission-comment`}>
          제출 코멘트 (선택)
        </FieldLabel>
        <textarea
          id={`${documentId}-submission-comment`}
          value={comment}
          disabled={submitting}
          maxLength={2000}
          onChange={(event) => setComment(event.target.value)}
          className={cn(
            'min-h-20 rounded-control border border-input bg-background p-3 text-body outline-none',
            'focus-visible:ring-3 focus-visible:ring-ring/50',
          )}
        />
        <FieldDescription>최대 2,000자</FieldDescription>
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
          disabled={submitting || rejectedFile !== null || !hasContent}
        >
          <Send aria-hidden="true" />
          {submitting ? '제출하는 중…' : isResubmission ? '다시 제출' : '제출'}
        </Button>
      </div>
    </form>
  );
}
