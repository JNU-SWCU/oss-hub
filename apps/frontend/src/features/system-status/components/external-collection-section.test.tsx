// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ExternalCollectionStatus } from '../types';
import { ExternalCollectionSection } from './external-collection-section';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

// 탐색된 학생 저장소가 하나도 없는 상태 — 프로덕션의 실제 현재 상태와 같다
// (GithubRepository에 EXTERNAL_PUBLIC 행이 0개).
const noRepositoriesDiscovered: ExternalCollectionStatus = {
  trackedRepositoryCount: 0,
  lastSweep: null,
  cumulativeCommitCount: 0,
  cumulativePullRequestCount: 0,
  cumulativeReleaseCount: 0,
};

// 탐색된 저장소가 있고 sweep도 정상적으로 한 번 끝난 상태.
const withDiscoveredRepositories: ExternalCollectionStatus = {
  trackedRepositoryCount: 3,
  lastSweep: {
    sweepFinishedAt: '2026-08-10T09:00:00.000Z',
    cycleStartedAt: '2026-08-10T08:55:00.000Z',
    scope: 'external',
    insertedCommitCount: 7,
    insertedPullRequestCount: 2,
    insertedReleaseCount: 0,
    attemptedRepositoryCount: 3,
    processedRepositoryCount: 3,
    failedRepositoryCount: 0,
    cycleCompleted: true,
    stoppedForBudget: false,
  },
  cumulativeCommitCount: 21,
  cumulativePullRequestCount: 5,
  cumulativeReleaseCount: 1,
};

// 저장소는 탐색됐지만 sweep이 일부 실패한 상태 — 실패 건수가 표시돼야 한다.
const withFailedSweep: ExternalCollectionStatus = {
  trackedRepositoryCount: 4,
  lastSweep: {
    sweepFinishedAt: '2026-08-10T08:00:00.000Z',
    cycleStartedAt: '2026-08-10T07:00:00.000Z',
    scope: 'external',
    insertedCommitCount: 3,
    insertedPullRequestCount: 0,
    insertedReleaseCount: 0,
    attemptedRepositoryCount: 4,
    processedRepositoryCount: 2,
    failedRepositoryCount: 2,
    cycleCompleted: false,
    stoppedForBudget: true,
  },
  cumulativeCommitCount: 3,
  cumulativePullRequestCount: 0,
  cumulativeReleaseCount: 0,
};

describe('ExternalCollectionSection', () => {
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

  async function renderSection(
    status: ExternalCollectionStatus,
  ): Promise<void> {
    await act(async () => {
      root.render(<ExternalCollectionSection status={status} />);
    });
  }

  function sectionText(): string {
    return container.textContent ?? '';
  }

  it('탐색된 저장소가 0개면 파이프라인은 정상 실행 중이지만 탐색이 안 됐다는 사실을 그대로 설명한다', async () => {
    await renderSection(noRepositoriesDiscovered);
    expect(sectionText()).toContain(
      '탐색된 학생 개인 GitHub 저장소가 아직 없습니다',
    );
    expect(sectionText()).toContain('매시 정각 자동으로 실행되고 있습니다');
    expect(sectionText()).toContain(
      '관리자가 학생별로 GitHub 계정을 한 명씩 지정해 실행',
    );
    // 빈 상태에서는 의미 없는 0값 카드를 보여주지 않는다.
    expect(sectionText()).not.toContain('누적 수집 활동');
  });

  it('탐색된 저장소가 있으면 추적 수와 누적 커밋·PR·릴리즈 합계를 표시한다', async () => {
    await renderSection(withDiscoveredRepositories);
    expect(sectionText()).toContain('3개 추적 중');
    expect(sectionText()).toContain('3개');
    expect(sectionText()).toContain('커밋 21');
    expect(sectionText()).toContain('PR 5');
    expect(sectionText()).toContain('릴리즈 1');
    expect(sectionText()).not.toContain(
      '탐색된 학생 개인 GitHub 저장소가 아직 없습니다',
    );
  });

  it('최근 sweep 종료 시각과 처리한 저장소 수를 표시한다', async () => {
    await renderSection(withDiscoveredRepositories);
    expect(sectionText()).toContain('최근 external sweep 종료');
    expect(sectionText()).toContain('저장소 3/3');
  });

  it('최근 sweep에 실패가 있으면 실패 건수를 함께 표시한다', async () => {
    await renderSection(withFailedSweep);
    expect(sectionText()).toContain('저장소 2/4');
    expect(sectionText()).toContain('실패 2');
  });

  it('실패가 없으면 실패 문구를 표시하지 않는다', async () => {
    await renderSection(withDiscoveredRepositories);
    expect(sectionText()).not.toContain('실패');
  });
});
