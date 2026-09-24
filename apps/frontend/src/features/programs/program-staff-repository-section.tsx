'use client';

import { useCallback, useState, type ReactElement } from 'react';
import { RepositoryPublishCard, StatusBadge } from '@/components';
import { ApiError } from '@/lib/api-client';
import { publishRepository } from '@/lib/repository-publication';
import { PROVISIONING_LABELS } from './application-presentation';
import type { StaffTeamDetailApplication } from './types';

export function ProgramStaffRepositorySection({
  application,
}: {
  readonly application: StaffTeamDetailApplication | null;
}): ReactElement {
  const [repository, setRepository] = useState(application?.repository ?? null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  const handlePublish = useCallback(async (): Promise<void> => {
    if (repository === null) return;
    setIsPublishing(true);
    setPublishError(null);
    try {
      await publishRepository(repository.id);
      setRepository((current) =>
        current === null
          ? null
          : {
              ...current,
              visibility: 'PUBLIC',
              publishEligible: true,
              blockedReasons: [],
            },
      );
    } catch (error: unknown) {
      setPublishError(
        error instanceof ApiError
          ? error.problem.detail
          : '저장소를 공개 전환하지 못했습니다.',
      );
    } finally {
      setIsPublishing(false);
    }
  }, [repository]);

  if (application === null) {
    return (
      <div className="grid gap-1 break-keep text-small text-muted-foreground">
        <p>아직 신청하지 않은 팀입니다.</p>
        <p>신청 후 저장소를 발급합니다.</p>
      </div>
    );
  }

  // 주소는 바로 위 URL 줄이 말한다(`RepositoryUrlEditor`). 여기는 공개 여부·발급·공개 전환만 남는다.
  return (
    <>
      {repository === null ? (
        <p className="text-small text-muted-foreground">
          저장소 발급{' '}
          {PROVISIONING_LABELS[application.repositoryProvisioning.jobStatus]}
        </p>
      ) : (
        <StatusBadge variant="closed">
          {repository.visibility === 'PUBLIC' ? '공개' : '비공개'}
        </StatusBadge>
      )}

      {application.repositoryConnectionMode === 'NEW' && repository !== null ? (
        <RepositoryPublishCard
          repository={repository}
          isPublishing={isPublishing}
          errorMessage={publishError}
          onPublish={() => void handlePublish()}
        />
      ) : null}
    </>
  );
}
