import { ExternalLink } from 'lucide-react';

import { StatusBadge } from '@/components';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

import { blockedReasonLabel } from '../review-format';
import type { ReviewRepository } from '../types';

/**
 * 공개가 막힌 사유를 버튼의 설명으로 잇는다 — 비활성 버튼만으로는
 * 화면을 읽어 주는 도구가 "왜 못 누르는지"를 말해 줄 수 없다.
 * (같은 기법: `milestone-document-collection-view.tsx`의 `ARCHIVE_HINT_ID`)
 */
const PUBLISH_BLOCKED_REASONS_ID = 'repository-publish-blocked-reasons';

export interface RepositoryPublishCardProps {
  readonly repository: ReviewRepository | null;
  readonly isPublishing: boolean;
  readonly errorMessage: string | null;
  readonly onPublish: () => void;
}

export function RepositoryPublishCard({
  repository,
  isPublishing,
  errorMessage,
  onPublish,
}: RepositoryPublishCardProps) {
  if (!repository) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>저장소 공개</CardTitle>
          <CardDescription className="[word-break:keep-all]">
            이 신청에는 공개할 GitHub 저장소가 연결되어 있지 않습니다.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const isPublic = repository.visibility === 'PUBLIC';
  return (
    <Card>
      <CardHeader className="border-b border-border">
        <CardTitle className="flex flex-wrap items-center gap-2">
          저장소 공개
          <StatusBadge variant={isPublic ? 'approved' : 'pending'}>
            {repository.visibility}
          </StatusBadge>
        </CardTitle>
        <CardDescription className="[word-break:keep-all]">
          판정 저장과 별도로 GitHub 저장소를 공개 전환합니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {errorMessage ? (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}
        {isPublic ? (
          <Button asChild variant="outline" className="w-fit">
            <a href={repository.url} target="_blank" rel="noreferrer">
              공개 저장소 열기
              <ExternalLink aria-hidden="true" />
            </a>
          </Button>
        ) : (
          <div className="grid gap-3">
            <Button asChild variant="outline" className="w-fit">
              <a href={repository.url} target="_blank" rel="noreferrer">
                비공개 저장소 확인
                <ExternalLink aria-hidden="true" />
              </a>
            </Button>
            {repository.publishEligible ? (
              <p className="text-sm text-muted-foreground [word-break:keep-all]">
                공개 조건을 모두 충족해 공개할 수 있습니다.
              </p>
            ) : (
              <ul
                id={PUBLISH_BLOCKED_REASONS_ID}
                className="grid gap-1 text-sm text-muted-foreground"
              >
                {repository.blockedReasons.map((reason) => (
                  <li key={reason} className="[word-break:keep-all]">
                    {blockedReasonLabel(reason)}
                  </li>
                ))}
              </ul>
            )}
            <Button
              type="button"
              className="w-fit"
              disabled={!repository.publishEligible || isPublishing}
              aria-describedby={
                repository.publishEligible
                  ? undefined
                  : PUBLISH_BLOCKED_REASONS_ID
              }
              onClick={onPublish}
            >
              {isPublishing ? '공개 전환 중' : 'GitHub 저장소 공개 전환'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
