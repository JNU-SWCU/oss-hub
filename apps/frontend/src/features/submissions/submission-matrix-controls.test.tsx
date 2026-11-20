import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { SubmissionStatusFilters } from './components/submission-matrix-controls';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

it('서버 상태 건수와 선택 상태를 표시하고 상태 선택 및 해제를 전달한다', () => {
  const container = document.createElement('div');
  const root = createRoot(container);
  const onStatusChange = vi.fn();

  try {
    act(() =>
      root.render(
        <SubmissionStatusFilters
          status="REJECTED"
          counts={{
            NOT_SUBMITTED: 4,
            SUBMITTED: 3,
            CHANGES_REQUESTED: 2,
            REJECTED: 0,
            APPROVED: 1,
          }}
          onStatusChange={onStatusChange}
        />,
      ),
    );

    const group = container.querySelector(
      '[role="group"][aria-label="제출 상태 필터"]',
    );
    const buttons = [...(group?.querySelectorAll('button') ?? [])];
    expect(buttons.map((button) => button.textContent)).toEqual([
      '전체 10',
      '미제출 4',
      '검토 대기 3',
      '보완 요청 2',
      '반려 0',
      '승인 1',
    ]);
    expect(group?.querySelector('[aria-pressed="true"]')?.textContent).toBe(
      '반려 0',
    );

    act(() => buttons[2].click());
    act(() => buttons[0].click());
    expect(onStatusChange.mock.calls).toEqual([['SUBMITTED'], [undefined]]);

    const select = container.querySelector('select');
    if (!select) throw new Error('Missing mobile status filter');
    expect(select.getAttribute('aria-label')).toBe('제출 상태 필터');
    expect(select.classList.contains('md:hidden')).toBe(true);
    expect(group?.classList.contains('hidden')).toBe(true);
    expect(group?.classList.contains('md:grid')).toBe(true);
    expect([...select.options].map((option) => option.textContent)).toEqual(
      buttons.map((button) => button.textContent),
    );
    expect(select.value).toBe('REJECTED');

    onStatusChange.mockClear();
    for (const value of ['SUBMITTED', '']) {
      act(() => {
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
    expect(onStatusChange.mock.calls).toEqual([['SUBMITTED'], [undefined]]);

    act(() =>
      root.render(<SubmissionStatusFilters onStatusChange={onStatusChange} />),
    );
    expect(select.value).toBe('');
    expect(select.selectedOptions[0].textContent).toBe('전체');
  } finally {
    act(() => root.unmount());
  }
});
