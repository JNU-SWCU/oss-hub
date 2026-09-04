import { FileUp, Send } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { MilestoneDocumentUploadPolicy } from './milestone-document-api';
import {
  milestoneDocumentUploadHint,
  milestoneDocumentUploadRejection,
} from './milestone-document-upload-policy';

export function MilestoneDocumentSubmissionForm({
  documentName,
  documentId,
  fileUpload,
  submitting,
  onCancel,
  onSubmit,
}: {
  readonly documentName: string;
  readonly documentId: string;
  /** 상한·허용 형식은 서버가 목록 응답으로 준 값을 그대로 쓴다(#1107). */
  readonly fileUpload: MilestoneDocumentUploadPolicy;
  readonly submitting: boolean;
  readonly onCancel: () => void;
  readonly onSubmit: (input: {
    readonly text: string | null;
    readonly file: File | null;
  }) => Promise<boolean>;
}) {
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const hasText = text.trim().length > 0;
  const hasFile = file !== null;
  const helpId = `${documentId}-submission-help`;
  const fileHelpId = `${documentId}-submission-file-help`;
  const fileErrorId = `${documentId}-submission-file-error`;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hasText && !hasFile) return;
    const saved = await onSubmit({ text: hasText ? text.trim() : null, file });
    if (!saved) return;
    setText('');
    setFile(null);
    setFileError(null);
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
          className="min-h-28 rounded-control border border-input bg-background p-3 text-body outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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
          aria-describedby={`${helpId} ${fileHelpId}${fileError === null ? '' : ` ${fileErrorId}`}`}
          onChange={(event) => {
            const selected = event.target.files?.[0] ?? null;
            const rejection =
              selected === null
                ? null
                : milestoneDocumentUploadRejection(selected, fileUpload);
            /*
             * 걸린 파일은 받아 두지 않는다 — 받아 두면 「제출」이 눌리고, 그 요청은
             * 반드시 실패한다. 고른 것을 지워야 학생이 다시 고를 수 있다.
             */
            if (rejection !== null) event.target.value = '';
            setFile(rejection === null ? selected : null);
            setFileError(rejection);
          }}
        />
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
          {/* 실패한 뒤가 아니라 파일을 고르기 전에 상한과 허용 형식을 읽을 수 있어야 한다. */}
          <span>{milestoneDocumentUploadHint(fileUpload)}</span>
        </FieldDescription>
        <FieldError id={fileErrorId}>{fileError}</FieldError>
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
        <Button type="submit" disabled={submitting || (!hasText && !hasFile)}>
          <Send aria-hidden="true" />
          {submitting ? '제출하는 중…' : '제출'}
        </Button>
      </div>
    </form>
  );
}
