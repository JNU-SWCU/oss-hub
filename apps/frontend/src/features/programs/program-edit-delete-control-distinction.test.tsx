// @vitest-environment happy-dom

/**
 * 프로그램 편집 화면에는 삭제가 둘 있다 — 마일스톤 하나를 지우는 것과, 프로그램
 * 전체를 지우는 것. 둘의 결과가 전혀 다르다. 마일스톤 삭제는 그 단계와 딸린 서류
 * 항목·양식 파일이 사라지는 일이고, 「위험 영역」의 프로그램 영구 삭제는 신청서·팀·
 * 제출물까지 프로그램에 매달린 모든 것이 사라지는 일이다.
 *
 * 그래서 이 둘은 한 화면에 같이 서 있는 동안 이름이 서로 달라야 한다. 지금은
 * 마일스톤 줄이 아이콘 버튼이고 그 접근 가능한 이름이 「{마일스톤 이름} 삭제」라서
 * 위험 영역의 「프로그램 영구 삭제」와 헷갈리지 않는다. 누군가 "아이콘만 있으니 무슨
 * 버튼인지 모르겠다"며 마일스톤 줄에 그냥 「삭제」를 붙이면, 교직원 화면에 「삭제」와
 * 「프로그램 영구 삭제」가 나란히 서고 어느 쪽이 프로그램을 통째로 날리는 버튼인지
 * 이름만으로는 알 수 없게 된다. 눈으로 보는 사람보다 화면 낭독기를 쓰는 사람이 먼저
 * 다친다 — 낭독기는 버튼 목록을 이름으로만 읽어 주기 때문이다.
 *
 * 그 되돌아감을 아무도 못 잡는 것은 아니었다. program-edit-view.test.tsx와
 * program-authoring-milestone-step.test.tsx가 `aria-label="기획서 제출 삭제"`라는
 * 글자를 그대로 박아 두고 있어, 이 이름을 건드리면 어느 쪽으로 건드리든 깨진다.
 * 문제는 그 둘이 「이 글자여야 한다」만 말하고 「왜」를 말하지 않는다는 것이다 —
 * 위험한 되돌아감(「삭제」)과 아무 문제 없는 개명(「단계 삭제」)을 똑같이 실패로
 * 다루니, 실패를 본 사람은 규칙을 배우는 대신 박아 둔 글자를 새 이름으로 고쳐 넣게
 * 되고, 그 손질은 위험한 쪽에도 똑같이 통한다. 이 시험은 그 자리에 글자 대신 규칙을
 * 둔다.
 *
 * 이 시험이 지키는 것은 「이름이 서로 달라 구별된다」이지 「아이콘이어야 한다」가
 * 아니다. 마일스톤 줄 이름을 나중에 「단계 삭제」 같은 다른 글자로 바꾸는 것은
 * 얼마든지 좋다 — 그래서 이 시험은 어떤 이름이어야 하는지를 못박지 않고, 두 이름을
 * 화면에서 직접 읽어 서로 견주기만 한다.
 *
 * 두 컨트롤을 찾을 때도 이름을 쓰지 않는다. 마일스톤 줄 컨트롤은 눌러서 삭제 요청이
 * 나가는 버튼으로 찾고(행동으로 식별), 위험 영역 컨트롤은 「위험 영역」 섹션 머리
 * 아래에 있는 버튼으로 찾는다(자리로 식별). 이름으로 찾으면 이름을 바꾸는 순간
 * 시험이 통과도 실패도 아닌 "못 찾음"으로 무너져 목적을 잃는다.
 *
 * 층은 ProgramEditView 다 — 마일스톤 줄과 위험 영역을 한 번에 그리는 가장 낮은 층이
 * 여기다. 마일스톤만 그리는 ProgramEditMilestones 에서는 위험 영역이 함께 그려지지
 * 않아 두 이름을 견줄 수 없다.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditableProgram } from './api';
import { toProgramEditForm } from './program-edit-flow';
import { ProgramEditView } from './program-edit-view';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

const noOp = () => undefined;

const program: EditableProgram = {
  id: 'program-1',
  name: 'OSS 경진대회',
  organizer: 'SW중심대학사업단',
  trackType: 'EXTRACURRICULAR',
  lifecycle: 'PUBLISHED',
  applicationTemplateKey: 'oss-contest',
  applicationTemplateVersion: 1,
  applicationCount: 3,
  applicationStartAt: '2026-08-01T09:30:59.000Z',
  applicationEndAt: '2026-08-15T09:30:59.000Z',
  startAt: '2026-08-16T09:30:59.000Z',
  endAt: '2026-08-31T09:30:59.000Z',
  repositoryProvisioningEnabled: true,
  notifyOnDeadline: true,
  description: '프로그램 설명',
  teamMinSize: 2,
  teamMaxSize: 4,
  milestones: [
    {
      id: 'milestone-canonical-id',
      name: '기획서 제출',
      startAt: '2026-08-16T09:30:59.000Z',
      dueAt: '2026-08-20T12:30:59.000Z',
      submissionType: 'TEXT',
      instructions: null,
    },
  ],
};

/** 「위험 영역」 섹션의 머리. 컨트롤 이름이 아니라 자리를 가리키는 표지다. */
const DANGER_ZONE_HEADING = '위험 영역';

/**
 * 보조기술이 버튼 이름으로 읽는 값. 아이콘 버튼은 보이는 글자가 없으므로
 * `aria-label`이 곧 이름이고, 글자 버튼은 그 글자가 이름이다. 계산 순서는 접근성
 * 이름 규칙과 같다 — `aria-labelledby` → `aria-label` → 버튼 안의 글자.
 */
function accessibleName(control: HTMLElement): string {
  const labelledBy = control.getAttribute('aria-labelledby');
  const referenced =
    labelledBy === null
      ? null
      : document.getElementById(labelledBy)?.textContent;
  const raw =
    referenced ??
    control.getAttribute('aria-label') ??
    control.textContent ??
    '';
  return raw.replace(/\s+/gu, ' ').trim();
}

describe('프로그램 편집 화면의 두 삭제 컨트롤', () => {
  let container: HTMLDivElement;
  let root: Root;
  let onRequestDeleteMilestone: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    onRequestDeleteMilestone = vi.fn();
    act(() => {
      root.render(
        <ProgramEditView
          program={program}
          form={toProgramEditForm(program)}
          errors={{}}
          toastMessage={null}
          generalAlert={null}
          isSaving={false}
          milestoneEditor={{ mode: 'closed' }}
          deleteTarget={null}
          isMilestoneBusy={false}
          // 제출 항목을 미리 넘겨 준다 — 넘기지 않으면 카드가 스스로 서버에 물어보러
          // 나가고, 이 시험이 볼 것은 버튼 이름뿐이라 그 왕복이 필요 없다.
          canonicalDocumentsByMilestoneId={
            new Map([[program.milestones[0]!.id, []]])
          }
          isLifecycleBusy={false}
          isLifecycleConfirming={false}
          lifecycleError={null}
          // 삭제 권한이 있는 교직원만 위험 영역을 본다(#1095). 두 삭제가 한 화면에
          // 같이 서는 것은 이때뿐이라, 헷갈릴 수 있는 상황도 이때뿐이다.
          canDeleteProgram
          onFieldChange={noOp}
          onSubmit={noOp}
          onRequestLifecycleToggle={noOp}
          onCancelLifecycleToggle={noOp}
          onConfirmLifecycleToggle={noOp}
          onAddMilestone={noOp}
          onEditMilestone={noOp}
          onCancelMilestone={noOp}
          onMilestoneFieldChange={noOp}
          onSaveMilestone={noOp}
          onRequestDeleteMilestone={onRequestDeleteMilestone}
          onCancelDelete={noOp}
          onConfirmDelete={noOp}
        />,
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  /**
   * 마일스톤 카드 안의 버튼을 하나씩 눌러 보고, 삭제 요청이 나가는 버튼을 고른다.
   * 이름을 보지 않으므로 이름이 바뀌어도 계속 찾아낸다.
   */
  function milestoneDeleteControl(): HTMLElement {
    const card = document.querySelector(
      `[data-canonical-id="${program.milestones[0]!.id}"]`,
    );
    if (card === null) throw new TypeError('마일스톤 카드를 찾지 못했습니다.');
    for (const candidate of card.querySelectorAll('button')) {
      onRequestDeleteMilestone.mockClear();
      act(() => candidate.click());
      if (onRequestDeleteMilestone.mock.calls.length > 0) return candidate;
    }
    throw new TypeError('마일스톤 줄에서 삭제 컨트롤을 찾지 못했습니다.');
  }

  /** 「위험 영역」 머리가 달린 섹션 안의 버튼. 여기 있는 버튼은 프로그램 영구 삭제 하나다. */
  function programDeleteControl(): HTMLElement {
    const heading = Array.from(document.querySelectorAll('h2')).find(
      (candidate) => candidate.textContent?.trim() === DANGER_ZONE_HEADING,
    );
    const section = heading?.closest('section') ?? null;
    if (section === null)
      throw new TypeError('「위험 영역」 섹션을 찾지 못했습니다.');
    const controls = Array.from(section.querySelectorAll('button'));
    if (controls.length !== 1) {
      throw new TypeError(
        `「위험 영역」의 버튼이 하나가 아닙니다(${controls.length}개) — 이 시험이 어느 것을 견줘야 하는지 다시 정해야 합니다.`,
      );
    }
    return controls[0]!;
  }

  it('마일스톤 삭제와 프로그램 영구 삭제는 이름으로 구별된다', () => {
    // Given / When — 교직원이 프로그램 편집 화면을 열었을 때 실제로 그려지는 두 버튼.
    const programDeleteName = accessibleName(programDeleteControl());
    const milestoneDeleteName = accessibleName(milestoneDeleteControl());

    // Then — (가) 위험 영역 컨트롤은 「삭제」라고 말한다. 이 화면에서 그 낱말의 주인이다.
    expect(programDeleteName).toContain('삭제');

    // (나) 마일스톤 줄 컨트롤의 이름은 그것과 같지 않다.
    expect(milestoneDeleteName).not.toBe(programDeleteName);

    // (나-계속) 같지 않기만 해서는 부족하다. 위험 영역 이름에서 무엇을 지우는지를 떼고
    // 남는 행동어(여기서는 「삭제」)만으로 된 이름은, 옆에 놓인 프로그램 영구 삭제와
    // 무엇이 다른지를 말하지 않는다. 마일스톤 줄 컨트롤은 그보다 더 말해야 한다.
    // 한계: 위험 영역 이름이 나중에 띄어쓰기 없는 한 낱말(예: 「영구삭제」)이 되면
    // 행동어가 곧 이름 전체라서 이 단언이 바로 위 (나)와 같아진다 — 그때는 이 시험이
    // 조용히 약해지므로, 위험 영역 이름을 고치는 사람이 여기도 함께 봐야 한다.
    const actionWord = programDeleteName.split(' ').at(-1) ?? programDeleteName;
    expect(milestoneDeleteName).not.toBe(actionWord);
  });
});
