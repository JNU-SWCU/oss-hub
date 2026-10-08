import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ExternalCollectionStatus } from '../types';
import { ExternalCollectionSection } from './external-collection-section';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const neverSweptNoTargets: ExternalCollectionStatus = {
  trackedRepositoryCount: 0,
  lastSweep: null,
  cumulativeCommitCount: 0,
  cumulativePullRequestCount: 0,
  cumulativeReleaseCount: 0,
  cumulativeIssueCount: 0,
};

const sweepRanWithNoTargets: ExternalCollectionStatus = {
  trackedRepositoryCount: 0,
  lastSweep: {
    sweepFinishedAt: '2026-08-10T09:00:00.000Z',
    cycleStartedAt: '2026-08-10T08:55:00.000Z',
    scope: 'external',
    kind: 'SWEEP',
    insertedCommitCount: 0,
    insertedPullRequestCount: 0,
    insertedReleaseCount: 0,
    insertedIssueCount: 0,
    attemptedRepositoryCount: 0,
    processedRepositoryCount: 0,
    failedRepositoryCount: 0,
    cycleCompleted: true,
    stoppedForBudget: false,
  },
  cumulativeCommitCount: 0,
  cumulativePullRequestCount: 0,
  cumulativeReleaseCount: 0,
  cumulativeIssueCount: 0,
};

const targetsExistButNeverSwept: ExternalCollectionStatus = {
  trackedRepositoryCount: 2,
  lastSweep: null,
  cumulativeCommitCount: 0,
  cumulativePullRequestCount: 0,
  cumulativeReleaseCount: 0,
  cumulativeIssueCount: 0,
};

const withDiscoveredRepositories: ExternalCollectionStatus = {
  trackedRepositoryCount: 3,
  lastSweep: {
    sweepFinishedAt: '2026-08-10T09:00:00.000Z',
    cycleStartedAt: '2026-08-10T08:55:00.000Z',
    scope: 'external',
    kind: 'SWEEP',
    insertedCommitCount: 7,
    insertedPullRequestCount: 2,
    insertedReleaseCount: 0,
    insertedIssueCount: 0,
    attemptedRepositoryCount: 3,
    processedRepositoryCount: 3,
    failedRepositoryCount: 0,
    cycleCompleted: true,
    stoppedForBudget: false,
  },
  cumulativeCommitCount: 21,
  cumulativePullRequestCount: 5,
  cumulativeReleaseCount: 1,
  cumulativeIssueCount: 7,
};

const withFailedSweep: ExternalCollectionStatus = {
  trackedRepositoryCount: 4,
  lastSweep: {
    sweepFinishedAt: '2026-08-10T08:00:00.000Z',
    cycleStartedAt: '2026-08-10T07:00:00.000Z',
    scope: 'external',
    kind: 'SWEEP',
    insertedCommitCount: 3,
    insertedPullRequestCount: 0,
    insertedReleaseCount: 0,
    insertedIssueCount: 0,
    attemptedRepositoryCount: 4,
    processedRepositoryCount: 2,
    failedRepositoryCount: 2,
    cycleCompleted: false,
    stoppedForBudget: true,
  },
  cumulativeCommitCount: 3,
  cumulativePullRequestCount: 0,
  cumulativeReleaseCount: 0,
  cumulativeIssueCount: 0,
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
    await act(() => Promise.resolve(root.unmount()));
    container.remove();
  });

  async function renderSection(
    status: ExternalCollectionStatus,
  ): Promise<void> {
    await act(() => {
      root.render(<ExternalCollectionSection status={status} />);
      return Promise.resolve();
    });
  }

  function sectionText(): string {
    return container.textContent ?? '';
  }

  it('sweep이 단 한 번도 끝난 적이 없으면(lastSweep null) 파이프라인이 자동 실행 중이라고 단정하지 않고 스케줄러·설정 확인이 필요하다고 안내한다', async () => {
    await renderSection(neverSweptNoTargets);
    expect(sectionText()).toContain('수집 대상 학생 개인 저장소가 없습니다');

    expect(sectionText()).not.toContain('매시 정각 자동으로 실행되고 있습니다');
    expect(sectionText()).toContain('완료된 수집 기록도 없습니다');
    expect(sectionText()).toContain('스케줄러 실행과 런타임 설정');

    expect(sectionText()).toContain(
      '팀장이나 교직원이 프로그램 팀 화면에서 조직 밖 공개 저장소 주소를',
    );
    expect(sectionText()).toContain('연결된 동안만 수집하고');
    expect(sectionText()).not.toContain('OWN');
    expect(sectionText()).not.toContain('저장소 탐색을 실행');
    expect(sectionText()).toContain('수집 대상 학생 개인 저장소가 없습니다');

    expect(sectionText()).not.toContain('탐색을 실행한 학생이 없어');

    expect(sectionText()).not.toContain('누적 수집 활동');
    expect(container.querySelectorAll('ul > li')).toHaveLength(0);
  });

  it('대상 0개와 완료 이력을 구별하고 다음 수집 조건을 안내한다', async () => {
    await renderSection(sweepRanWithNoTargets);
    expect(sectionText()).toContain('수집 대상 학생 개인 저장소가 없습니다');

    expect(sectionText()).toContain(
      '최근 수집은 완료됐지만 대상 저장소가 0개입니다',
    );
    expect(sectionText()).not.toContain('완료된 수집 기록도 없습니다');
    expect(sectionText()).toContain('수집 대상 학생 개인 저장소가 없습니다');
  });

  it('연결된 저장소가 있으면 추적 수와 누적 Commit·PR·Release·Issue 합계를 표시한다', async () => {
    await renderSection(withDiscoveredRepositories);
    expect(sectionText()).toContain('3개 추적 중');
    expect(sectionText()).toContain('3개');
    expect(sectionText()).toContain('Commit 21 · PR 5 · Release 1 · Issue 7');
    expect(sectionText()).not.toContain(
      '수집 대상 학생 개인 저장소가 없습니다',
    );
  });

  it('최근 sweep 종료 시각과 처리한 저장소 수를 표시한다', async () => {
    await renderSection(withDiscoveredRepositories);
    expect(sectionText()).toContain('최근 외부 수집 실행 종료');
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

  it('대상은 있지만 sweep이 한 번도 끝난 적이 없으면(lastSweep null) 값을 생략하지 않고 정직하게 안내한다', async () => {
    await renderSection(targetsExistButNeverSwept);
    expect(sectionText()).toContain('2개 추적 중');
    expect(sectionText()).toContain('아직 완료된 수집 없음');
    expect(sectionText()).not.toContain('최근 실행 처리');
  });
});
