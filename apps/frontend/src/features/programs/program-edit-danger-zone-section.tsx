'use client';

import { useRef, useState } from 'react';
import { SectionHeading } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
  readonly isAdmin: boolean;
  /** true면 이 프로그램은 서버가 삭제·전체 삭제 둘 다 거부한다(F2 finding #1) — ADMIN이어도
   * API로 우회할 수 없으므로 버튼 자체를 비활성화한다. */
  readonly deletionProtected?: boolean;
  /** 삭제 완료 후 목록으로 이동하면서 전달할 확인 문구. */
  readonly onDeleted?: (notice?: string) => void;
}

type DialogKind = 'purge' | null;

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
  publicShowcaseRepositories: '공개 아카이브 저장소',
  outboxEvents: '이벤트 대기열',
  notifications: '알림',
  programPurgeFileTombstones: '파일 삭제 대기',
};

export function ProgramEditDangerZoneSection({
  programId,
  programName,
  isAdmin,
  deletionProtected = false,
  onDeleted = (notice) =>
    window.location.assign(
      notice ? `/programs?purged=${encodeURIComponent(notice)}` : '/programs',
    ),
}: ProgramEditDangerZoneSectionProps) {
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [purgeCounts, setPurgeCounts] =
    useState<ProgramDeletionScopeCounts | null>(null);
  const [isPurgeScopeLoading, setIsPurgeScopeLoading] = useState(false);
  const [purgeScopeError, setPurgeScopeError] = useState<string | null>(null);
  const [purgeError, setPurgeError] = useState<string | null>(null);
  const purgeScopeRequest = useRef(0);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const isOpen = dialog !== null;

  const open = (nextDialog: Exclude<DialogKind, null>) => {
    setDialog(nextDialog);
    setConfirmText('');
    setPurgeError(null);
    if (nextDialog !== 'purge') return;

    const request = purgeScopeRequest.current + 1;
    purgeScopeRequest.current = request;
    setPurgeCounts(null);
    setPurgeScopeError(null);
    setIsPurgeScopeLoading(true);
    void getEditableProgram(programId).then(
      (program) => {
        if (purgeScopeRequest.current !== request) return;
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
        if (purgeScopeRequest.current !== request) return;
        setPurgeScopeError(
          '삭제 범위를 확인하지 못했습니다. 다시 시도해 주세요.',
        );
        setIsPurgeScopeLoading(false);
      },
    );
  };
  const close = () => {
    purgeScopeRequest.current += 1;
    setDialog(null);
    setConfirmText('');
    setPurgeError(null);
    setPurgeCounts(null);
    setPurgeScopeError(null);
    setIsPurgeScopeLoading(false);
  };

  /**
   * 화면이 마지막으로 보여준 `purgeCounts`를 그대로 expectedScope로 보낸다 — 재확인용
   * 별도 GET 재조회를 먼저 하지 않는다(그 자체가 확인-purge 사이의 또 다른 요청이라
   * TOCTOU를 재도입한다, #F2). 범위 비교는 백엔드 purge 트랜잭션 안에서만 일어난다.
   * 409(PRG_014)가 오면 자동 재시도하지 않고 응답이 실은 현재 카운트로 화면을 갱신해
   * 관리자가 이름을 다시 입력하여 명시적으로 재확인하게 한다.
   */
  const confirmPurge = async () => {
    if (
      confirmText !== programName ||
      busy ||
      isPurgeScopeLoading ||
      !purgeCounts
    ) {
      return;
    }
    setBusy(true);
    setPurgeError(null);
    setPurgeScopeError(null);
    try {
      const result = await purgeProgram(programId, purgeCounts);
      onDeleted(formatDeletedCounts(result.deletedCounts));
    } catch (reason: unknown) {
      const changedCounts = purgeScopeChangedCounts(reason);
      if (changedCounts) {
        setPurgeCounts(changedCounts);
        setConfirmText('');
        setPurgeScopeError(
          '삭제 범위가 변경되었습니다. 내용을 확인한 뒤 프로그램 이름을 다시 입력해 주세요.',
        );
      } else {
        setPurgeError(purgeErrorMessage(reason));
      }
    } finally {
      setBusy(false);
    }
  };

  if (!isAdmin) {
    return (
      <section className="grid gap-6">
        <SectionHeading title="위험 영역" />
        <p className="text-body text-muted-foreground [word-break:keep-all]">
          이 프로그램을 운영에서 내리려면 게시 상태에서 아카이브로 전환해
          주세요.
        </p>
      </section>
    );
  }

  return (
    <section className="grid gap-6">
      <SectionHeading title="위험 영역" />
      <p className="text-body text-muted-foreground [word-break:keep-all]">
        연결된 데이터와 관련 기록을 포함해 되돌릴 수 없이 삭제합니다.
      </p>
      {deletionProtected ? (
        <Alert>
          <AlertTitle>삭제 보호된 프로그램입니다</AlertTitle>
          <AlertDescription>
            이 프로그램은 삭제 보호가 설정되어 관리자도 삭제하거나 전체 삭제할
            수 없습니다.
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="destructive"
          ref={triggerRef}
          disabled={deletionProtected}
          onClick={() => open('purge')}
        >
          프로그램 영구 삭제
        </Button>
      </div>
      {isOpen ? (
        <ProgramEditPurgeConfirmation
          programName={programName}
          confirmText={confirmText}
          busy={busy}
          purgeCounts={purgeCounts}
          isPurgeScopeLoading={isPurgeScopeLoading}
          purgeScopeError={purgeScopeError}
          purgeError={purgeError}
          onConfirmTextChange={setConfirmText}
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
    // `submissions`가 기존 제출과 서류 제출의 합계이므로 서류 제출을 다시 더해 보여 주지 않는다.
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
