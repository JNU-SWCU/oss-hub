import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CollectionRepositoryStatus } from '../types';
import { CollectionRepositoriesTable } from './collection-repositories-table';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const healthy = (repositoryName: string): CollectionRepositoryStatus => ({
  repositoryName,
  programName: null,
  lastSuccessAt: '2026-08-10T09:00:00.000Z',
  stale: false,
});

const beta = healthy('jnu-oss/beta');

const alpha: CollectionRepositoryStatus = {
  repositoryName: 'jnu-oss/alpha',
  programName: '오픈소스 입문 프로그램',
  lastSuccessAt: '2026-08-10T05:00:00.000Z',
  stale: true,
};

const gamma: CollectionRepositoryStatus = {
  repositoryName: 'jnu-oss/gamma',
  programName: null,
  lastSuccessAt: null,
  stale: false,
};

describe('CollectionRepositoriesTable', () => {
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
  });

  async function renderTable(
    repositories: readonly CollectionRepositoryStatus[],
  ): Promise<void> {
    await act(async () => {
      root.render(<CollectionRepositoriesTable repositories={repositories} />);
    });
  }

  const text = (): string => container.textContent ?? '';
  const rows = (): Element[] => [...container.querySelectorAll('tbody tr')];
  const cell = (row: Element | undefined, index: number): string =>
    row?.querySelectorAll('td')[index]?.textContent ?? '';

  it('저장소·프로그램·마지막 수집 성공·상태 열을 보여준다', async () => {
    await renderTable([beta]);

    for (const header of ['저장소', '프로그램', '마지막 수집 성공', '상태']) {
      expect(text()).toContain(header);
    }
    expect(cell(rows()[0], 0)).toBe('jnu-oss/beta');
    expect(cell(rows()[0], 1)).toBe('—');
  });

  it('지연 저장소를 먼저, 그다음 이름순으로 정렬한다', async () => {
    await renderTable([beta, gamma, alpha]);

    expect(rows().map((row) => cell(row, 0))).toEqual([
      'jnu-oss/alpha',
      'jnu-oss/beta',
      'jnu-oss/gamma',
    ]);
  });

  it('지연·정상·수집 전 배지를 구분한다', async () => {
    await renderTable([alpha, beta, gamma]);

    expect(rows().map((row) => cell(row, 3))).toEqual([
      '지연',
      '정상',
      '수집 전',
    ]);
    expect(cell(rows()[0], 1)).toBe('오픈소스 입문 프로그램');
  });

  it('요약에 지연 수와 전체 수를 보여준다', async () => {
    await renderTable([beta, gamma, alpha]);

    expect(text()).toContain('지연 1 / 전체 3');
  });

  it('저장소가 없으면 빈 상태 문구를 보여준다', async () => {
    await renderTable([]);

    expect(text()).toContain('수집 대상 저장소가 없습니다.');
    expect(text()).toContain('지연 0 / 전체 0');
  });

  it('10개를 넘으면 지연 저장소가 첫 페이지 맨 위에 오고 페이지를 나눈다', async () => {
    await renderTable([
      ...Array.from({ length: 12 }, (_, index) =>
        healthy(`jnu-oss/healthy-${String(index + 1).padStart(2, '0')}`),
      ),
      alpha,
    ]);

    expect(cell(rows()[0], 0)).toBe('jnu-oss/alpha');
    expect(rows()).toHaveLength(10);
    expect(container.querySelector('nav')?.getAttribute('aria-label')).toBe(
      '수집 대상 상세 페이지',
    );
    expect(text()).toContain('1 / 2');
  });
});
