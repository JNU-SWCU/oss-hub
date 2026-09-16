// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ListCard } from './list-card';

function render(props: Parameters<typeof ListCard>[0]) {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(<ListCard {...props} />);
  return container;
}

describe('ListCard', () => {
  it('makes the whole card one link without nested interactive controls', () => {
    const view = render({
      title: '합성 프로젝트',
      subtitle: '합성 프로그램',
      badge: { text: 'GitHub PUBLIC', variant: 'approved' },
      meta: <time dateTime="2026-09-01">2026.09.01</time>,
      href: '/archive/synthetic-project',
    });
    const link = view.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/archive/synthetic-project');
    expect(link?.querySelector('[data-slot="list-card"]')).not.toBeNull();
    expect(view.querySelectorAll('a, button, [tabindex]')).toHaveLength(1);
    expect(link?.textContent).toContain('합성 프로젝트');
    expect(link?.querySelector('time')?.dateTime).toBe('2026-09-01');
  });

  it('omits absent badge, subtitle, metadata and action rows', () => {
    const view = render({ title: '제목만 있는 항목' });
    expect(view.textContent).toBe('제목만 있는 항목');
    for (const slot of [
      'status-badge',
      'card-description',
      'card-content',
      'card-footer',
    ]) {
      expect(view.querySelector(`[data-slot="${slot}"]`)).toBeNull();
    }
    expect(view.querySelector('a')).toBeNull();
  });

  it('does not reserve content space for empty strings', () => {
    const view = render({
      title: '합성 항목',
      subtitle: '',
      meta: '',
      note: '',
      href: '/programs/synthetic',
    });
    expect(view.querySelector('[data-slot="card-content"]')).toBeNull();
    expect(view.querySelector('[data-slot="card-description"]')).toBeNull();
    expect(view.querySelectorAll('a')).toHaveLength(1);
  });
});
