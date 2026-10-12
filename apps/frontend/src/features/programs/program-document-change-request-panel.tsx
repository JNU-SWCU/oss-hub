'use client';

import { RotateCcw } from 'lucide-react';
import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { DialogShell } from '@/components';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api-client';
import { listStaffProgramTeams } from './api';
import {
  MILESTONE_DOCUMENT_REVIEW_COMMENT_MAX_LENGTH,
  MILESTONE_DOCUMENT_REVIEW_ERROR_CODES,
} from './milestone-document-review-api';
import {
  milestoneDocumentResubmissionDueAtError,
  milestoneDocumentResubmissionDueAtPayload,
} from './milestone-document-review';
import {
  changeRequestTargetCount,
  createProgramDocumentChangeRequest,
  getProgramDocumentChangeRequestTargets,
  type ProgramDocumentChangeRequestScope,
  type ProgramDocumentChangeRequestTargets,
} from './program-document-change-request-api';
import type { StaffProgramTeam } from './types';

type TargetsState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | {
      readonly kind: 'ready';
      readonly targets: ProgramDocumentChangeRequestTargets;
    };

type Notice =
  | { readonly kind: 'sent'; readonly count: number }
  | { readonly kind: 'changed' }
  | { readonly kind: 'error'; readonly message: string };

function targetBreakdown(
  targets: ProgramDocumentChangeRequestTargets,
  includeFinalDecisions: boolean,
): string {
  const parts: [string, number][] = [
    ['검토 대기', targets.submitted],
    ['보완 요청 중', targets.changesRequested],
  ];
  if (includeFinalDecisions) {
    parts.push(['승인', targets.approved], ['반려', targets.rejected]);
  }
  return parts
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${label} ${count}건`)
    .join(' · ');
}

export function ProgramDocumentChangeRequestPanel({
  programId,
  onSent,
}: {
  readonly programId: string;
  readonly onSent: () => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
      >
        <RotateCcw aria-hidden="true" />
        보완 요청 보내기
      </Button>
      {open ? (
        <ChangeRequestDialog
          programId={programId}
          returnFocusRef={triggerRef}
          onSent={onSent}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function ChangeRequestDialog({
  programId,
  returnFocusRef,
  onSent,
  onClose,
}: {
  readonly programId: string;
  readonly returnFocusRef: RefObject<HTMLButtonElement | null>;
  readonly onSent: () => void;
  readonly onClose: () => void;
}) {
  const id = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [teams, setTeams] = useState<readonly StaffProgramTeam[] | null>(null);
  const [kind, setKind] =
    useState<ProgramDocumentChangeRequestScope['kind']>('PROGRAM');
  const [teamId, setTeamId] = useState('');
  const [includeFinalDecisions, setIncludeFinalDecisions] = useState(false);
  const [comment, setComment] = useState('');
  const [resubmissionDueAt, setResubmissionDueAt] = useState('');
  const [targets, setTargets] = useState<TargetsState>({ kind: 'idle' });
  const [reload, setReload] = useState(0);
  const [errors, setErrors] = useState<{
    readonly comment: string | null;
    readonly resubmissionDueAt: string | null;
  }>({ comment: null, resubmissionDueAt: null });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const scope: ProgramDocumentChangeRequestScope | null =
    kind === 'PROGRAM' ? { kind } : teamId === '' ? null : { kind, teamId };
  const sent = notice?.kind === 'sent';

  useEffect(() => {
    let active = true;
    listStaffProgramTeams(programId)
      .then((loaded) => {
        if (active) setTeams(loaded);
      })
      .catch(() => {
        if (active) setTeams([]);
      });
    return () => {
      active = false;
    };
  }, [programId]);

  useEffect(() => {
    if (kind === 'TEAM' && teamId === '') {
      setTargets({ kind: 'idle' });
      return;
    }
    let active = true;
    setTargets({ kind: 'loading' });
    getProgramDocumentChangeRequestTargets(
      programId,
      kind === 'PROGRAM' ? { kind } : { kind, teamId },
    )
      .then((loaded) => {
        if (active) setTargets({ kind: 'ready', targets: loaded });
      })
      .catch((cause: unknown) => {
        if (active)
          setTargets({
            kind: 'error',
            message:
              cause instanceof ApiError
                ? cause.problem.detail
                : '보낼 제출 수를 불러오지 못했습니다. 다시 시도해 주세요.',
          });
      });
    return () => {
      active = false;
    };
  }, [programId, kind, teamId, reload]);

  useEffect(() => {
    if (sent) closeRef.current?.focus();
  }, [sent]);

  const count =
    targets.kind === 'ready'
      ? changeRequestTargetCount(targets.targets, includeFinalDecisions)
      : 0;
  const excluded =
    targets.kind === 'ready' && !includeFinalDecisions
      ? targets.targets.approved + targets.targets.rejected
      : 0;

  async function send() {
    const nextErrors = {
      comment: comment.trim() === '' ? '보완 요청 사유를 입력해 주세요.' : null,
      resubmissionDueAt: milestoneDocumentResubmissionDueAtError(
        'CHANGES_REQUESTED',
        resubmissionDueAt,
      ),
    };
    setErrors(nextErrors);
    setNotice(null);
    if (nextErrors.comment !== null) {
      document.getElementById(`${id}-comment`)?.focus();
      return;
    }
    if (nextErrors.resubmissionDueAt !== null) {
      document.getElementById(`${id}-due`)?.focus();
      return;
    }
    const dueAt = milestoneDocumentResubmissionDueAtPayload(
      'CHANGES_REQUESTED',
      resubmissionDueAt,
    );
    if (scope === null || dueAt === undefined || busy) return;
    setBusy(true);
    try {
      const result = await createProgramDocumentChangeRequest(programId, {
        scope,
        includeFinalDecisions,
        comment: comment.trim(),
        resubmissionDueAt: dueAt,
        expectedCount: count,
      });
      setNotice({ kind: 'sent', count: result.requestedCount });
      onSent();
    } catch (cause: unknown) {
      setNotice(
        cause instanceof ApiError &&
          cause.problem.code ===
            MILESTONE_DOCUMENT_REVIEW_ERROR_CODES.REVIEW_TARGET_CHANGED
          ? { kind: 'changed' }
          : {
              kind: 'error',
              message:
                cause instanceof ApiError
                  ? cause.problem.detail
                  : '보완 요청을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.',
            },
      );
      setReload((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogShell
      kind="alert"
      title="보완 요청 보내기"
      description={
        sent
          ? null
          : '고른 범위의 서류 제출을 다시 받습니다. 이전 제출과 판정은 이력에 남습니다.'
      }
      busy={busy}
      returnFocusRef={returnFocusRef}
      onCancel={onClose}
      footer={
        sent ? (
          <Button ref={closeRef} type="button" onClick={onClose}>
            닫기
          </Button>
        ) : (
          <>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              취소
            </Button>
            <Button
              type="button"
              disabled={busy || targets.kind !== 'ready' || count === 0}
              onClick={() => void send()}
            >
              {busy
                ? '보내는 중…'
                : count > 0
                  ? `${count}건 보완 요청 보내기`
                  : '보완 요청 보내기'}
            </Button>
          </>
        )
      }
    >
      {notice?.kind === 'sent' ? (
        <Alert role="status">
          <AlertDescription>
            제출 {notice.count}건에 보완 요청을 보냈습니다.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <FieldSet className="gap-2" disabled={busy}>
            <FieldLegend variant="label">범위</FieldLegend>
            <div className="flex flex-wrap gap-x-4">
              {(
                [
                  ['PROGRAM', '이 프로그램 전체'],
                  ['TEAM', '팀 하나'],
                ] as const
              ).map(([value, label]) => (
                <label
                  key={value}
                  className="flex min-h-11 items-center gap-2 text-small"
                >
                  <input
                    type="radio"
                    name={`${id}-scope`}
                    value={value}
                    checked={kind === value}
                    onChange={() => {
                      setKind(value);
                      setNotice(null);
                    }}
                  />
                  {label}
                </label>
              ))}
            </div>
            {kind === 'TEAM' ? (
              <Field>
                <FieldLabel htmlFor={`${id}-team`}>팀</FieldLabel>
                <Select
                  id={`${id}-team`}
                  value={teamId}
                  disabled={teams === null}
                  onChange={(event) => {
                    setTeamId(event.target.value);
                    setNotice(null);
                  }}
                >
                  <option value="">
                    {teams === null
                      ? '팀 목록을 불러오는 중…'
                      : teams.length === 0
                        ? '팀 없음'
                        : '팀을 선택해 주세요'}
                  </option>
                  {(teams ?? []).map((team) => (
                    <option key={team.teamId} value={team.teamId}>
                      {team.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <label className="flex min-h-11 items-center gap-2 text-small">
              <input
                type="checkbox"
                checked={includeFinalDecisions}
                onChange={(event) => {
                  setIncludeFinalDecisions(event.target.checked);
                  setNotice(null);
                }}
              />
              이미 승인·반려한 제출도 포함
            </label>
            <div
              className="grid gap-1 rounded-control bg-muted p-4 text-small"
              data-testid="program-document-change-request-targets"
              role="status"
            >
              {scope === null ? (
                <p>팀을 선택하면 보낼 제출 수를 보여 줍니다.</p>
              ) : targets.kind === 'ready' ? (
                count === 0 ? (
                  <p>이 범위에는 보완 요청을 보낼 제출이 없습니다.</p>
                ) : (
                  <>
                    <p>
                      {targetBreakdown(targets.targets, includeFinalDecisions)}
                    </p>
                    {excluded > 0 ? (
                      <p className="text-muted-foreground">
                        승인·반려한 {excluded}건은 빠집니다.
                      </p>
                    ) : null}
                  </>
                )
              ) : targets.kind === 'error' ? (
                <p>{targets.message}</p>
              ) : (
                <p>보낼 제출 수를 세는 중…</p>
              )}
            </div>
            {targets.kind === 'error' ? (
              <Button
                type="button"
                variant="outline"
                className="justify-self-start"
                onClick={() => setReload((value) => value + 1)}
              >
                다시 세기
              </Button>
            ) : null}
          </FieldSet>
          <Field>
            <FieldLabel htmlFor={`${id}-comment`}>사유</FieldLabel>
            <Textarea
              id={`${id}-comment`}
              value={comment}
              maxLength={MILESTONE_DOCUMENT_REVIEW_COMMENT_MAX_LENGTH}
              disabled={busy}
              aria-invalid={errors.comment !== null}
              aria-describedby={`${id}-comment-description${errors.comment === null ? '' : ` ${id}-comment-error`}`}
              onChange={(event) => setComment(event.target.value)}
            />
            <FieldDescription id={`${id}-comment-description`}>
              학생에게 그대로 보입니다 · 최대 2,000자
            </FieldDescription>
            {errors.comment === null ? null : (
              <FieldError id={`${id}-comment-error`}>
                {errors.comment}
              </FieldError>
            )}
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-due`}>재제출 기한</FieldLabel>
            <Input
              id={`${id}-due`}
              type="datetime-local"
              value={resubmissionDueAt}
              disabled={busy}
              aria-invalid={errors.resubmissionDueAt !== null}
              aria-describedby={`${id}-due-description${errors.resubmissionDueAt === null ? '' : ` ${id}-due-error`}`}
              onChange={(event) => setResubmissionDueAt(event.target.value)}
            />
            <FieldDescription id={`${id}-due-description`}>
              학생은 이 시각까지 다시 낼 수 있습니다 · 마감이 지난 단계라면 이
              기한 안에 한 번 다시 낼 수 있습니다
            </FieldDescription>
            {errors.resubmissionDueAt === null ? null : (
              <FieldError id={`${id}-due-error`}>
                {errors.resubmissionDueAt}
              </FieldError>
            )}
          </Field>
          {notice?.kind === 'changed' ? (
            <Alert role="status">
              <AlertDescription className="break-keep">
                그사이 제출이나 판정이 바뀌어 보낼 제출 수를 다시 셌습니다.
                건수를 확인한 뒤 다시 보내 주세요.
              </AlertDescription>
            </Alert>
          ) : notice?.kind === 'error' ? (
            <Alert variant="destructive">
              <AlertDescription className="break-keep">
                {notice.message}
              </AlertDescription>
            </Alert>
          ) : null}
        </>
      )}
    </DialogShell>
  );
}
