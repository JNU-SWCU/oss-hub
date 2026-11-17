import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROGRAM_ORGANIZER_MESSAGES } from '../program-contract';
import { ProgramOrganizerField } from './program-organizer-field';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

function Harness({
  initial,
  onChange,
}: {
  readonly initial: readonly string[];
  readonly onChange: (next: string[]) => void;
}) {
  const [value, setValue] = useState<readonly string[]>(initial);
  return (
    <ProgramOrganizerField
      id="organizers"
      value={value}
      onChange={(next) => {
        onChange(next);
        setValue(next);
      }}
    />
  );
}

describe('ProgramOrganizerField', () => {
  let container: HTMLDivElement;
  let root: Root;
  const onChange = vi.fn<(next: string[]) => void>();

  beforeEach(() => {
    onChange.mockReset();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  function input(): HTMLInputElement {
    const element = container.querySelector<HTMLInputElement>('#organizers');
    if (element === null) throw new TypeError('Missing organizer input.');
    return element;
  }

  function chips(): readonly string[] {
    return [...container.querySelectorAll('li > span')].map(
      (chip) => chip.textContent ?? '',
    );
  }

  async function render(initial: readonly string[]) {
    await act(async () =>
      root.render(<Harness initial={initial} onChange={onChange} />),
    );
  }

  async function type(text: string) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    );
    await act(async () => {
      setter?.set?.call(input(), text);
      input().dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  async function press(key: string, init: KeyboardEventInit = {}) {
    await act(async () =>
      input().dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, ...init }),
      ),
    );
  }

  async function paste(text: string): Promise<ClipboardEvent> {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', text);
    const event = new ClipboardEvent('paste', {
      clipboardData,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => input().dispatchEvent(event));
    return event;
  }

  function description(): string {
    return (
      container.querySelector('#organizers-description')?.textContent ?? ''
    );
  }

  it('adds the trimmed text as a label on Enter without submitting', async () => {
    await render(['전남대학교 SW중심대학사업단']);
    await type('  OSS Hub 운영팀  ');
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    await act(async () => input().dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    expect(chips()).toEqual(['전남대학교 SW중심대학사업단', 'OSS Hub 운영팀']);
    expect(input().value).toBe('');
    expect(onChange).toHaveBeenLastCalledWith([
      '전남대학교 SW중심대학사업단',
      'OSS Hub 운영팀',
    ]);
  });

  it('ignores Enter while a Korean IME composition is still open', async () => {
    await render([]);
    await type('운영');
    await press('Enter', { isComposing: true });

    expect(chips()).toEqual([]);
    expect(input().value).toBe('운영');
    expect(onChange).not.toHaveBeenCalled();

    await type('운영팀');
    await press('Enter');
    expect(chips()).toEqual(['운영팀']);
  });

  it('adds a label on comma and splits pasted comma lists', async () => {
    await render([]);
    await type('학과');
    await press(',');
    expect(chips()).toEqual(['학과']);
    expect(input().value).toBe('');

    await type('연구실, 센터,남은 글');
    expect(chips()).toEqual(['학과', '연구실', '센터']);
    expect(input().value).toBe('남은 글');
  });

  it('ignores duplicates and whitespace-only labels', async () => {
    await render(['학과']);
    await type('학과');
    await press('Enter');
    await type('   ');
    await press('Enter');

    expect(chips()).toEqual(['학과']);
    expect(input().value).toBe('');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('removes a label from its × button and the last label with Backspace on an empty input', async () => {
    await render(['학과', '센터', '연구실']);
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="센터 삭제"]')
        ?.click(),
    );
    expect(chips()).toEqual(['학과', '연구실']);

    await press('Backspace');
    expect(chips()).toEqual(['학과']);

    await type('남');
    await press('Backspace');
    expect(chips()).toEqual(['학과']);
    expect(onChange).toHaveBeenLastCalledWith(['학과']);
  });

  it('commits uncommitted text on blur', async () => {
    await render([]);
    await type('센터');
    await act(async () =>
      input().dispatchEvent(new FocusEvent('focusout', { bubbles: true })),
    );

    expect(chips()).toEqual(['센터']);
    expect(input().value).toBe('');
  });

  it('stops adding at 10 labels and keeps the rejected text in the input', async () => {
    const ten = Array.from({ length: 10 }, (_, index) => `기관 ${index + 1}`);
    await render(ten);
    await type('열한 번째');
    await press('Enter');

    expect(chips()).toEqual(ten);
    expect(input().value).toBe('열한 번째');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('caps each label at 50 characters', async () => {
    await render([]);
    await type('가'.repeat(51));
    await press('Enter');

    expect(chips()).toEqual(['가'.repeat(50)]);
    expect(input().maxLength).toBe(50);

    const single = await paste('나'.repeat(60));
    expect(single.defaultPrevented).toBe(false);
    expect(chips()).toEqual(['가'.repeat(50)]);
  });

  it('splits a long pasted list into labels before capping each at 50 characters', async () => {
    await render(['학과']);
    const event = await paste(`A기관, ${'가'.repeat(60)},,   ,B기관`);

    expect(event.defaultPrevented).toBe(true);
    expect(chips()).toEqual(['학과', 'A기관', '가'.repeat(50), 'B기관']);
    expect(input().value).toBe('');
    expect(onChange).toHaveBeenLastCalledWith([
      '학과',
      'A기관',
      '가'.repeat(50),
      'B기관',
    ]);
  });

  it('keeps pasted labels past the cap in the input until a label is removed', async () => {
    const nine = Array.from({ length: 9 }, (_, index) => `기관 ${index + 1}`);
    await render(nine);
    await paste('열 번째, 열한 번째, 열두 번째');

    expect(chips()).toEqual([...nine, '열 번째']);
    expect(input().value).toBe('열한 번째, 열두 번째');
    expect(description()).toBe(PROGRAM_ORGANIZER_MESSAGES.tooMany);

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="기관 1 삭제"]')
        ?.click(),
    );
    await press('Enter');

    expect(chips()).toEqual([...nine.slice(1), '열 번째', '열한 번째']);
    expect(input().value).toBe('열두 번째');
    expect(description()).toBe(PROGRAM_ORGANIZER_MESSAGES.tooMany);
  });

  it('keeps a comma-separated input past the cap instead of dropping it', async () => {
    const ten = Array.from({ length: 10 }, (_, index) => `기관 ${index + 1}`);
    await render(ten);
    await type('열한 번째, 열두 번째,남은 글');

    expect(chips()).toEqual(ten);
    expect(input().value).toBe('열한 번째, 열두 번째, 남은 글');
    expect(onChange).not.toHaveBeenCalled();
    expect(description()).toBe(PROGRAM_ORGANIZER_MESSAGES.tooMany);
  });

  it('focuses the input when the box around the labels is clicked, but not from a remove button', async () => {
    await render(['학과', '센터']);
    const box = input().parentElement;
    if (box === null) throw new TypeError('Missing organizer box.');
    expect(document.activeElement).not.toBe(input());

    await act(async () => box.click());
    expect(document.activeElement).toBe(input());

    await act(async () => input().blur());
    await act(async () =>
      container.querySelector<HTMLElement>('li > span')?.click(),
    );
    expect(document.activeElement).toBe(input());

    await act(async () => input().blur());
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="센터 삭제"]')
        ?.click(),
    );
    expect(chips()).toEqual(['학과']);
    expect(document.activeElement).not.toBe(input());
  });

  it('shows the add hint only to screen readers, then shows the limit message and stops inviting more labels', async () => {
    const nine = Array.from({ length: 9 }, (_, index) => `기관 ${index + 1}`);
    await render(nine);
    const hint = container.querySelector('#organizers-description');
    expect(hint?.classList.contains('sr-only')).toBe(true);
    expect(description()).not.toBe('');
    expect(description()).not.toBe(PROGRAM_ORGANIZER_MESSAGES.tooMany);
    expect(input().placeholder).not.toBe('');

    await type('열 번째');
    await press('Enter');

    const limit = container.querySelector('#organizers-description');
    expect(limit?.classList.contains('sr-only')).toBe(false);
    expect(description()).toBe(PROGRAM_ORGANIZER_MESSAGES.tooMany);
    expect(input().placeholder).toBe('');
  });

  it('marks the input invalid and announces the error next to it', async () => {
    await act(async () =>
      root.render(
        <ProgramOrganizerField
          id="organizers"
          value={[]}
          error="주관기관을 1개 이상 입력해 주세요."
          onChange={onChange}
        />,
      ),
    );

    expect(input().getAttribute('aria-invalid')).toBe('true');
    expect(input().getAttribute('aria-describedby')).toBe(
      'organizers-description organizers-error',
    );
    expect(container.querySelector('#organizers-error')?.textContent).toBe(
      '주관기관을 1개 이상 입력해 주세요.',
    );
  });
});
