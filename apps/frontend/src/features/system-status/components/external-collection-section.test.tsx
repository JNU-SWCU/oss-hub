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

// 탐색된 학생 저장소가 하나도 없고, external sweep도 여태 단 한 번도 끝난 적이
// 없는 상태 — 프로덕션의 실제 현재 상태와 같다(GithubRepository에
// EXTERNAL_PUBLIC 행이 0개, CollectionSweepHistory에 external scope 행도 0개).
// lastSweep이 null이므로 "파이프라인이 자동 실행되고 있다"고 단정하면 안 된다
// (QA57) — 스케줄러가 아예 안 도는 것일 수 있다.
const neverSweptNoTargets: ExternalCollectionStatus = {
  trackedRepositoryCount: 0,
  lastSweep: null,
  cumulativeCommitCount: 0,
  cumulativePullRequestCount: 0,
  cumulativeReleaseCount: 0,
};

// 탐색된 저장소는 없지만 external sweep 자체는 정상적으로 한 번 끝난 상태 —
// 대상 0개로 처리할 게 없었을 뿐 파이프라인은 정상 실행 중이다.
const sweepRanWithNoTargets: ExternalCollectionStatus = {
  trackedRepositoryCount: 0,
  lastSweep: {
    sweepFinishedAt: '2026-08-10T09:00:00.000Z',
    cycleStartedAt: '2026-08-10T08:55:00.000Z',
    scope: 'external',
    insertedCommitCount: 0,
    insertedPullRequestCount: 0,
    insertedReleaseCount: 0,
    attemptedRepositoryCount: 0,
    processedRepositoryCount: 0,
    failedRepositoryCount: 0,
    cycleCompleted: true,
    stoppedForBudget: false,
  },
  cumulativeCommitCount: 0,
  cumulativePullRequestCount: 0,
  cumulativeReleaseCount: 0,
};

// 탐색된 저장소는 있지만(대상은 채워졌지만) sweep은 여태 한 번도 끝난 적이
// 없는 상태 — 비어있지 않은 카드에서도 lastSweep null을 정직하게 보여줘야
// 한다("최근 종료" 값을 조용히 생략하면 수집이 잘 되는 것처럼 오독될 수 있다).
const targetsExistButNeverSwept: ExternalCollectionStatus = {
  trackedRepositoryCount: 2,
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

  it('sweep이 단 한 번도 끝난 적이 없으면(lastSweep null) 파이프라인이 자동 실행 중이라고 단정하지 않고 스케줄러·설정 확인이 필요하다고 안내한다', async () => {
    await renderSection(neverSweptNoTargets);
    expect(sectionText()).toContain(
      '탐색된 학생 개인 GitHub 저장소가 아직 없습니다',
    );
    // QA57 — lastSweep이 null이면 sweep이 한 번도 끝난 적이 없다는 뜻이라
    // "매시 정각 자동으로 실행되고 있다"고 단정하면 실제로 안 도는 스케줄러를
    // 감추게 된다. 이 문구를 절대 포함해서는 안 된다.
    expect(sectionText()).not.toContain('매시 정각 자동으로 실행되고 있습니다');
    expect(sectionText()).toContain('단 한 번도 완료된 적이 없습니다');
    expect(sectionText()).toContain('스케줄러가 정상 실행 중인지');
    // 대상을 채우는 두 경로(신청 승인 / 관리자 수동 탐색) 설명은 sweep 실행
    // 여부와 무관하게 여전히 정확한 정보이므로 그대로 유지한다.
    expect(sectionText()).toContain(
      '학생이 프로그램 신청에서 「이미 쓰던 저장소를 연결합니다」를 선택',
    );
    expect(sectionText()).not.toContain('OWN');
    expect(sectionText()).toContain(
      '「신청 승인 시 GitHub 저장소 자동 생성」이 꺼져 있으면 이 경로는 동작하지 않습니다',
    );
    expect(sectionText()).not.toContain('repositoryProvisioningEnabled');
    expect(sectionText()).toContain('관리자가 학생별로 저장소 탐색을 실행');
    expect(sectionText()).toContain('현재 수집 대상 저장소가 0개라');
    // "왜 0인지"의 원인은 코드가 구분할 수 없는 사실이라 단정하지 않는다.
    expect(sectionText()).not.toContain('탐색을 실행한 학생이 없어');
    // 빈 상태에서는 의미 없는 0값 카드를 보여주지 않는다.
    expect(sectionText()).not.toContain('누적 수집 활동');
  });

  it('sweep은 정상적으로 끝났지만 대상이 0개면(lastSweep 존재) 파이프라인이 정상 실행 중이라고 안내한다', async () => {
    await renderSection(sweepRanWithNoTargets);
    expect(sectionText()).toContain(
      '탐색된 학생 개인 GitHub 저장소가 아직 없습니다',
    );
    // sweep이 실제로 최소 한 번 끝났으므로(lastSweep 존재) 자동 실행 중이라는
    // 문구는 근거가 있다.
    expect(sectionText()).toContain('매시 정각 자동으로 실행되고 있습니다');
    expect(sectionText()).not.toContain('단 한 번도 완료된 적이 없습니다');
    expect(sectionText()).toContain('현재 수집 대상 저장소가 0개라');
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

  it('대상은 있지만 sweep이 한 번도 끝난 적이 없으면(lastSweep null) 값을 생략하지 않고 정직하게 안내한다', async () => {
    await renderSection(targetsExistButNeverSwept);
    expect(sectionText()).toContain('2개 추적 중');
    expect(sectionText()).toContain('아직 완료된 수집 없음');
    expect(sectionText()).not.toContain('최근 sweep 처리');
  });
});
