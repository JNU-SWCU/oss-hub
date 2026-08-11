import { Download, FileText } from 'lucide-react';
import { StatusBadge } from '@/components';
import { formatFileSize } from '@/lib/format-file-size';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

import {
  DECISION_PRESENTATION,
  formatReviewDate,
  isFileOnlyRevision,
  revisionContent,
  revisionLinks,
} from '../review-format';
import type { SubmissionRevision, SubmissionRevisionFile } from '../types';

function ReviewResult({ revision }: { readonly revision: SubmissionRevision }) {
  const review = revision.review;
  if (!review) {
    return <StatusBadge variant="pending">미검토</StatusBadge>;
  }
  const presentation = DECISION_PRESENTATION[review.decision];
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge variant={presentation.variant}>
          {presentation.label}
        </StatusBadge>
        <span className="text-sm text-muted-foreground">
          {formatReviewDate(review.reviewedAt)}
        </span>
      </div>
      {review.comment ? (
        <p className="text-sm whitespace-pre-wrap text-foreground">
          {review.comment}
        </p>
      ) : null}
    </div>
  );
}

export function RevisionCard({
  revision,
  current = false,
}: {
  readonly revision: SubmissionRevision;
  readonly current?: boolean;
}) {
  const links = revisionLinks(revision);
  const contentText = revisionContent(revision);
  // FILE 유형인데 첨부가 비어 있으면(보존 기한 만료 등) 보여 줄 본문 텍스트가 없다 —
  // 빈 <pre>를 그리는 대신 제출 자체는 있었다는 사실을 짧게 알린다.
  const showFileOnlyNotice =
    contentText === '' &&
    isFileOnlyRevision(revision) &&
    revision.files.length === 0;
  return (
    <Card size={current ? 'default' : 'sm'}>
      <CardHeader className="border-b border-border">
        <CardTitle>
          제출본 {revision.number}번{current ? ' (최신)' : ''}
        </CardTitle>
        <CardDescription>
          {formatReviewDate(revision.submittedAt)}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {contentText !== '' ? (
          <div className="grid gap-1">
            <h3 className="text-sm font-medium">제출 내용</h3>
            <pre className="max-w-full overflow-x-auto rounded-lg bg-muted p-3 text-sm whitespace-pre-wrap break-words [word-break:keep-all]">
              {contentText}
            </pre>
          </div>
        ) : null}
        {showFileOnlyNotice ? (
          <p className="text-sm text-muted-foreground">파일 제출</p>
        ) : null}
        {links.length > 0 ? (
          <div className="grid gap-1">
            <h3 className="text-sm font-medium">제출 링크</h3>
            <ul className="grid gap-1 text-sm">
              {links.map((link) => (
                <li key={link}>
                  <a
                    href={link}
                    target="_blank"
                    rel="noreferrer"
                    className="break-all text-primary underline underline-offset-4"
                  >
                    {link}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {revision.files.length > 0 ? (
          <div className="grid gap-1">
            <h3 className="text-sm font-medium">첨부 파일</h3>
            <ul className="grid gap-2 text-sm">
              {revision.files.map((file) => (
                <li key={file.fileId}>
                  <RevisionFileLink file={file} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {revision.comment ? (
          <div className="grid gap-1">
            <h3 className="text-sm font-medium">제출 코멘트</h3>
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">
              {revision.comment}
            </p>
          </div>
        ) : null}
        <div className="grid gap-1">
          <h3 className="text-sm font-medium">판정</h3>
          <ReviewResult revision={revision} />
        </div>
      </CardContent>
    </Card>
  );
}

function RevisionFileLink({ file }: { readonly file: SubmissionRevisionFile }) {
  return (
    <a
      href={file.downloadUrl}
      download={file.fileName}
      className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <FileText
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
      <span className="min-w-0 truncate">{file.fileName}</span>
      <span className="shrink-0 text-muted-foreground">
        {formatFileSize(file.size)}
      </span>
      <Download
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
    </a>
  );
}
