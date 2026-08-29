// @vitest-environment happy-dom

import { act, useReducer, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { completedAuthoringState } from './program-creation-test-fixtures';
import {
  programAuthoringReducer,
  type ProgramAuthoringMilestone,
  type ProgramAuthoringState,
} from './program-authoring-model';
import { ProgramAuthoringMilestoneStep } from './program-authoring-milestone-step';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

function MilestoneStepHarness({
  initial,
  onState,
  onFiles,
}: {
  readonly initial: ProgramAuthoringState;
  readonly onState: (state: ProgramAuthoringState) => void;
  readonly onFiles: (files: Map<string, File>) => void;
}) {
  const [state, dispatch] = useReducer(programAuthoringReducer, initial);
  const files = useRef(new Map<string, File>());
  const snapshots = useRef(new Map<string, Map<string, File>>());
  const id = useRef(0);
  onState(state);
  onFiles(files.current);

  const removeMilestone = (milestoneId: string) => {
    const milestone = state.milestones.find(({ id }) => id === milestoneId);
    for (const requirement of milestone?.requirements ?? [])
      files.current.delete(requirement.id);
    dispatch({ type: 'remove_milestone', milestoneId });
  };

  return (
    <ProgramAuthoringMilestoneStep
      state={state}
      issues={[]}
      dispatch={dispatch}
      newId={() => `test-${++id.current}`}
      onRequirementFileChange={(milestoneId, requirementId, file) => {
        if (file === null) files.current.delete(requirementId);
        else files.current.set(requirementId, file);
        dispatch({
          type: 'set_requirement_file',
          milestoneId,
          requirementId,
          file:
            file === null
              ? null
              : { name: file.name, size: file.size, type: file.type },
        });
      }}
      onRequirementRemove={(milestoneId, requirementId) => {
        files.current.delete(requirementId);
        dispatch({ type: 'remove_requirement', milestoneId, requirementId });
      }}
      onMilestoneEditStart={(milestone) => {
        snapshots.current.set(
          milestone.id,
          new Map(
            milestone.requirements.flatMap((requirement) => {
              const file = files.current.get(requirement.id);
              return file ? [[requirement.id, file] as const] : [];
            }),
          ),
        );
      }}
      onMilestoneSave={(milestoneId) => {
        snapshots.current.delete(milestoneId);
      }}
      onMilestoneCancel={(milestoneId, snapshot) => {
        if (snapshot === null) {
          removeMilestone(milestoneId);
          return;
        }
        const current = state.milestones.find(({ id }) => id === milestoneId);
        for (const requirement of current?.requirements ?? [])
          files.current.delete(requirement.id);
        for (const [requirementId, file] of snapshots.current.get(
          milestoneId,
        ) ?? [])
          files.current.set(requirementId, file);
        snapshots.current.delete(milestoneId);
      }}
    />
  );
}

describe('ProgramAuthoringMilestoneStep', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body
      .querySelectorAll('[data-radix-portal]')
      .forEach((portal) => portal.remove());
  });

  async function render(initial = completedAuthoringState()) {
    let latest = initial;
    let files = new Map<string, File>();
    await act(async () => {
      root.render(
        <MilestoneStepHarness
          initial={initial}
          onState={(state) => {
            latest = state;
          }}
          onFiles={(next) => {
            files = next;
          }}
        />,
      );
    });
    return { latest: () => latest, files: () => files };
  }

  function button(text: string, scope: ParentNode = document.body) {
    const element = [...scope.querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.trim() === text,
    );
    if (element === undefined) throw new TypeError(`Missing ${text} button.`);
    return element;
  }

  function input(selector: string, scope: ParentNode = document.body) {
    const element = scope.querySelector<HTMLInputElement>(selector);
    if (element === null) throw new TypeError(`Missing ${selector}.`);
    return element;
  }

  function dialog() {
    const element = document.body.querySelector<HTMLElement>('[role="dialog"]');
    if (element === null) throw new TypeError('Missing milestone dialog.');
    return element;
  }

  async function change(
    element: HTMLInputElement | HTMLTextAreaElement,
    value: string,
  ) {
    const prototype =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(
      element,
      value,
    );
    await act(async () => {
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  async function selectFile(element: HTMLInputElement, file: File) {
    Object.defineProperty(element, 'files', {
      configurable: true,
      value: [file],
    });
    await act(async () => {
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  async function addBlankDraft() {
    await act(async () => button('마일스톤 추가', container).click());
  }

  async function fillDraft(name = '중간 점검') {
    await change(input('[aria-label="시작일"]'), '2026-09-03');
    await change(input('[aria-label="마감일"]'), '2026-09-05');
    await change(input('#test-1-name'), name);
  }

  it('renders the empty staff calendar state without old submission terminology', async () => {
    const completed = completedAuthoringState();
    await render({ ...completed, milestones: [] });

    expect(container.textContent).toContain('마일스톤 일정');
    expect(container.textContent).toContain('추가된 마일스톤이 없습니다.');
    expect(document.body.textContent).not.toContain('제출 항목');
    expect(document.body.textContent).not.toContain('제출 항목 이름');
    expect(document.body.textContent).not.toContain('학생에게 보여줄 안내');
  });

  it('opens a prefilled add dialog after directly selecting two calendar dates', async () => {
    const view = await render();

    await act(async () =>
      input('[data-calendar-date="2026-09-03"]', container).click(),
    );
    await act(async () =>
      input('[data-calendar-date="2026-09-05"]', container).click(),
    );

    expect(document.body.textContent).toContain('마일스톤 추가');
    expect(view.latest().milestones[1]).toMatchObject({
      id: 'test-1',
      startAt: '2026-09-03T00:00',
      dueAt: '2026-09-05T23:59',
    });
    expect(input('[aria-label="시작일"]').min).toBe('2026-09-02');
    expect(input('[aria-label="마감일"]').max).toBe('2026-09-30');
  });

  it('opens the header add dialog with a blank draft', async () => {
    const view = await render();
    await addBlankDraft();

    expect(document.body.textContent).toContain('마일스톤 추가');
    expect(view.latest().milestones[1]).toMatchObject({
      name: '',
      startAt: '',
      dueAt: '',
      instructions: '',
      requirements: [],
    });
  });

  it('keeps invalid drafts open and displays local field errors', async () => {
    await render();
    await addBlankDraft();
    await act(async () => button('저장').click());

    expect(document.body.textContent).toContain(
      '마일스톤 이름을 입력해 주세요.',
    );
    expect(document.body.textContent).toContain('기간을 입력해 주세요.');
    expect(document.body.textContent).toContain('마일스톤 추가');
  });

  it('saves a valid zero-attachment draft and immediately shows it in the calendar and list', async () => {
    const view = await render();
    await addBlankDraft();
    await fillDraft();
    await act(async () => button('저장').click());

    expect(view.latest().milestones[1]).toMatchObject({
      name: '중간 점검',
      startAt: '2026-09-03T00:00',
      dueAt: '2026-09-05T23:59',
      requirements: [],
    });
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).toContain('중간 점검');
    expect(
      container.querySelector('[aria-label="마일스톤 날짜 선택 달력"]')
        ?.textContent,
    ).toContain('중간 점검');
  });

  it('derives an attachment name from a valid PDF, exposes compact attachment controls, and removes the last attachment', async () => {
    const view = await render();
    await addBlankDraft();
    const pdf = new File(['pdf'], 'guide.pdf', { type: 'application/pdf' });
    await selectFile(input('input[type="file"]'), pdf);

    expect(view.latest().milestones[1]?.requirements[0]).toMatchObject({
      id: 'test-2',
      name: 'guide.pdf',
      required: true,
    });
    expect(document.body.textContent).toContain('필수 제출');
    expect(document.body.textContent).not.toContain('제출 항목');
    expect(
      [...dialog().querySelectorAll('button')].map((item) =>
        item.textContent?.trim(),
      ),
    ).not.toContain('파일 재업로드');
    expect(
      dialog().querySelector('[aria-label="제출물 이름 수정"]'),
    ).not.toBeNull();
    expect(
      dialog().querySelector('[aria-label="첨부파일 재업로드"]'),
    ).not.toBeNull();
    expect(
      dialog().querySelector('[aria-label="첨부파일 삭제"]'),
    ).not.toBeNull();
    const replacement = new File(['new'], 'updated.pdf', {
      type: 'application/pdf',
    });
    await act(async () =>
      dialog()
        .querySelector<HTMLButtonElement>('[aria-label="제출물 이름 수정"]')!
        .click(),
    );
    await change(input('[aria-label="파일 제출물 이름"]'), '최종 결과물');
    await act(async () =>
      dialog()
        .querySelector<HTMLButtonElement>('[aria-label="제출물 이름 저장"]')!
        .click(),
    );
    await selectFile(
      input('input[aria-label="첨부파일 재업로드"]'),
      replacement,
    );
    expect(view.latest().milestones[1]?.requirements[0]?.name).toBe(
      '최종 결과물',
    );
    expect(
      view.latest().milestones[1]?.requirements[0]?.templateFile?.name,
    ).toBe('updated.pdf');
    expect(view.files().get('test-2')).toBe(replacement);
    const required = input('input[type="checkbox"]');
    await act(async () => required.click());
    expect(view.latest().milestones[1]?.requirements[0]?.required).toBe(false);

    await act(async () =>
      dialog()
        .querySelector<HTMLButtonElement>('[aria-label="첨부파일 삭제"]')!
        .click(),
    );
    expect(view.latest().milestones[1]?.requirements).toEqual([]);
    expect(view.files().has('test-2')).toBe(false);
  });

  it('persists keyboard attachment reordering and disables the only handle', async () => {
    const view = await render();
    await addBlankDraft();
    await selectFile(
      input('[aria-label="첨부파일 추가"]'),
      new File(['first'], 'first.pdf', { type: 'application/pdf' }),
    );

    const onlyHandle = dialog().querySelector<HTMLButtonElement>(
      '[aria-label="first.pdf 순서 이동"]',
    );
    expect(onlyHandle?.disabled).toBe(true);

    await selectFile(
      input('[aria-label="첨부파일 추가"]'),
      new File(['second'], 'second.pdf', { type: 'application/pdf' }),
    );
    const firstHandle = dialog().querySelector<HTMLButtonElement>(
      '[aria-label="first.pdf 순서 이동"]',
    );
    expect(firstHandle?.disabled).toBe(false);

    await act(async () => {
      firstHandle?.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }),
      );
    });
    await act(async () => {
      firstHandle?.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }),
      );
    });
    await act(async () => {
      firstHandle?.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }),
      );
    });

    expect(
      view.latest().milestones[1]?.requirements.map(({ id }) => id),
    ).toEqual(['test-3', 'test-2']);
    expect(
      [...dialog().querySelectorAll('[data-sortable-document-id]')].map((row) =>
        row.getAttribute('data-sortable-document-id'),
      ),
    ).toEqual(['test-3', 'test-2']);
  });

  it('visibly rejects unsupported and oversized attachments', async () => {
    await render();
    await addBlankDraft();
    const fileInput = input('input[type="file"]');

    await selectFile(
      fileInput,
      new File(['text'], 'guide.txt', { type: 'text/plain' }),
    );
    expect(document.body.textContent).toContain(
      'PDF, HWP, JPG, PNG, ZIP 파일만 선택할 수 있습니다.',
    );

    await selectFile(
      fileInput,
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.pdf', {
        type: 'application/pdf',
      }),
    );
    expect(document.body.textContent).toContain('파일은 5MiB 이하여야 합니다.');
  });

  it('cancelling a new draft removes its requirement file and milestone', async () => {
    const view = await render();
    await addBlankDraft();
    await selectFile(
      input('input[type="file"]'),
      new File(['pdf'], 'draft.pdf', { type: 'application/pdf' }),
    );
    expect(view.files().has('test-2')).toBe(true);

    await act(async () => button('취소').click());
    expect(view.latest().milestones).toHaveLength(1);
    expect(view.files().has('test-2')).toBe(false);
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it('cancelling an existing edit restores milestone fields and attachment files', async () => {
    const existingFile = new File(['old'], 'original.pdf', {
      type: 'application/pdf',
    });
    const original = milestoneWithRequirement();
    const initial = {
      ...completedAuthoringState(),
      milestones: [original],
    };
    const view = await render(initial);
    view.files().set('requirement-1', existingFile);

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="원래 이름 수정"]')!
        .click(),
    );
    await change(input('#milestone-1-name'), '변경된 이름');
    await change(input('[aria-label="시작일"]'), '2026-09-04');
    await change(
      document.body.querySelector<HTMLTextAreaElement>('#milestone-1-notice')!,
      '변경된 공지',
    );
    await act(async () =>
      dialog()
        .querySelector<HTMLButtonElement>('[aria-label="첨부파일 삭제"]')!
        .click(),
    );
    await act(async () => button('취소').click());

    expect(view.latest().milestones[0]).toEqual(original);
    expect(view.files().get('requirement-1')).toBe(existingFile);
  });

  it('persists an existing edit on save', async () => {
    const view = await render();
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="오리엔테이션 수정"]')!
        .click(),
    );
    await change(input('#milestone-1-name'), '최종 오리엔테이션');
    await act(async () => button('저장').click());

    expect(view.latest().milestones[0]?.name).toBe('최종 오리엔테이션');
    expect(container.textContent).toContain('최종 오리엔테이션');
    expect(document.body.textContent).not.toContain('마일스톤 수정');
  });
});

function milestoneWithRequirement(): ProgramAuthoringMilestone {
  return {
    id: 'milestone-1',
    name: '원래 이름',
    startAt: '2026-09-02T00:00',
    dueAt: '2026-09-10T23:59',
    instructions: '원래 공지',
    requirements: [
      {
        id: 'requirement-1',
        name: 'original.pdf',
        required: true,
        templateFile: {
          name: 'original.pdf',
          size: 3,
          type: 'application/pdf',
          requiresReselection: false,
        },
      },
    ],
  };
}
