'use client';

import { Download, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PageBody } from '@/components/page-body';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ProgramDocumentArchiveOptions } from './program-document-archive-options';
import { ApiError } from '@/lib/api-client';
import { getProgramDetail, listStaffProgramTeams } from './api';
import {
  downloadProgramDocumentArchive,
  type ProgramDocumentArchiveGrouping,
  type ProgramDocumentArchiveScope,
} from './program-document-archive-api';
import type { ProgramDetail, StaffProgramTeam } from './types';

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | {
      readonly kind: 'ready';
      readonly program: ProgramDetail;
      readonly teams: readonly StaffProgramTeam[];
    };

export function ProgramDocumentArchivePanel({
  programId,
  initialMilestoneId,
}: {
  readonly programId: string;
  readonly initialMilestoneId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' });
  const [retry, setRetry] = useState(0);
  const [kind, setKind] = useState<ProgramDocumentArchiveScope['kind']>(
    initialMilestoneId ? 'MILESTONE' : 'PROGRAM',
  );
  const [milestoneId, setMilestoneId] = useState(initialMilestoneId ?? '');
  const [teamId, setTeamId] = useState('');
  const [grouping, setGrouping] =
    useState<ProgramDocumentArchiveGrouping>('TEAM');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoadState({ kind: 'loading' });
    void Promise.all([
      getProgramDetail(programId),
      listStaffProgramTeams(programId),
    ])
      .then(([program, teams]) => {
        if (active) setLoadState({ kind: 'ready', program, teams });
      })
      .catch((cause: unknown) => {
        if (active)
          setLoadState({
            kind: 'error',
            message:
              cause instanceof ApiError
                ? cause.problem.detail
                : '다운로드 범위를 불러오지 못했습니다.',
          });
      });
    return () => {
      active = false;
    };
  }, [programId, open, retry]);

  const selectedMilestone =
    loadState.kind === 'ready'
      ? milestoneId === ''
        ? loadState.program.milestones[0]
        : loadState.program.milestones.find((item) => item.id === milestoneId)
      : undefined;
  const selectedTeam =
    loadState.kind === 'ready'
      ? teamId === ''
        ? loadState.teams[0]
        : loadState.teams.find((item) => item.teamId === teamId)
      : undefined;
  const scope: ProgramDocumentArchiveScope | null =
    kind === 'PROGRAM'
      ? { kind }
      : kind === 'MILESTONE'
        ? selectedMilestone
          ? { kind, milestoneId: selectedMilestone.id }
          : null
        : selectedTeam
          ? { kind, teamId: selectedTeam.teamId }
          : null;

  function clearFeedback() {
    setError(null);
    setNotice(null);
  }

  async function download() {
    if (scope === null || busy || loadState.kind !== 'ready') return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const file = await downloadProgramDocumentArchive(
        programId,
        scope,
        grouping,
      );
      const url = URL.createObjectURL(file.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.fileName;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice(
        'ZIP 파일을 준비했습니다. 브라우저의 다운로드 목록에서 확인해 주세요.',
      );
    } catch (cause: unknown) {
      setError(
        cause instanceof ApiError
          ? cause.problem.detail
          : 'ZIP 파일을 내려받지 못했습니다. 선택한 범위를 확인한 뒤 다시 시도해 주세요.',
      );
    } finally {
      setBusy(false);
    }
  }

  const toggleLabel = open ? '다운로드 범위 닫기' : '제출 자료 ZIP 내려받기';

  return (
    <PageBody className="pb-0">
      <section
        aria-label="제출 자료 ZIP 내려받기"
        data-testid="program-document-archive"
        className="grid gap-4"
      >
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            aria-label={toggleLabel}
            aria-expanded={open}
            aria-controls="program-document-archive-options"
            onClick={() => setOpen(!open)}
            disabled={busy}
          >
            {open ? <X aria-hidden="true" /> : <Download aria-hidden="true" />}
            {toggleLabel}
          </Button>
        </div>
        {open ? (
          <div
            id="program-document-archive-options"
            className="grid min-w-0 gap-4 rounded-card border border-border p-4"
          >
            <h2 className="text-lg font-semibold">다운로드 범위</h2>
            <p className="break-keep text-small text-muted-foreground">
              목록의 검색·필터와 별개로 지정합니다. 승인된 신청의 현재 제출
              자료를 받습니다.
            </p>
            {loadState.kind === 'loading' ? (
              <p role="status">범위를 불러오는 중…</p>
            ) : loadState.kind === 'error' ? (
              <Alert variant="destructive">
                <AlertDescription>
                  {loadState.message}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setRetry(retry + 1)}
                  >
                    다시 시도
                  </Button>
                </AlertDescription>
              </Alert>
            ) : (
              <>
                <ProgramDocumentArchiveOptions
                  program={loadState.program}
                  teams={loadState.teams}
                  kind={kind}
                  grouping={grouping}
                  selectedMilestone={selectedMilestone}
                  selectedTeam={selectedTeam}
                  busy={busy}
                  onKindChange={(value) => {
                    setKind(value);
                    clearFeedback();
                  }}
                  onMilestoneChange={(value) => {
                    setMilestoneId(value);
                    clearFeedback();
                  }}
                  onTeamChange={(value) => {
                    setTeamId(value);
                    clearFeedback();
                  }}
                  onGroupingChange={(value) => {
                    setGrouping(value);
                    clearFeedback();
                  }}
                />
                {error === null ? null : (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                {notice === null ? null : (
                  <p role="status" className="text-small">
                    {notice}
                  </p>
                )}
                <div className="flex justify-end">
                  <Button
                    type="button"
                    disabled={busy || scope === null}
                    onClick={() => void download()}
                  >
                    <Download aria-hidden="true" />
                    {busy ? 'ZIP 준비 중…' : 'ZIP 내려받기'}
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : null}
      </section>
    </PageBody>
  );
}
