import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CollectionStreamRepository } from '../types';
import { CollectionStreamsTable } from './collection-streams-table';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const beta: CollectionStreamRepository = {
  repositoryName: 'jnu-oss/beta',
  programName: null,
  streams: [
    {
      streamType: 'COMMIT',
      bucket: 'READY',
      lastSuccessAt: '2026-08-10T09:00:00.000Z',
      lastErrorCode: null,
      lastErrorAt: null,
    },
    {
      streamType: 'RELEASE',
      bucket: 'READY',
      lastSuccessAt: '2026-08-10T08:00:00.000Z',
      lastErrorCode: null,
      lastErrorAt: null,
    },
  ],
};

const alpha: CollectionStreamRepository = {
  repositoryName: 'jnu-oss/alpha',
  programName: '오픈소스 입문 프로그램',
  streams: [
    {
      streamType: 'COMMIT',
      bucket: 'READY',
      lastSuccessAt: '2026-08-10T09:00:00.000Z',
      lastErrorCode: null,
      lastErrorAt: null,
    },
    {
      streamType: 'PULL_REQUEST',
      bucket: 'RETRY_PENDING',
      lastSuccessAt: '2026-08-09T09:00:00.000Z',
      lastErrorCode: 'PROVIDER_RATE_LIMITED',
      lastErrorAt: '2026-08-10T08:30:00.000Z',
    },
    {
      streamType: 'RELEASE',
      bucket: 'READY',
      lastSuccessAt: '2026-08-10T09:00:00.000Z',
      lastErrorCode: null,
      lastErrorAt: null,
    },
  ],
};

const gamma: CollectionStreamRepository = {
  repositoryName: 'jnu-oss/gamma',
  programName: null,
  streams: [
    {
      streamType: 'COMMIT',
      bucket: 'READY',
      lastSuccessAt: '2026-08-10T09:00:00.000Z',
      lastErrorCode: 'PROVIDER_UNMAPPED_KIND',
      lastErrorAt: '2026-08-10T07:00:00.000Z',
    },
  ],
};

const delta: CollectionStreamRepository = {
  repositoryName: 'jnu-oss/delta',
  programName: null,
  streams: [
    {
      streamType: 'COMMIT',
      bucket: 'PARTIAL',
      lastSuccessAt: null,
      lastErrorCode: null,
      lastErrorAt: null,
    },
  ],
};

describe('CollectionStreamsTable', () => {
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
    repositories: readonly CollectionStreamRepository[],
  ): Promise<void> {
    await act(async () => {
      root.render(<CollectionStreamsTable repositories={repositories} />);
    });
  }

  function tableText(): string {
    return container.textContent ?? '';
  }

  function repositoryRows(): string[] {
    return [...container.querySelectorAll('tbody tr')].map(
      (row) => row.querySelector('td')?.textContent ?? '',
    );
  }

  it('저장소 한 줄에 프로그램·Commit·PR·Release·Issue·문제 열을 표시한다', async () => {
    await renderTable([beta]);
    expect(tableText()).toContain('jnu-oss/beta');
    expect(tableText()).toContain('저장소');
    expect(tableText()).toContain('프로그램');
    expect(tableText()).toContain('Commit');
    expect(tableText()).toContain('PR');
    expect(tableText()).toContain('Release');
    expect(tableText()).toContain('Issue');
    expect(tableText()).toContain('문제');

    expect(tableText()).toContain('—');
  });

  it('문제(비-READY 버킷 또는 오류)가 있는 저장소를 먼저, 그다음 이름순으로 정렬한다', async () => {
    await renderTable([beta, gamma, delta, alpha]);
    expect(repositoryRows()).toEqual([
      'jnu-oss/alpha',
      'jnu-oss/delta',
      'jnu-oss/gamma',
      'jnu-oss/beta',
    ]);
  });

  it('알려진 오류 코드는 한국어 설명으로, 알 수 없는 코드는 원문을 monospace로 보여준다', async () => {
    await renderTable([alpha, gamma]);
    expect(tableText()).toContain('GitHub 호출 한도 초과');
    expect(tableText()).not.toContain('PROVIDER_RATE_LIMITED');
    const code = container.querySelector('code');
    expect(code?.textContent).toBe('PROVIDER_UNMAPPED_KIND');
  });

  it('오류가 없는 저장소의 문제 열은 em-dash를 표시한다', async () => {
    await renderTable([beta]);

    const problemCell = container.querySelectorAll('tbody td')[6];
    expect(problemCell?.textContent).toBe('—');
  });

  it('저장소가 프로그램에 연결돼 있으면 프로그램 이름을, 없으면 em-dash를 표시한다', async () => {
    await renderTable([alpha, beta]);

    const rows = [...container.querySelectorAll('tbody tr')];
    const programCellOf = (row: Element) =>
      row.querySelectorAll('td')[1]?.textContent;
    expect(programCellOf(rows[0]!)).toBe('오픈소스 입문 프로그램');
    expect(programCellOf(rows[1]!)).toBe('—');

    expect(tableText()).not.toContain('알 수 없음');
  });

  it('ISSUE stream의 오류는 Issue 열에서 어느 stream인지 드러난다', async () => {
    await renderTable([
      {
        repositoryName: 'jnu-oss/epsilon',
        programName: null,
        streams: [
          {
            streamType: 'ISSUE',
            bucket: 'RETRY_PENDING',
            lastSuccessAt: null,
            lastErrorCode: 'PROVIDER_PERMISSION',
            lastErrorAt: '2026-08-10T08:30:00.000Z',
          },
        ],
      },
    ]);

    const cells = container.querySelectorAll('tbody td');
    expect(cells[5]?.textContent).toContain('재시도 대기');
    expect(cells[6]?.textContent).toContain('저장소 접근 권한 없음');
  });

  it('버킷별 배지 라벨을 표시한다', async () => {
    await renderTable([alpha, delta]);
    expect(tableText()).toContain('완료');
    expect(tableText()).toContain('재시도 대기');
    expect(tableText()).toContain('부분');
  });

  it('「문제만 보기」 토글이 없다 — 요약 텍스트로 문제 건수를 계속 보여준다', async () => {
    await renderTable([beta, gamma, delta, alpha]);
    expect(
      [...container.querySelectorAll('button')].some((el) =>
        el.textContent?.includes('문제만 보기'),
      ),
    ).toBe(false);
    expect(tableText()).toContain('문제 3 / 전체 4');

    expect(tableText()).toContain('jnu-oss/beta');
    expect(tableText()).toContain('jnu-oss/alpha');
  });

  it('모두 정상이면 표는 그대로 보이고 요약은 「문제 0」을 표시한다', async () => {
    await renderTable([beta]);
    expect(tableText()).toContain('문제 0 / 전체 1');
    expect(tableText()).toContain('jnu-oss/beta');
  });

  it('저장소가 없으면 빈 상태 문구를 보여준다', async () => {
    await renderTable([]);
    expect(tableText()).toContain('수집 대상 저장소가 없습니다.');
  });

  it('저장소가 pageSize(10)를 넘으면 문제 저장소가 페이지를 넘기지 않아도 첫 페이지에서 보인다', async () => {
    const healthyRepos: CollectionStreamRepository[] = Array.from(
      { length: 12 },
      (_, i) => ({
        repositoryName: `jnu-oss/healthy-${String(i + 1).padStart(2, '0')}`,
        programName: null,
        streams: [
          {
            streamType: 'COMMIT',
            bucket: 'READY',
            lastSuccessAt: '2026-08-10T09:00:00.000Z',
            lastErrorCode: null,
            lastErrorAt: null,
          },
        ],
      }),
    );

    await renderTable([...healthyRepos, alpha]);

    expect(tableText()).toContain('문제 1 / 전체 13');

    expect(repositoryRows()[0]).toBe('jnu-oss/alpha');
    expect(tableText()).toContain('jnu-oss/alpha');

    const nav = container.querySelector('nav');
    expect(nav).not.toBeNull();
    expect(nav?.getAttribute('aria-label')).toBe('수집 대상 상세 페이지');
    expect(container.textContent).toContain('1 / 2');
  });
});
