import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ExternalCollectionStatus } from '../types';
import { ExternalCollectionSection } from './external-collection-section';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const noTargets: ExternalCollectionStatus = {
  trackedRepositoryCount: 0,
  lastSuccessAt: null,
};

const targetsExistButNeverSucceeded: ExternalCollectionStatus = {
  trackedRepositoryCount: 2,
  lastSuccessAt: null,
};

const withSucceededRepositories: ExternalCollectionStatus = {
  trackedRepositoryCount: 3,
  lastSuccessAt: '2026-08-10T09:00:00.000Z',
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

  it('대상 저장소가 없으면 연결 방법과 다음 수집 조건을 안내한다', async () => {
    await renderSection(noTargets);
    expect(sectionText()).toContain('수집 대상 학생 개인 저장소가 없습니다');
    expect(sectionText()).toContain('저장소를 연결하면 바로 수집을 시작합니다');
    expect(sectionText()).toContain(
      '팀장이나 교직원이 프로그램 팀 화면에서 조직 밖 공개 저장소 주소를',
    );
    expect(sectionText()).toContain('연결된 동안만 수집하고');
    expect(sectionText()).not.toContain('마지막 수집 성공');
  });

  it('연결된 저장소가 있으면 추적 수와 마지막 수집 성공 시각을 표시한다', async () => {
    await renderSection(withSucceededRepositories);
    expect(sectionText()).toContain('3개 추적 중');
    expect(sectionText()).toContain('마지막 수집 성공');
    expect(sectionText()).toContain('2026');
    expect(sectionText()).not.toContain(
      '수집 대상 학생 개인 저장소가 없습니다',
    );
  });

  it('대상은 있지만 성공한 수집이 없으면 값을 생략하지 않고 정직하게 안내한다', async () => {
    await renderSection(targetsExistButNeverSucceeded);
    expect(sectionText()).toContain('2개 추적 중');
    expect(sectionText()).toContain('아직 성공한 수집 없음');
  });
});
