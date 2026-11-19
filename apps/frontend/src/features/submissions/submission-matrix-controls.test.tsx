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
  } finally {
    act(() => root.unmount());
  }
});
