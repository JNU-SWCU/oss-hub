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
import type { MilestoneDocumentUploadPolicy } from './milestone-document-api';
import {
  milestoneDocumentUploadHint,
  milestoneDocumentUploadRejection,
} from './milestone-document-upload-policy';

/**
 * 제출·재제출 폼.
 *
 * ⚠ 재제출은 **첨부를 옮겨 오지 않는다**(#1090에서 확정한 동작). 파일을 다시 고르지
 * 않으면 지금 붙어 있는 첨부가 이번 제출에서 빠지고, 교직원의 수합 표·개별 내려받기·
 * 마일스톤 ZIP 세 곳에서 함께 사라진다. 그래서 이 폼은 **누르기 전에** 무엇이 빠지는지를
 * 말해야 한다.
 *
 * ⚠ 경고는 재제출이 열리는 **모든 상태**에 둔다 — 보완 요청(CHANGES_REQUESTED)뿐 아니라
 * 교직원이 아직 판정하지 않은 검토 대기(SUBMITTED)도 같은 폼으로 다시 내며, 후자는
 * 아무도 문제 삼지 않은 파일이 사라지는 경로다. 그 판단을 상태로 하지 않고 「지금 붙어
 * 있는 첨부가 있는가」 하나로 하는 이유가 그것이다.
 */
export function MilestoneDocumentSubmissionForm({
  documentName,
  documentId,
  fileUpload,
  currentFileName,
  submitting,
  onCancel,
  onSubmit,
}: {
  readonly documentName: string;
  readonly documentId: string;
  /** 상한·허용 형식은 서버가 목록 응답으로 준 값을 그대로 쓴다(#1107). */
  readonly fileUpload: MilestoneDocumentUploadPolicy;
  /** 지금 이 서류에 붙어 있는 첨부의 이름. 없으면 `null`. */
  readonly currentFileName: string | null;
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
  const currentFileHelpId = `${documentId}-submission-current-file`;
  /*
   * 파일 입력이 가리키는 설명은 둘이 서로 독립으로 늘고 준다 — 기존 첨부가 빠진다는
   * 경고(#1090)와 상한·형식에 걸렸다는 안내(#1107). 한쪽 조건으로 문자열을 통째로
   * 갈아 끼우면 다른 쪽이 조용히 지워지므로, 있는 것만 모아 잇는다.
   */
  const fileDescribedBy = [
    helpId,
    fileHelpId,
    ...(currentFileName === null ? [] : [currentFileHelpId]),
    ...(fileError === null ? [] : [fileErrorId]),
  ].join(' ');

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
          aria-describedby={fileDescribedBy}
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
            {/*
             * 새 파일을 고른 순간 이 경고는 사라진다 — 그때는 빠지는 것이 아니라
             * 바뀌는 것이라, 같은 문구를 계속 두면 학생이 무엇을 걱정해야 하는지 흐려진다.
             */}
            {hasFile ? null : (
              <span className="text-foreground">
                새 파일을 고르지 않으면 이 파일은 이번 제출에서 빠집니다. 그대로
                두려면 같은 파일을 다시 첨부해 주세요.
              </span>
            )}
          </FieldDescription>
        )}
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
