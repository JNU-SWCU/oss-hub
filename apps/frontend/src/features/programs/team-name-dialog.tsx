'use client';

import { AlertDialog } from 'radix-ui';
import { useState, type ReactElement } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api-client';
import { renameProgramTeam } from './api';

/** 백엔드 `RenameTeamRequestDto`의 `@MaxLength(100)`과 같은 값이어야 한다. */
const TEAM_NAME_MAX_LENGTH = 100;

/**
 * 팀 이름 변경 창. 팀명은 이 화면의 제목 그 자체라 창을 여는 자리도 제목 옆이다
 * (`ProgramStaffTeamDetailPage`).
 *
 * `Dialog`가 아니라 `AlertDialog`를 쓴다 — 이름을 고쳐 치고 있는 중에 바깥을 잘못
 * 누르면 적던 값이 사라진다. 판정 확인창(`application-decision-dialog`)이 사유 입력을
 * 같은 이유로 `AlertDialog`에 담았고, 이 창도 같은 규칙을 따른다.
 *
 * 저장은 이 창이 직접 한다. 부르는 화면은 창을 열고 닫는 것과 **바뀐 이름을 화면에
 * 반영하는 일**만 맡는다 — 성공 뒤에 할 일이 한 곳뿐이라 판정 창처럼 상태를 위로
 * 끌어올릴 이유가 없다.
 */
export function TeamNameDialog({
  programId,
  teamId,
  currentName,
  returnFocusId,
  onRenamed,
  onCancel,
}: {
  readonly programId: string;
  readonly teamId: string;
  readonly currentName: string;
  /** 창을 연 버튼의 id. 취소·Escape로 닫을 때 그리로 포커스를 돌려준다. */
  readonly returnFocusId: string;
  readonly onRenamed: (name: string) => void;
  readonly onCancel: () => void;
}): ReactElement {
  const [draft, setDraft] = useState(currentName);
  const [busy, setBusy] = useState(false);
  /**
   * 저장 실패는 창 **안에서** 말한다. 화면 위쪽 알림에 그리면 이 창 뒤에 가려
   * 아무 일도 안 일어난 것처럼 보인다(판정 확인창과 같은 규칙).
   */
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const trimmed = draft.trim();
  /*
   * 빈 이름은 백엔드가 400으로 거절하고, 같은 이름은 아무것도 바꾸지 않는다.
   * 둘 다 누르면 아무 일도 안 일어나는 버튼이라 아예 못 누르게 둔다 — 런타임
   * 상태를 추측해 숨기는 것이 아니라 지금 입력칸에 있는 값만 보는 판단이다.
   */
  const savable = trimmed !== '' && trimmed !== currentName;

  async function save(): Promise<void> {
    setBusy(true);
    setErrorMessage(null);
    try {
      const renamed = await renameProgramTeam(programId, teamId, trimmed);
      onRenamed(renamed.name);
    } catch (error: unknown) {
      setErrorMessage(
        error instanceof ApiError
          ? error.problem.detail
          : '팀 이름을 바꾸지 못했습니다.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog.Root
      open
      onOpenChange={(open) => {
        // 저장이 날아가는 중에는 닫지 않는다 — 닫히면 무엇이 저장됐는지 알 수 없다.
        if (!open && !busy) onCancel();
      }}
    >
      {/*
       * `Portal`을 쓴다 — 창이 페이지 DOM 안에 있으면 창이 열린 뒤에 삽입되는 형제
       * (예: 화면 위쪽 알림)가 Radix의 `aria-hidden` 밖에 남아 읽어 주는 도구가
       * 창 뒤 내용을 함께 훑는다. 형제 창들과 같은 규칙.
       */}
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-foreground/40" />
        <AlertDialog.Content
          /*
           * 설명 문단이 없는 입력 창이라 가리킬 설명도 없다. 판정 창의 반려 폼과 같은
           * 처리다 — 넘기지 않고 `undefined`로 끊어 Radix가 없는 id를 가리키지 않게 한다.
           */
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-xl bg-background p-6 shadow-lg outline-none *:min-w-0"
          onCloseAutoFocus={() => {
            document.getElementById(returnFocusId)?.focus();
          }}
        >
          <AlertDialog.Title asChild>
            <h2 className="text-lg font-semibold">팀 이름 변경</h2>
          </AlertDialog.Title>
          <form
            className="grid gap-2 text-sm"
            onSubmit={(event) => {
              event.preventDefault();
              if (!savable || busy) return;
              void save();
            }}
          >
            <label htmlFor="team-name">팀 이름</label>
            <Input
              id="team-name"
              value={draft}
              disabled={busy}
              maxLength={TEAM_NAME_MAX_LENGTH}
              onChange={(event) => setDraft(event.target.value)}
            />
            {errorMessage !== null ? (
              <Alert variant="destructive">
                <AlertTitle>저장하지 못했습니다</AlertTitle>
                <AlertDescription className="[word-break:keep-all]">
                  {errorMessage}
                </AlertDescription>
              </Alert>
            ) : null}
            <div className="flex justify-end gap-2">
              {/*
               * 저장 중에도 `disabled`로 막지 않는다 — 창 안 조작이 전부 disabled가 되면
               * 포커스가 창 밖으로 새어 읽어 주는 도구가 아무것도 못 읽는다. 실제로 닫는
               * 것은 위 `onOpenChange`의 `busy` 가드가 막는다.
               */}
              <AlertDialog.Cancel asChild>
                <Button
                  type="button"
                  variant="outline"
                  aria-disabled={busy || undefined}
                >
                  취소
                </Button>
              </AlertDialog.Cancel>
              <Button type="submit" disabled={!savable || busy}>
                {busy ? '저장 중…' : '저장'}
              </Button>
            </div>
          </form>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
