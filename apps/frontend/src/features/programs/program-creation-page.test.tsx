// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { completedAuthoringState } from './program-creation-test-fixtures';
import {
  PROGRAM_AUTHORING_RECOVERY_KEY,
  loadProgramAuthoringRecoveryKey,
} from './program-authoring-storage';

const mocks = vi.hoisted(() => ({
  createAuthoringProgram: vi.fn(),
  deleteAuthoringUpload: vi.fn(),
  uploadAuthoringFile: vi.fn(),
  getAuthoringUploadPolicy: vi.fn(),
  completeAndNavigate: vi.fn(),
  useProgramExitGuard: vi.fn(),
  previewProgramNotice: vi.fn(),
  discardUnsaved: undefined as (() => void) | undefined,
}));

vi.mock('./program-notice-api', () => ({
  previewProgramNotice: mocks.previewProgramNotice,
}));

vi.mock('./program-authoring-api', () => ({
  uploadProgramCover: vi.fn(),
  createAuthoringProgram: mocks.createAuthoringProgram,
  deleteAuthoringUpload: mocks.deleteAuthoringUpload,
  uploadAuthoringFile: mocks.uploadAuthoringFile,
  getAuthoringUploadPolicy: mocks.getAuthoringUploadPolicy,
}));

vi.mock('./use-program-exit-guard', () => ({
  useProgramExitGuard: (dirty: boolean, discardUnsaved: () => void) => {
    mocks.useProgramExitGuard(dirty);
    mocks.discardUnsaved = discardUnsaved;
    return {
      completeAndNavigate: mocks.completeAndNavigate,
    };
  },
}));

import { ProgramCreationPage } from './program-creation-page';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

function setFieldValue(selector: string, value: string): void {
  const field = document.querySelector<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >(selector);
  if (field === null) throw new TypeError(`Missing field ${selector}`);
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : field instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(field, value);
  field.dispatchEvent(
    new Event(field instanceof HTMLSelectElement ? 'change' : 'input', {
      bubbles: true,
    }),
  );
}

function buttonNamed(name: string): HTMLButtonElement {
  const button = [...document.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(name),
  );
  if (button === undefined) throw new TypeError(`button not found: ${name}`);
  return button;
}

describe('ProgramCreationPage guided authoring', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    sessionStorage.clear();
    mocks.createAuthoringProgram.mockReset();
    mocks.deleteAuthoringUpload.mockReset();
    mocks.uploadAuthoringFile.mockReset();
    mocks.getAuthoringUploadPolicy.mockReset().mockResolvedValue({
      fileUpload: { maxBytes: 5 * 1024 * 1024, maxLabel: '5 MB' },
    });
    mocks.completeAndNavigate.mockClear();
    mocks.useProgramExitGuard.mockClear();
    mocks.discardUnsaved = undefined;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('renders all five Korean steps without draft controls or restoration copy', async () => {
    sessionStorage.setItem(
      'oss-hub:program-authoring',
      JSON.stringify(completedAuthoringState()),
    );

    await act(async () => root.render(<ProgramCreationPage />));

    for (const label of [
      '기본 정보',
      '신청/운영 일정',
      '마일스톤',
      '운영 설정',
      '최종 검토',
    ]) {
      expect(container.textContent).toContain(label);
    }
    expect(container.querySelector('[aria-label="작성 단계"]')).not.toBeNull();
    expect(
      container.querySelector('[aria-label="작성 진행률"]'),
    ).not.toBeNull();
    expect(container.textContent).not.toContain('임시 저장');
    expect(container.textContent).not.toContain('저장하고 계속');
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(mocks.createAuthoringProgram).not.toHaveBeenCalled();
    expect(mocks.uploadAuthoringFile).not.toHaveBeenCalled();
  });

  it.each([
    new TypeError('policy unavailable'),
    new SyntaxError('invalid JSON'),
  ])(
    '업로드 제한을 못 받으면 작성 대신 재시도를 보이고 복구한다: %s',
    async (error) => {
      mocks.getAuthoringUploadPolicy.mockRejectedValueOnce(error);
      await act(async () => root.render(<ProgramCreationPage />));
      expect(container.textContent).toContain(
        '파일 업로드 제한을 불러오지 못했습니다.',
      );
      expect(container.querySelector('input[type="file"]')).toBeNull();
      await act(async () => buttonNamed('다시 불러오기').click());
      expect(container.textContent).toContain('기본 정보');
      expect(mocks.getAuthoringUploadPolicy).toHaveBeenCalledTimes(2);
    },
  );

  it('does not mutate programs until final confirmation and clears recovery after success', async () => {
    mocks.createAuthoringProgram.mockResolvedValue({ id: 'program-created' });
    sessionStorage.setItem(PROGRAM_AUTHORING_RECOVERY_KEY, 'request-recovery');

    await act(async () => {
      root.render(
        <ProgramCreationPage initialState={completedAuthoringState()} />,
      );
      await Promise.resolve();
    });

    await act(async () => buttonNamed('프로그램 만들기').click());

    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(mocks.createAuthoringProgram).not.toHaveBeenCalled();

    await act(async () => {
      buttonNamed('생성 확정').click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.createAuthoringProgram).toHaveBeenCalledTimes(1);
    expect(mocks.createAuthoringProgram).toHaveBeenCalledWith(
      expect.anything(),
      'request-recovery',
    );
    expect(sessionStorage.getItem(PROGRAM_AUTHORING_RECOVERY_KEY)).toBeNull();
    expect(mocks.completeAndNavigate).toHaveBeenCalledWith(
      '/programs/program-created',
    );
  });

  it('keeps an untouched form clean when navigating between steps', async () => {
    await act(async () => root.render(<ProgramCreationPage />));

    await act(async () => buttonNamed('기본 정보').click());

    expect(mocks.useProgramExitGuard).toHaveBeenLastCalledWith(false);
    mocks.discardUnsaved?.();
    expect(sessionStorage.getItem(PROGRAM_AUTHORING_RECOVERY_KEY)).toBeNull();
  });

  it('applies a notice to editable fields and only persists its external cover after final confirmation', async () => {
    const sourceUrl = 'https://sojoong.kr/notice/?uid=42&mod=document';
    const imageUrl = 'https://sojoong.kr/wp-content/uploads/poster.jpg';
    const description = '합성 프로그램 안내\n\n운영 일정\n- 합성 활동';
    mocks.previewProgramNotice.mockResolvedValueOnce({
      sourceUrl,
      name: '가져온 합성 프로그램',
      description,
      coverImages: [imageUrl],
      warnings: [],
    });
    mocks.createAuthoringProgram.mockResolvedValueOnce({
      id: 'notice-created',
    });
    const initial = {
      ...completedAuthoringState(),
      currentStep: 'basic' as const,
    };
    await act(async () =>
      root.render(<ProgramCreationPage initialState={initial} />),
    );
    await act(async () => buttonNamed('공지에서 가져오기').click());
    const url = document.querySelector<HTMLInputElement>('input[type="url"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set?.call(url, sourceUrl);
      url?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => buttonNamed('불러오기').click());
    await act(async () =>
      document
        .querySelector<HTMLInputElement>('input[name="notice-description"]')
        ?.click(),
    );
    await act(async () => buttonNamed('선택한 내용 적용').click());
    expect(container.querySelector('textarea')?.value).toBe(description);
    expect(
      container
        .querySelector('[data-slot="program-cover-preview"] img')
        ?.getAttribute('src'),
    ).toBe(imageUrl);
    expect(mocks.createAuthoringProgram).not.toHaveBeenCalled();
    await act(async () => buttonNamed('최종 검토').click());
    expect(container.textContent).toContain('공지에서 가져온 이미지');
    await act(async () => buttonNamed('프로그램 만들기').click());
    expect(mocks.createAuthoringProgram).not.toHaveBeenCalled();
    await act(async () => buttonNamed('생성 확정').click());
    const sent = mocks.createAuthoringProgram.mock.calls[0]?.[0];
    expect(sent).toMatchObject({
      name: initial.name,
      description,
      externalCover: { sourceUrl, imageUrl },
    });
    expect(sent).not.toHaveProperty('coverUploadId');
    expect(sent.milestones).toHaveLength(initial.milestones.length);
  });

  it('필드 오류가 둘 이상이면 칸 옆 오류와 함께 맨 위에 개수만 한 줄로 알린다(R-16)', async () => {
    await act(async () => root.render(<ProgramCreationPage />));
    await act(async () => buttonNamed('기본 정보').click());
    await act(async () => buttonNamed('계속').click());

    expect(container.textContent).toContain('주관기관을 입력해 주세요.');
    const summary = container.querySelector('[data-slot="form-error-summary"]');
    // 빈 기본 정보의 오류는 프로그램명·주관기관·교과/비교과·소개 넷이다.
    expect(summary?.textContent).toBe('고칠 칸이 4개 있습니다');
    // 요약은 칸 옆 문구를 다시 적지 않는다(R-16) — 옛 목록형 요약도 돌아오지 않는다.
    expect(summary?.textContent).not.toContain('주관기관을 입력해 주세요.');
    expect(container.textContent).not.toContain('입력 내용을 확인해 주세요');
    expect(container.textContent).not.toContain('표시된 입력란을 고친 뒤');
    // 요약은 칸들보다 앞에 서고, 포커스는 가져가지 않는다 — 커서는 첫 오류 칸에 있다.
    const html = container.innerHTML;
    expect(html.indexOf('data-slot="form-error-summary"')).toBeLessThan(
      html.indexOf('id="program-name"'),
    );
    expect(document.activeElement?.id).toBe('program-name');
  });

  it('최종 검토에서 돌아와도 요약은 지금 단계 화면에 보이는 오류 줄 수만 센다', async () => {
    await act(async () => root.render(<ProgramCreationPage />));
    // 빈 상태로 최종 검토에서 만들기를 누르면 모든 단계의 오류가 한꺼번에
    // 모이고 첫 오류 단계(기본 정보)로 돌아온다.
    await act(async () => buttonNamed('최종 검토').click());
    await act(async () => buttonNamed('프로그램 만들기').click());

    const summary = container.querySelector('[data-slot="form-error-summary"]');
    const visible = container.querySelectorAll('[data-slot="field-error"]');
    expect(visible.length).toBe(4);
    expect(summary?.textContent).toBe(`고칠 칸이 ${visible.length}개 있습니다`);
  });

  it('대표 이미지 칸이 스스로 띄운 파일 오류도 한 줄로 센다', async () => {
    await act(async () => root.render(<ProgramCreationPage />));
    await act(async () => buttonNamed('기본 정보').click());
    const input = container.querySelector<HTMLInputElement>(
      '[data-slot="program-cover-field"] input[type="file"]',
    );
    if (input === null) throw new TypeError('Missing cover file input.');
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['gif'], 'poster.gif', { type: 'image/gif' })],
    });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => buttonNamed('계속').click());

    const visible = container.querySelectorAll('[data-slot="field-error"]');
    // 필수값 넷 + 이미지 형식 오류 하나. 이미지 오류는 페이지의 오류 목록에 없다.
    expect(visible.length).toBe(5);
    expect(
      container.querySelector('[data-slot="form-error-summary"]')?.textContent,
    ).toBe('고칠 칸이 5개 있습니다');
  });

  it('일정 단계는 시작·종료를 기간 한 줄로 세어 요약한다', async () => {
    await act(async () => root.render(<ProgramCreationPage />));
    await act(async () => buttonNamed('기본 정보').click());
    await act(async () => {
      setFieldValue('#program-name', '요약 확인 프로그램');
      setFieldValue('#authoring-organizer', '요약 확인 학과');
      setFieldValue('#program-track-type', 'EXTRACURRICULAR');
      setFieldValue('#program-description', '요약 확인 소개');
    });
    // 기본 정보가 채워졌으므로 첫 오류 단계는 일정이다.
    await act(async () => buttonNamed('최종 검토').click());
    await act(async () => buttonNamed('프로그램 만들기').click());

    const summary = container.querySelector('[data-slot="form-error-summary"]');
    const visible = container.querySelectorAll('[data-slot="field-error"]');
    // 신청·운영 시작과 종료가 모두 비어 오류 경로는 넷이지만 보이는 줄은 둘이다.
    expect(visible.length).toBe(2);
    expect(summary?.textContent).toBe('고칠 칸이 2개 있습니다');
  });

  it('navigates without persisting dirty form content', async () => {
    await act(async () => root.render(<ProgramCreationPage />));
    await act(async () => buttonNamed('기본 정보').click());

    const name = container.querySelector<HTMLInputElement>('#program-name');
    if (name === null) throw new TypeError('Missing program name input.');
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set;
    await act(async () => {
      setter?.call(name, '계속 작성할 프로그램');
      name.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => buttonNamed('계속').click());

    expect(container.textContent).toContain('신청/운영 일정');
    expect(sessionStorage.getItem(PROGRAM_AUTHORING_RECOVERY_KEY)).toBeNull();
    expect(mocks.useProgramExitGuard).toHaveBeenLastCalledWith(true);
  });

  it('마일스톤 단계에서 잘못된 날짜를 막고 편집 팝업을 연다', async () => {
    const completed = completedAuthoringState();
    await act(async () => {
      root.render(
        <ProgramCreationPage
          initialState={{
            ...completed,
            currentStep: 'milestones',
            milestones: [
              {
                ...completed.milestones[0],
                dueAt: '2026-10-01T18:00',
              },
            ],
          }}
        />,
      );
    });
    await act(async () => buttonNamed('계속').click());

    expect(document.body.textContent).toContain(
      '기간은 운영 기간 안에 있어야 합니다.',
    );
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.textContent).toContain('마일스톤 일정');
  });

  it('마일스톤 날짜가 비었으면 비활성 시각 입력 대신 날짜 달력으로 이동한다', async () => {
    const completed = completedAuthoringState();
    await act(async () => {
      root.render(
        <ProgramCreationPage
          initialState={{
            ...completed,
            currentStep: 'milestones',
            milestones: [
              {
                ...completed.milestones[0],
                startAt: '',
                dueAt: '',
              },
            ],
          }}
        />,
      );
    });

    await act(async () => buttonNamed('계속').click());

    expect(document.body.textContent).toContain('기간을 입력해 주세요.');
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.contains(document.activeElement)).toBe(true);
  });

  it('stores only a rotated recovery key after an idempotency conflict', async () => {
    const completed = completedAuthoringState();
    mocks.createAuthoringProgram.mockRejectedValue(
      new ApiError({
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        detail: '이미 사용한 요청입니다.',
        instance: '/programs',
        code: 'PRG_015',
      }),
    );
    await act(async () => {
      root.render(<ProgramCreationPage initialState={completed} />);
      await Promise.resolve();
    });
    await act(async () => buttonNamed('프로그램 만들기').click());
    await act(async () => {
      buttonNamed('생성 확정').click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const recoveryKey = loadProgramAuthoringRecoveryKey(sessionStorage);
    expect(recoveryKey).not.toBe(completed.idempotencyKey);
    expect(sessionStorage.getItem(PROGRAM_AUTHORING_RECOVERY_KEY)).toBe(
      recoveryKey,
    );
    expect(
      sessionStorage.getItem(PROGRAM_AUTHORING_RECOVERY_KEY),
    ).not.toContain('milestones');
    expect(mocks.useProgramExitGuard).toHaveBeenLastCalledWith(false);
    mocks.discardUnsaved?.();
    expect(sessionStorage.getItem(PROGRAM_AUTHORING_RECOVERY_KEY)).toBeNull();
  });

  it('최종 검토에서 날짜 오류를 발견하면 마일스톤 편집으로 돌아간다', async () => {
    const completed = completedAuthoringState();
    await act(async () => {
      root.render(
        <ProgramCreationPage
          initialState={{
            ...completed,
            milestones: [
              {
                ...completed.milestones[0],
                dueAt: '2026-10-01T18:00',
              },
            ],
          }}
        />,
      );
    });
    await act(async () => buttonNamed('프로그램 만들기').click());
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain(
        '기간은 운영 기간 안에 있어야 합니다.',
      ),
    );

    expect(container.textContent).toContain('마일스톤 일정');
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  });
});
