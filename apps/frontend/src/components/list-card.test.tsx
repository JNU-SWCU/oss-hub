import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ListCard } from './list-card';

function render(props: Parameters<typeof ListCard>[0]) {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(<ListCard {...props} />);
  return container;
}

describe('ListCard', () => {
  for (const media of [undefined, <div key="media">media</div>]) {
    it(`G6 clamps titles ${media ? 'with' : 'without'} a media`, () => {
      const view = render({ title: '합성 제목', media });
      const title = view.querySelector('[data-slot="card-title"]');
      expect(title?.classList.contains('line-clamp-2')).toBe(true);
    });
  }

  it('AC5 lays a media card out as a caller-sized media column beside a padded text column', () => {
    const view = render({
      title: '합성 제목',
      subtitle: '합성 주관',
      media: <div>media</div>,
      meta: '2026.01 ~ 2026.12',
      href: '/programs/synthetic',
    });
    const card = view.querySelector('[data-slot="list-card"]');
    for (const className of [
      'grid',
      'grid-cols-[auto_minmax(0,1fr)]',
      'grid-rows-[auto_1fr_auto]',
      'gap-x-3',
      'gap-y-1',
      'p-(--card-spacing)',
    ]) {
      expect(card?.classList.contains(className), className).toBe(true);
    }
    expect(
      Array.from(card?.classList ?? []).filter((className) =>
        className.includes('grid-cols-'),
      ),
    ).toEqual(['grid-cols-[auto_minmax(0,1fr)]']);
    for (const className of ['flex', 'py-(--card-spacing)', 'pt-0']) {
      expect(card?.classList.contains(className), className).toBe(false);
    }
    const mediaSlot = view.querySelector('[data-slot="list-card-media"]');
    expect(mediaSlot?.previousElementSibling).toBeNull();
    expect(mediaSlot?.classList.contains('row-span-full')).toBe(true);
    expect(mediaSlot?.classList.contains('self-start')).toBe(true);
    expect(mediaSlot?.firstElementChild?.textContent).toBe('media');
    for (const slot of [
      'card-header',
      'card-content',
      'list-card-affordance',
    ]) {
      const element = view.querySelector(`[data-slot="${slot}"]`);
      expect(element?.classList.contains('col-start-2'), slot).toBe(true);
      expect(element?.classList.contains('px-0'), slot).toBe(true);
      expect(element?.classList.contains('px-(--card-spacing)'), slot).toBe(
        false,
      );
    }
    const title = view.querySelector('[data-slot="card-title"]');
    const content = view.querySelector('[data-slot="card-content"]');
    expect(title?.classList.contains('min-h-[2lh]')).toBe(true);
    expect(content?.children).toHaveLength(2);
    expect(content?.lastElementChild?.textContent).toBe('');
    expect(content?.lastElementChild?.classList.contains('min-h-[1lh]')).toBe(
      true,
    );
    expect(
      view
        .querySelector('[data-slot="list-card-affordance"]')
        ?.classList.contains('mt-auto'),
    ).toBe(true);
  });

  it('AC7 keeps non-media cards compact without reserved title rows', () => {
    const view = render({
      title: '합성 제목',
      meta: '2026.01',
      href: '/archive/synthetic',
    });
    const card = view.querySelector('[data-slot="list-card"]');
    expect(card?.classList.contains('flex')).toBe(true);
    expect(card?.classList.contains('grid')).toBe(false);
    expect(card?.classList.contains('py-(--card-spacing)')).toBe(true);
    expect(card?.classList.contains('[--card-spacing:--spacing(3)]')).toBe(
      true,
    );
    expect(view.querySelector('[data-slot="list-card-media"]')).toBeNull();
    for (const slot of [
      'card-header',
      'card-content',
      'list-card-affordance',
    ]) {
      const element = view.querySelector(`[data-slot="${slot}"]`);
      expect(element?.classList.contains('px-(--card-spacing)'), slot).toBe(
        true,
      );
      expect(element?.classList.contains('col-start-2'), slot).toBe(false);
    }
    const title = view.querySelector('[data-slot="card-title"]');
    const content = view.querySelector('[data-slot="card-content"]');
    expect(title?.classList.contains('min-h-[2lh]')).toBe(false);
    expect(content?.children).toHaveLength(1);
  });

  it('keeps labeled details inline and unlabeled summaries as blocks', () => {
    const view = render({
      title: '합성 프로젝트',
      details: [
        { label: '저장소', value: <code>oss-public</code> },
        {
          value: (
            <dl>
              <dt>Commit</dt>
              <dd>5</dd>
            </dl>
          ),
        },
      ],
    });
    const rows = view.querySelector('[data-slot="card-content"]')
      ?.firstElementChild?.children;
    const labeled = rows?.[0];
    expect(labeled?.textContent).toBe('저장소 oss-public');
    expect(labeled?.querySelector('div')).toBeNull();
    expect(
      labeled?.firstElementChild?.classList.contains('text-muted-foreground'),
    ).toBe(true);
    expect(labeled?.lastElementChild?.querySelector('code')?.textContent).toBe(
      'oss-public',
    );
    expect(rows?.[1].querySelector('div > dl')?.textContent).toBe('Commit5');
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
