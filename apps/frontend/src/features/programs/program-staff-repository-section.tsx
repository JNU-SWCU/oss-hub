'use client';

import { useCallback, useState, type ReactElement } from 'react';
import { RepositoryPublishCard } from '@/components';
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
      <p className="text-small text-muted-foreground">
        아직 신청하지 않은 팀입니다. 저장소 발급은 신청 이후에 시작됩니다.
      </p>
    );
  }

  return (
    <>
      {repository !== null ? (
        <p className="text-small">
          저장소{' '}
          <a
            className="font-semibold break-all underline underline-offset-4"
            href={repository.url}
            rel="noreferrer noopener"
            target="_blank"
          >
            {repository.url}
          </a>{' '}
          ({repository.visibility === 'PUBLIC' ? '공개' : '비공개'})
        </p>
      ) : (
        <p className="text-small text-muted-foreground">
          {PROVISIONING_LABELS[application.repositoryProvisioning.jobStatus]}
        </p>
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
