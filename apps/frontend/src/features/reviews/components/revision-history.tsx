import { StatusBadge } from '@/components';
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
  revisionContent,
  revisionLinks,
} from '../review-format';
import type { SubmissionRevision } from '../types';

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
  return (
    <Card size={current ? 'default' : 'sm'}>
      <CardHeader className="border-b border-border">
        <CardTitle>
          revision {revision.number}
          {current ? ' (최신)' : ''}
        </CardTitle>
        <CardDescription>
          {formatReviewDate(revision.submittedAt)}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-1">
          <h3 className="text-sm font-medium">제출 내용</h3>
          <pre className="max-w-full overflow-x-auto rounded-lg bg-muted p-3 text-sm whitespace-pre-wrap break-words [word-break:keep-all]">
            {revisionContent(revision)}
          </pre>
        </div>
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
