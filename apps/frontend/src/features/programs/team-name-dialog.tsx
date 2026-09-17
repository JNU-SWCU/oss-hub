'use client';

import { useState, type ReactElement, type RefObject } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Field, FieldError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api-client';
import { renameProgramTeam } from './api';
import { ProgramAuthoringDialog } from './program-authoring-dialog';

/** 백엔드 `RenameTeamRequestDto`의 `@MaxLength(100)`과 같은 값이어야 한다. */
const TEAM_NAME_MAX_LENGTH = 100;

/**
 * 팀 이름 변경 창.
 *
 * 껍데기는 이 폴더가 이미 쓰는 `ProgramAuthoringDialog`다 — 제목·본문·취소/저장
 * 줄·`busy` 동안 닫기 차단·초점 복귀가 전부 그 안에 있다. 창을 손으로 다시 짜면
 * 같은 일을 하는 두 번째 관행이 생긴다.
 *
 * 입력칸에 보이는 라벨을 두지 않는다 — 창 제목이 「팀 이름 변경」이고 칸이 하나뿐이라,
 * 라벨은 제목이 이미 말한 것을 한 번 더 말하는 자리가 된다. 읽어 주는 도구를 위한
 * 이름은 `aria-label`로 남긴다(`program-schedule-range-dialog`가 칸마다 `aria-label`을
 * 두는 것과 같은 규칙).
 *
 * 저장은 이 창이 직접 한다. 부르는 화면은 창을 열고 닫는 것과 **바뀐 이름을 화면에
 * 반영하는 일**만 맡는다.
 */
export function TeamNameDialog({
  programId,
  teamId,
  currentName,
  returnFocusRef,
  onRenamed,
  onCancel,
}: {
  readonly programId: string;
  readonly teamId: string;
  readonly currentName: string;
  /** 창을 연 버튼. 닫을 때 그리로 초점을 돌려준다. */
  readonly returnFocusRef: RefObject<HTMLElement | null>;
  readonly onRenamed: (name: string) => void;
  readonly onCancel: () => void;
}): ReactElement {
  const [draft, setDraft] = useState(currentName);
  const [busy, setBusy] = useState(false);
  /**
   * 「저장」을 누른 적이 있는가. 입력 규칙은 누르기 전에 붉게 굴지 않는다 —
   * 일정 창(`program-schedule-range-dialog`)이 쓰는 것과 같은 방식이다.
   */
  const [attempted, setAttempted] = useState(false);
  /**
   * 저장 실패는 창 **안에서** 말한다. 화면 위쪽 알림에 그리면 이 창 뒤에 가려
   * 아무 일도 안 일어난 것처럼 보인다.
   */
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const trimmed = draft.trim();
  const emptyError = trimmed === '' ? '팀 이름을 입력해 주세요.' : null;

  async function save(): Promise<void> {
    if (busy) return;
    setAttempted(true);
    if (emptyError !== null) return;
    /*
     * 같은 이름은 바꿀 것이 없다. 요청을 보내지 않고 창만 닫는다 — 백엔드도
     * 같은 이름에는 쓰기도 감사도 남기지 않으므로 둘의 판단이 같다.
     */
    if (trimmed === currentName) {
      onCancel();
      return;
    }
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
    <ProgramAuthoringDialog
      title="팀 이름 변경"
      busy={busy}
      returnFocusRef={returnFocusRef}
      onCancel={onCancel}
      onSave={() => void save()}
    >
      <Field>
        <Input
          aria-label="팀 이름"
          value={draft}
          disabled={busy}
          maxLength={TEAM_NAME_MAX_LENGTH}
          aria-invalid={attempted && emptyError !== null}
          aria-describedby={
            attempted && emptyError !== null ? 'team-name-error' : undefined
          }
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // 칸이 하나라 Enter로 끝낼 수 있어야 한다 — 폼이 없으니 여기서 받는다.
            if (event.key !== 'Enter') return;
            event.preventDefault();
            void save();
          }}
        />
        <FieldError id="team-name-error">
          {attempted ? emptyError : null}
        </FieldError>
      </Field>
      {errorMessage !== null ? (
        <Alert variant="destructive">
          <AlertTitle>저장하지 못했습니다</AlertTitle>
          <AlertDescription className="[word-break:keep-all]">
            {errorMessage}
          </AlertDescription>
        </Alert>
      ) : null}
    </ProgramAuthoringDialog>
  );
}
