'use client';

import { useEffect, useRef, useState } from 'react';
import { SectionHeading } from '@/components';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-client';
import {
  getEditableProgram,
  purgeProgram,
  type ProgramDeletionScopeCounts,
  type ProgramPurgeDeletedCounts,
} from './api';
import { purgeScopeChangedCounts } from './program-edit-delete-flow';
import { ProgramEditPurgeConfirmation } from './program-edit-purge-confirmation';

interface ProgramEditDangerZoneSectionProps {
  readonly programId: string;
  readonly programName: string;

  readonly canDeleteProgram: boolean;

  readonly onDeleted: (notice?: string) => void;
}

const PURGE_COUNT_LABELS: Readonly<Record<string, string>> = {
  applications: '지원서',
  teams: '팀',
  teamMembers: '팀원',
  teamInvitations: '팀 초대',
  boardPosts: '게시글',
  boardComments: '댓글',
  submissions: '제출물',
  submissionRevisions: '제출물 리비전',
  reviews: '검토',
  submissionFiles: '제출 파일',
  milestones: '마일스톤',
  milestoneDocuments: '마일스톤 서류',
  milestoneDocumentSubmissions: '서류 제출',
  milestoneDocumentSubmissionHistories: '서류 제출 이력',
  milestoneDocumentReviewHistories: '서류 검토 이력',
  milestoneDocumentTemplateFiles: '서류 양식 파일',
  programAuthoringUploads: '프로그램 작성 업로드',
  programCreateRequests: '프로그램 작성 요청',
  repositoryProvisionJobs: '저장소 발급 작업',
  githubRepositoriesDetached: '분리된 GitHub 저장소 연결',
  outboxEvents: '이벤트 대기열',
  notifications: '알림',
  programPurgeFileTombstones: '파일 삭제 대기',
};

export function ProgramEditDangerZoneSection({
  programId,
  programName,
  canDeleteProgram,
  onDeleted,
}: ProgramEditDangerZoneSectionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [purgeCounts, setPurgeCounts] =
    useState<ProgramDeletionScopeCounts | null>(null);
  const [isPurgeScopeLoading, setIsPurgeScopeLoading] = useState(false);
  const [purgeScopeError, setPurgeScopeError] = useState<string | null>(null);
  const [purgeError, setPurgeError] = useState<string | null>(null);
  const purgeScopeRequest = useRef(0);
  const mountedRef = useRef(true);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      purgeScopeRequest.current += 1;
    };
  }, []);

  const open = () => {
    setIsOpen(true);
    setPurgeError(null);
    const request = purgeScopeRequest.current + 1;
    purgeScopeRequest.current = request;
    setPurgeCounts(null);
    setPurgeScopeError(null);
    setIsPurgeScopeLoading(true);
    void getEditableProgram(programId).then(
      (program) => {
        if (!mountedRef.current || purgeScopeRequest.current !== request) {
          return;
        }
        const counts = program.deletionScopeCounts;
        if (counts) {
          setPurgeCounts(counts);
        } else {
          setPurgeScopeError(
            '삭제 범위를 확인하지 못했습니다. 다시 시도해 주세요.',
          );
        }
        setIsPurgeScopeLoading(false);
      },
      () => {
        if (!mountedRef.current || purgeScopeRequest.current !== request) {
          return;
        }
        setPurgeScopeError(
          '삭제 범위를 확인하지 못했습니다. 다시 시도해 주세요.',
        );
        setIsPurgeScopeLoading(false);
      },
    );
  };
  const close = () => {
    purgeScopeRequest.current += 1;
    setIsOpen(false);
    setPurgeError(null);
    setPurgeCounts(null);
    setPurgeScopeError(null);
    setIsPurgeScopeLoading(false);
  };

  const confirmPurge = async () => {
    if (busy || isPurgeScopeLoading || !purgeCounts) {
      return;
    }
    setBusy(true);
    setPurgeError(null);
    setPurgeScopeError(null);
    try {
      const result = await purgeProgram(programId, purgeCounts);
      if (mountedRef.current) {
        onDeleted(formatDeletedCounts(result.deletedCounts));
      }
    } catch (reason: unknown) {
      if (!mountedRef.current) return;
      const changedCounts = purgeScopeChangedCounts(reason);
      if (changedCounts) {
        setPurgeCounts(changedCounts);
        setPurgeScopeError(
          '삭제 범위가 변경되었습니다. 내용을 확인한 뒤 삭제를 다시 눌러 주세요.',
        );
      } else {
        setPurgeError(purgeErrorMessage(reason));
      }
    } finally {
      if (mountedRef.current) {
        setBusy(false);
      }
    }
  };

  if (!canDeleteProgram) {
    return null;
  }

  return (
    <section className="grid gap-6">
      <SectionHeading title="위험 영역" />
      <p className="text-body text-muted-foreground [word-break:keep-all]">
        연결된 데이터와 관련 기록을 포함해 되돌릴 수 없이 삭제합니다.
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="destructive"
          ref={triggerRef}
          onClick={open}
        >
          프로그램 삭제
        </Button>
      </div>
      {isOpen ? (
        <ProgramEditPurgeConfirmation
          programName={programName}
          busy={busy}
          purgeCounts={purgeCounts}
          isPurgeScopeLoading={isPurgeScopeLoading}
          purgeScopeError={purgeScopeError}
          purgeError={purgeError}
          onConfirm={() => void confirmPurge()}
          onClose={() => {
            close();
            requestAnimationFrame(() => triggerRef.current?.focus());
          }}
        />
      ) : null}
    </section>
  );
}

function formatDeletedCounts(counts: ProgramPurgeDeletedCounts): string {
  const items = (Object.entries(counts) as [string, number][])

    .filter(
      ([key, count]) => count > 0 && key !== 'milestoneDocumentSubmissions',
    )
    .map(([key, count]) => `${PURGE_COUNT_LABELS[key] ?? key} ${count}건`);
  return items.join(' · ') || '연결된 데이터가 없었습니다.';
}

function purgeErrorMessage(reason: unknown): string {
  if (reason instanceof ApiError) {
    return reason.problem.detail || '프로그램 전체를 삭제하지 못했습니다.';
  }
  return '프로그램 전체를 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}
