// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalMilestoneDocumentsEditor } from './milestone-document-editor';
import { toLocalMilestoneDocuments } from './milestone-document-editor-flow';
import { toMilestoneForm } from './program-edit-flow';
import { ProgramEditMilestoneScheduleEditor } from './program-edit-milestone-schedule-editor';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

describe('프로그램 편집의 초안 적용', () => {
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
    vi.restoreAllMocks();
  });

  it('마일스톤 날짜 입력은 날짜 적용으로 초안에만 반영한다', async () => {
    const onFieldChange = vi.fn();
    const form = toMilestoneForm({
      id: 'milestone-1',
      name: '기획서',
      startAt: '2026-09-10T00:00:00.000Z',
      dueAt: '2026-09-20T00:00:00.000Z',
      submissionType: 'TEXT',
      instructions: null,
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    await act(async () => {
      root.render(
        <ProgramEditMilestoneScheduleEditor
          editor={{ mode: 'edit', form, initialForm: form, errors: {} }}
          operationStartAt="2026-09-01T00:00"
          operationEndAt="2026-09-30T23:59"
          contextEvents={[]}
          onFieldChange={onFieldChange}
        />,
      );
    });
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[aria-label="기획서 일정 입력"]')
        ?.click();
    });
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain(
      '날짜를 적용한 뒤 마일스톤 저장을 눌러야 저장됩니다.',
    );
    const apply = [...(dialog?.querySelectorAll('button') ?? [])].find(
      (button) => button.textContent === '날짜 적용',
    );
    expect(apply).toBeDefined();
    expect(onFieldChange).not.toHaveBeenCalled();
    await act(async () => apply?.click());
    expect(onFieldChange).toHaveBeenCalledWith('startAt', form.startAt);
    expect(onFieldChange).toHaveBeenCalledWith('dueAt', form.dueAt);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('제출 항목 이름 적용은 편집을 끝내고 서버 저장 없이 다른 항목 편집을 이어간다', async () => {
    const documents = toLocalMilestoneDocuments(
      ['기획서', '결과물'].map((name, index) => ({
        id: `document-${index + 1}`,
        milestoneId: 'milestone-1',
        name,
        required: true,
        sortOrder: index + 1,
        hasTemplateFile: false,
        templateFileName: null,
      })),
    );
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    await act(async () => {
      root.render(
        <LocalMilestoneDocumentsEditor
          milestoneId="milestone-1"
          documents={documents}
          fileUpload={{
            maxBytes: 5242880,
            maxLabel: '5 MB',
            accept: '.pdf',
            formatLabel: 'PDF',
          }}
          onChange={vi.fn()}
        />,
      );
    });
    const firstItem = container.querySelector(
      '[aria-label="기획서 제출 항목"]',
    );
    await act(async () => {
      firstItem
        ?.querySelector<HTMLButtonElement>('[aria-label="제출물 이름 수정"]')
        ?.click();
    });
    const apply = firstItem?.querySelector<HTMLButtonElement>(
      '[aria-label="제출물 이름 적용"]',
    );
    expect(apply).not.toBeNull();
    await act(async () => apply?.click());
    expect(
      firstItem?.querySelector('[aria-label="파일 제출물 이름"]'),
    ).toBeNull();
    const secondItem = container.querySelector(
      '[aria-label="결과물 제출 항목"]',
    );
    await act(async () => {
      secondItem
        ?.querySelector<HTMLButtonElement>('[aria-label="제출물 이름 수정"]')
        ?.click();
    });
    expect(
      secondItem?.querySelector('[aria-label="파일 제출물 이름"]'),
    ).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
