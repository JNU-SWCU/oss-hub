// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { MatrixQuickFilterButtons } from './components/submission-matrix-controls';

it('각 필터 그룹의 접근성 이름이 자기 화면 제목을 참조한다', () => {
  // Given
  const container = document.createElement('div');

  // When
  container.innerHTML = renderToStaticMarkup(
    <>
      {[0, 1].map((key) => (
        <MatrixQuickFilterButtons
          key={key}
          rows={[]}
          visibleMilestones={[]}
          quickFilter="ALL"
          onQuickFilterChange={vi.fn()}
        />
      ))}
    </>,
  );

  // Then
  const groups = [...container.querySelectorAll('[role="group"]')];
  expect(groups).toHaveLength(2);
  const titleIds = groups.map((group) => {
    const title = group.querySelector('p');
    expect(title?.id).toBeTruthy();
    expect(group.getAttribute('aria-labelledby')).toBe(title?.id);
    expect(group.hasAttribute('aria-label')).toBe(false);
    return title?.id;
  });
  expect(new Set(titleIds).size).toBe(groups.length);
});
