'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { AlertDialog } from 'radix-ui';
import { SectionHeading } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api-client';
import {
  deleteProgram,
  getEditableProgram,
  purgeProgram,
  type ProgramPurgeDeletedCounts,
} from './api';
import {
  mapProgramDeleteError,
  type ProgramDeleteBlockingCounts,
  type ProgramDeleteError,
} from './program-edit-delete-flow';

interface ProgramEditDangerZoneSectionProps {
  readonly programId: string;
  readonly programName: string;
  readonly isAdmin: boolean;
  /** 삭제 완료 후 목록으로 이동하면서 전달할 확인 문구. */
  readonly onDeleted?: (notice?: string) => void;
}

type DialogKind = 'delete' | 'purge' | null;

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
  onDeleted = (notice) =>
    window.location.assign(
      notice ? `/programs?purged=${encodeURIComponent(notice)}` : '/programs',
    ),
}: ProgramEditDangerZoneSectionProps) {
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<ProgramDeleteError | null>(
    null,
  );
  const [blockingCounts, setBlockingCounts] =
    useState<ProgramDeleteBlockingCounts | null>(null);
  const [purgeCounts, setPurgeCounts] =
    useState<ProgramDeleteBlockingCounts | null>(null);
  const [isPurgeScopeLoading, setIsPurgeScopeLoading] = useState(false);
  const [purgeScopeError, setPurgeScopeError] = useState<string | null>(null);
  const [purgeError, setPurgeError] = useState<string | null>(null);
  const purgeScopeRequest = useRef(0);

  const isOpen = dialog !== null;
  const canConfirm =
    confirmText === programName &&
    !busy &&
    (dialog !== 'purge' || (!isPurgeScopeLoading && purgeCounts !== null));

  const open = (nextDialog: Exclude<DialogKind, null>) => {
    setDialog(nextDialog);
    setConfirmText('');
    setDeleteError(null);
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
    setDeleteError(null);
    setPurgeError(null);
    setPurgeCounts(null);
    setPurgeScopeError(null);
    setIsPurgeScopeLoading(false);
  };

  const confirmDelete = async () => {
    if (!canConfirm) return;
    setBusy(true);
    setDeleteError(null);
    try {
      await deleteProgram(programId);
      onDeleted();
    } catch (reason: unknown) {
      const error = mapProgramDeleteError(reason, programId);
      setDeleteError(error);
      if (error.kind === 'blocked') setBlockingCounts(error.counts);
    } finally {
      setBusy(false);
    }
  };

  const confirmPurge = async () => {
    if (!canConfirm || !purgeCounts) return;
    setBusy(true);
    setPurgeError(null);
    setPurgeScopeError(null);
    setIsPurgeScopeLoading(true);
    try {
      const latestCounts = (await getEditableProgram(programId))
        .deletionScopeCounts;
      if (!latestCounts) {
        setPurgeScopeError(
          '삭제 범위를 확인하지 못했습니다. 다시 시도해 주세요.',
        );
        return;
      }
      if (!sameCounts(purgeCounts, latestCounts)) {
        setPurgeCounts(latestCounts);
        setConfirmText('');
        setPurgeScopeError(
          '삭제 범위가 변경되었습니다. 내용을 확인한 뒤 프로그램 이름을 다시 입력해 주세요.',
        );
        return;
      }

      setIsPurgeScopeLoading(false);
      const result = await purgeProgram(programId);
      onDeleted(formatDeletedCounts(result.deletedCounts));
    } catch (reason: unknown) {
      setPurgeError(purgeErrorMessage(reason));
    } finally {
      setIsPurgeScopeLoading(false);
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
        일반 삭제는 연결된 데이터가 없을 때만 가능합니다. 연결 데이터를 포함한
        삭제는 되돌릴 수 없습니다.
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="destructive"
          onClick={() => open('delete')}
        >
          삭제
        </Button>
        <Button
          type="button"
          variant="destructive"
          onClick={() => open('purge')}
        >
          연결 데이터까지 모두 삭제
        </Button>
      </div>
      {isOpen ? (
        <AlertDialog.Root
          open
          onOpenChange={(next) => !next && !busy && close()}
        >
          <AlertDialog.Portal>
            <AlertDialog.Overlay className="fixed inset-0 z-50 bg-foreground/35" />
            <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 outline-none">
              <Card className="shadow-xl">
                <CardHeader>
                  <AlertDialog.Title asChild>
                    <CardTitle>
                      {dialog === 'purge'
                        ? '연결 데이터까지 모두 삭제할까요?'
                        : '프로그램을 영구히 삭제할까요?'}
                    </CardTitle>
                  </AlertDialog.Title>
                </CardHeader>
                <CardContent className="grid gap-5">
                  <>
                    <AlertDialog.Description className="text-body text-muted-foreground [word-break:keep-all]">
                      {dialog === 'purge'
                        ? '연결된 지원서, 팀, 게시글, 제출물과 관련 기록을 모두 삭제합니다.'
                        : '연결된 데이터가 있으면 삭제할 수 없습니다.'}{' '}
                      계속하려면 프로그램 이름{' '}
                      <span className="font-semibold text-foreground">
                        {programName}
                      </span>
                      을(를) 아래에 그대로 입력해 주세요.
                    </AlertDialog.Description>
                    {dialog === 'purge' && isPurgeScopeLoading ? (
                      <Alert>
                        <AlertTitle>삭제될 데이터</AlertTitle>
                        <AlertDescription>
                          삭제 범위를 확인하는 중입니다.
                        </AlertDescription>
                      </Alert>
                    ) : null}
                    {dialog === 'purge' && purgeCounts ? (
                      <BlockingSummary counts={purgeCounts} />
                    ) : null}
                    {dialog === 'purge' && purgeScopeError ? (
                      <Alert variant="destructive">
                        <AlertTitle>삭제 범위를 확인하지 못했습니다</AlertTitle>
                        <AlertDescription>{purgeScopeError}</AlertDescription>
                      </Alert>
                    ) : null}
                    <Field>
                      <FieldLabel
                        htmlFor={
                          dialog === 'purge'
                            ? 'program-purge-confirm-name'
                            : 'program-delete-confirm-name'
                        }
                      >
                        프로그램 이름
                      </FieldLabel>
                      <Input
                        id={
                          dialog === 'purge'
                            ? 'program-purge-confirm-name'
                            : 'program-delete-confirm-name'
                        }
                        value={confirmText}
                        disabled={busy}
                        autoComplete="off"
                        onChange={(event) => setConfirmText(event.target.value)}
                      />
                    </Field>
                    {dialog === 'delete' && deleteError ? (
                      <DeleteErrorAlert error={deleteError} />
                    ) : null}
                    {dialog === 'purge' && purgeError ? (
                      <Alert variant="destructive">
                        <AlertTitle>전체 삭제 실패</AlertTitle>
                        <AlertDescription>{purgeError}</AlertDescription>
                      </Alert>
                    ) : null}
                    <div className="flex flex-wrap justify-end gap-2">
                      <AlertDialog.Cancel asChild>
                        <Button type="button" variant="outline" disabled={busy}>
                          취소
                        </Button>
                      </AlertDialog.Cancel>
                      <Button
                        type="button"
                        variant="destructive"
                        disabled={!canConfirm}
                        onClick={() =>
                          void (dialog === 'purge'
                            ? confirmPurge()
                            : confirmDelete())
                        }
                      >
                        {isPurgeScopeLoading
                          ? busy
                            ? '삭제 범위를 다시 확인하는 중…'
                            : '삭제 범위를 확인하는 중…'
                          : busy
                            ? '삭제하는 중…'
                            : dialog === 'purge'
                              ? '연결 데이터까지 모두 삭제'
                              : '삭제'}
                      </Button>
                    </div>
                  </>
                </CardContent>
              </Card>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      ) : null}
    </section>
  );
}

function sameCounts(
  left: ProgramDeleteBlockingCounts,
  right: ProgramDeleteBlockingCounts,
): boolean {
  return (
    left.applications === right.applications &&
    left.teams === right.teams &&
    left.boardPosts === right.boardPosts &&
    left.submissions === right.submissions
  );
}

function BlockingSummary({
  counts,
}: {
  readonly counts: ProgramDeleteBlockingCounts;
}) {
  const summaryItems: ReadonlyArray<readonly [string, number, string]> = [
    ['지원서', counts.applications, '건'],
    ['팀', counts.teams, '개'],
    ['게시글', counts.boardPosts, '건'],
    ['제출물', counts.submissions, '건'],
  ];
  const summary = summaryItems
    .filter(([, count]) => count > 0)
    .map(([label, count, unit]) => `${label} ${count}${unit}`)
    .join(' · ');
  return (
    <Alert>
      <AlertTitle>삭제될 데이터</AlertTitle>
      <AlertDescription>
        {summary ? `삭제될 데이터: ${summary}` : '연결된 데이터 없음'}
      </AlertDescription>
    </Alert>
  );
}

function DeleteErrorAlert({ error }: { readonly error: ProgramDeleteError }) {
  if (error.kind === 'generic') {
    return (
      <Alert variant="destructive">
        <AlertTitle>삭제 실패</AlertTitle>
        <AlertDescription>{error.message}</AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert variant="destructive">
      <AlertTitle>삭제할 수 없습니다</AlertTitle>
      <AlertDescription>
        <p>연결된 데이터를 먼저 정리하거나 전체 삭제를 진행해 주세요.</p>
        <p className="flex flex-wrap gap-x-1 gap-y-1">
          {error.items.map((item, index) => (
            <span key={item.label}>
              {index > 0 ? ' · ' : null}
              <Link href={item.href}>
                {item.label} {item.count}
                {item.unit}
              </Link>
            </span>
          ))}
        </p>
      </AlertDescription>
    </Alert>
  );
}

function formatDeletedCounts(counts: ProgramPurgeDeletedCounts): string {
  const items = (Object.entries(counts) as [string, number][])
    .filter(([, count]) => count > 0)
    .map(([key, count]) => `${PURGE_COUNT_LABELS[key] ?? key} ${count}건`);
  return items.join(' · ') || '연결된 데이터가 없었습니다.';
}

function purgeErrorMessage(reason: unknown): string {
  if (reason instanceof ApiError) {
    return reason.problem.detail || '프로그램 전체를 삭제하지 못했습니다.';
  }
  return '프로그램 전체를 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}
