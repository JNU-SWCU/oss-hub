import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ListCard } from './list-card';

function render(props: Parameters<typeof ListCard>[0]) {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(<ListCard {...props} />);
  return container;
}

describe('ListCard', () => {
  for (const cover of [undefined, <div key="cover">cover</div>]) {
    it(`G6 clamps titles ${cover ? 'with' : 'without'} a cover`, () => {
      const view = render({ title: '합성 제목', cover });
      const title = view.querySelector('[data-slot="card-title"]');
      expect(title?.classList.contains('line-clamp-2')).toBe(true);
    });
  }

  it('AC7 reserves cover title and note rows with compact flexible content', () => {
    const view = render({
      title: '합성 제목',
      cover: <div>cover</div>,
      meta: '2026.01 ~ 2026.12',
      href: '/programs/synthetic',
    });
    const card = view.querySelector('[data-slot="list-card"]');
    const title = view.querySelector('[data-slot="card-title"]');
    const content = view.querySelector('[data-slot="card-content"]');
    expect(card?.classList.contains('[--card-spacing:--spacing(3)]')).toBe(
      true,
    );
    expect(title?.classList.contains('min-h-[2lh]')).toBe(true);
    expect(content?.classList.contains('flex-1')).toBe(true);
    expect(content?.children).toHaveLength(2);
    expect(content?.lastElementChild?.textContent).toBe('');
    expect(
      view
        .querySelector('[data-slot="list-card-affordance"]')
        ?.classList.contains('mt-auto'),
    ).toBe(true);
  });

  it('AC7 preserves non-cover spacing without reserved rows or flexible content', () => {
    const view = render({ title: '합성 제목', meta: '2026.01' });
    const card = view.querySelector('[data-slot="list-card"]');
    const title = view.querySelector('[data-slot="card-title"]');
    const content = view.querySelector('[data-slot="card-content"]');
    expect(card?.classList.contains('[--card-spacing:--spacing(3)]')).toBe(
      false,
    );
    expect(title?.classList.contains('min-h-[2lh]')).toBe(false);
    expect(content?.classList.contains('flex-1')).toBe(false);
    expect(content?.children).toHaveLength(1);
  });

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

  it('keeps the sr-only status span inside a positioned card root', () => {
    const view = render({
      title: '합성 프로그램',
      badge: { text: '모집중', variant: 'recruiting' },
      statusDescription: '상태: 모집중. ',
      href: '/programs/synthetic',
    });
    const root = view.querySelector('[data-slot="list-card"]');
    expect(root?.classList.contains('relative')).toBe(true);
    expect(root?.querySelector('.sr-only')?.textContent).toBe('상태: 모집중. ');
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
