import Link from 'next/link';
import { Download, FileText } from 'lucide-react';
import { StatusBadge } from '@/components';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatFileSize } from '@/lib/format-file-size';
import { programDocumentsHref } from '@/lib/program-route';
import {
  CHECKLIST_STATUS_LABELS,
  CHECKLIST_STATUS_VARIANTS,
  checklistItemStatus,
  deadlineVariant,
  isRevisionNeeded,
  milestoneDeadline,
} from '../submission-checklist';
import type { SubmissionChecklistItem, SubmissionFileMetadata } from '../types';
import { formatDeadline, TYPE_LABELS } from './submission-form-view';

export function submissionTriggerId(milestoneId: string): string {
  return `submission-trigger-${milestoneId}`;
}

export function ChecklistRow({
  programId,
  item,
  now,
  onSelectMilestone,
}: {
  readonly programId: string;
  readonly item: SubmissionChecklistItem;
  readonly now: Date;
  readonly onSelectMilestone?: (milestoneId: string) => void;
}) {
  const status = checklistItemStatus(item);
  const deadline = milestoneDeadline(item.dueAt, now);
  // 미제출 → "올리기", 재제출 가능 → "다시 제출", 그 외(승인·검토중·
  // 최종반려처럼 손댈 수 없는 상태) → "보기".
  const revisionNeeded = isRevisionNeeded(item.submission);
  const canUpload = status === 'NOT_SUBMITTED' || revisionNeeded;
  const actionLabel =
    status === 'NOT_SUBMITTED'
      ? '올리기'
      : revisionNeeded
        ? '다시 제출'
        : '보기';
  // 마감(dueAt)이 지났으면 업로드 자리를 막는다 — "시작 전" 판정은 마일스톤에
  // 시작 시각 데이터가 없어 여기서는 낼 수 없다(스펙 Open Question #4 참고).
  const uploadDisabled = canUpload && deadline.dDay < 0;
  const submissionHref = programDocumentsHref(programId, item.milestoneId);
  return (
    <li className="min-w-0">
      <Card className="min-w-0 gap-3" data-testid="checklist-row">
        <CardHeader className="gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="grid gap-1">
            <CardTitle>{item.name}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {formatDeadline(item.dueAt)} · {TYPE_LABELS[item.submissionType]}
            </p>
          </div>
          <StatusBadge variant={deadlineVariant(deadline.dDay)}>
            {deadline.label}
          </StatusBadge>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <StatusBadge variant={CHECKLIST_STATUS_VARIANTS[status]}>
              {CHECKLIST_STATUS_LABELS[status]}
            </StatusBadge>
            {item.submission?.file ? (
              <SubmissionFileLink file={item.submission.file} compact />
            ) : null}
          </div>
          {uploadDisabled ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled
              aria-disabled="true"
              id={submissionTriggerId(item.milestoneId)}
              title="마감이 지나 업로드할 수 없습니다."
            >
              {actionLabel}
            </Button>
          ) : (
            <Button asChild size="sm" variant="outline">
              <Link
                href={submissionHref}
                id={submissionTriggerId(item.milestoneId)}
                onClick={
                  onSelectMilestone
                    ? (event) => {
                        if (
                          event.defaultPrevented ||
                          event.button !== 0 ||
                          event.metaKey ||
                          event.altKey ||
                          event.ctrlKey ||
                          event.shiftKey
                        ) {
                          return;
                        }
                        event.preventDefault();
                        onSelectMilestone(item.milestoneId);
                      }
                    : undefined
                }
              >
                {actionLabel}
              </Link>
            </Button>
          )}
        </CardContent>
      </Card>
    </li>
  );
}

export function SubmissionFileLink({
  file,
  compact = false,
}: {
  readonly file: SubmissionFileMetadata;
  readonly compact?: boolean;
}) {
  return (
    <a
      href={file.downloadUrl}
      download={file.fileName}
      className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <FileText
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
      <span className="min-w-0 truncate">{file.fileName}</span>
      <span className="shrink-0 text-muted-foreground">
        {formatFileSize(file.size)}
      </span>
      {compact ? null : (
        <Download
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
      )}
    </a>
  );
}
