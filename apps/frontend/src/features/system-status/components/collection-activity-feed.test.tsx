// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CollectionActivityEntry } from '../types';
import { CollectionActivityFeed } from './collection-activity-feed';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

// 완료된 조직 sweep — 3종 모두 신규 데이터가 있고 저장소 처리도 모두 끝났다.
const completedOrgSweep: CollectionActivityEntry = {
  sweepFinishedAt: '2026-08-10T09:00:00.000Z',
  cycleStartedAt: '2026-08-10T08:55:00.000Z',
  scope: 'ORG',
  insertedCommitCount: 12,
  insertedPullRequestCount: 3,
  insertedReleaseCount: 1,
  attemptedRepositoryCount: 8,
  processedRepositoryCount: 8,
  failedRepositoryCount: 0,
  cycleCompleted: true,
  stoppedForBudget: false,
};

// 예산 때문에 중단된 외부(EXTERNAL) sweep — 저장소 일부만 처리했고 실패도 있다.
const budgetStoppedExternalSweep: CollectionActivityEntry = {
  sweepFinishedAt: '2026-08-10T08:00:00.000Z',
  cycleStartedAt: '2026-08-10T07:00:00.000Z',
  scope: 'EXTERNAL',
  insertedCommitCount: 4,
  insertedPullRequestCount: 0,
  insertedReleaseCount: 0,
  attemptedRepositoryCount: 10,
  processedRepositoryCount: 6,
  failedRepositoryCount: 2,
  cycleCompleted: false,
  stoppedForBudget: true,
};

// 신규 데이터가 하나도 없는 sweep — 사이클은 아직 진행 중.
const emptySweep: CollectionActivityEntry = {
  sweepFinishedAt: '2026-08-10T07:00:00.000Z',
  cycleStartedAt: '2026-08-10T06:55:00.000Z',
  scope: 'ORG',
  insertedCommitCount: 0,
  insertedPullRequestCount: 0,
  insertedReleaseCount: 0,
  attemptedRepositoryCount: 5,
  processedRepositoryCount: 5,
  failedRepositoryCount: 0,
  cycleCompleted: false,
  stoppedForBudget: false,
};

// scope가 알려진 값(ORG/EXTERNAL)이 아닌 경우 — 원문을 그대로 보여줘야 한다.
const unknownScopeSweep: CollectionActivityEntry = {
  sweepFinishedAt: '2026-08-10T06:00:00.000Z',
  cycleStartedAt: null,
  scope: 'ARCHIVED_MIRROR',
  insertedCommitCount: 1,
  insertedPullRequestCount: 0,
  insertedReleaseCount: 0,
  attemptedRepositoryCount: 1,
  processedRepositoryCount: 1,
  failedRepositoryCount: 0,
  cycleCompleted: true,
  stoppedForBudget: false,
};

describe('CollectionActivityFeed', () => {
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

  async function renderFeed(
    entries: readonly CollectionActivityEntry[],
  ): Promise<void> {
    await act(async () => {
      root.render(<CollectionActivityFeed entries={entries} />);
    });
  }

  function feedText(): string {
    return container.textContent ?? '';
  }

  it('건수·저장소 처리·완료 배지를 표시한다', async () => {
    await renderFeed([completedOrgSweep]);
    expect(feedText()).toContain('조직');
    expect(feedText()).toContain('커밋 12');
    expect(feedText()).toContain('PR 3');
    expect(feedText()).toContain('릴리즈 1');
    expect(feedText()).toContain('저장소 8/8');
    expect(feedText()).toContain('사이클 완료');
    expect(feedText()).not.toContain('실패');
  });

  it('예산 중단 sweep은 「외부」 배지·「예산 중단」 상태·실패 건수를 destructive 톤으로 표시한다', async () => {
    await renderFeed([budgetStoppedExternalSweep]);
    expect(feedText()).toContain('외부');
    expect(feedText()).toContain('예산 중단');
    expect(feedText()).toContain('저장소 6/10');
    expect(feedText()).toContain('실패 2');
    // 「저장소 X/Y」를 감싸는 바깥 span도 자식의 텍스트를 포함해 '실패 2'와
    // 매치되므로, 가장 안쪽(=문서 순서상 마지막) 일치 요소를 찾는다.
    const failedNode = [...container.querySelectorAll('span')].findLast(
      (el) => el.textContent?.trim() === '실패 2',
    );
    expect(failedNode?.className).toContain('text-destructive');
  });

  it('완료되지 않았고 예산 중단도 아니면 「진행 중」을 표시한다', async () => {
    await renderFeed([emptySweep]);
    expect(feedText()).toContain('진행 중');
    expect(feedText()).not.toContain('사이클 완료');
    expect(feedText()).not.toContain('예산 중단');
  });

  it('3종 모두 0건이면 「신규 데이터 없음」을 표시한다', async () => {
    await renderFeed([emptySweep]);
    expect(feedText()).toContain('신규 데이터 없음');
  });

  it('알려지지 않은 scope는 원문을 monospace로 보여준다', async () => {
    await renderFeed([unknownScopeSweep]);
    const code = container.querySelector('code');
    expect(code?.textContent).toBe('ARCHIVED_MIRROR');
  });

  it('빈 배열이면 빈 상태 문구를 보여준다', async () => {
    await renderFeed([]);
    expect(feedText()).toContain('아직 기록된 수집 활동이 없습니다');
    expect(feedText()).toContain('다음 수집 주기부터 쌓입니다.');
  });

  it('sweepFinishedAt desc 정렬을 그대로 렌더링한다(정렬은 백엔드 계약)', async () => {
    await renderFeed([completedOrgSweep, budgetStoppedExternalSweep]);
    const times = [...container.querySelectorAll('time')].map((el) =>
      el.getAttribute('dateTime'),
    );
    expect(times).toEqual([
      completedOrgSweep.sweepFinishedAt,
      budgetStoppedExternalSweep.sweepFinishedAt,
    ]);
  });
});
