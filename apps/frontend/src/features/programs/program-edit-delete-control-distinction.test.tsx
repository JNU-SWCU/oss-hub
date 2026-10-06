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

const DANGER_ZONE_HEADING = '위험 영역';

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
          onCoverChange={() => undefined}
          program={program}
          form={toProgramEditForm(program)}
          errors={{}}
          toastMessage={null}
          generalAlert={null}
          isSaving={false}
          milestoneEditor={{ mode: 'closed' }}
          deleteTarget={null}
          isMilestoneBusy={false}

          canonicalDocumentsByMilestoneId={
            new Map([['milestone-canonical-id', []]])
          }

          canDeleteProgram
          onFieldChange={noOp}
          onSubmit={noOp}
          onProgramDeleted={noOp}
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

  function milestoneDeleteControl(): HTMLElement {
    const card = document.querySelector(
      `[data-canonical-id="${'milestone-canonical-id'}"]`,
    );
    if (card === null) throw new TypeError('마일스톤 카드를 찾지 못했습니다.');
    for (const candidate of card.querySelectorAll('button')) {
      onRequestDeleteMilestone.mockClear();
      act(() => candidate.click());
      if (onRequestDeleteMilestone.mock.calls.length > 0) return candidate;
    }
    throw new TypeError('마일스톤 줄에서 삭제 컨트롤을 찾지 못했습니다.');
  }

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
    const control = controls[0];
    if (!control) throw new TypeError('프로그램 삭제 버튼을 찾지 못했습니다.');
    return control;
  }

  it('마일스톤 삭제와 프로그램 삭제는 이름으로 구별된다', () => {
    const programDeleteName = accessibleName(programDeleteControl());
    const milestoneDeleteName = accessibleName(milestoneDeleteControl());

    expect(milestoneDeleteName).not.toBe('');

    expect(programDeleteName).toContain('삭제');

    expect(milestoneDeleteName).not.toBe(programDeleteName);

    const actionWord = programDeleteName.split(' ').at(-1) ?? programDeleteName;
    expect(milestoneDeleteName).not.toBe(actionWord);
  });
});
