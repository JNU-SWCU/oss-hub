import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { blockedReasonLabel } from '../review-format';
import type { PublishBlockedReason, ReviewRepository } from '../types';
import { RepositoryPublishCard } from './repository-publish-card';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

const REASON_ANCHORS = {
  REPOSITORY_NOT_READY: '저장소 생성',
  REPOSITORY_PUBLICATION_NOT_PLANNED: '공개 예정',
  PROGRAM_NOT_ENDED: '종료일',
  REQUIRED_MILESTONES_NOT_APPROVED: '마일스톤',
} as const satisfies Readonly<Record<PublishBlockedReason, string>>;

const SERVER_BLOCKED_REASONS = Object.entries(REASON_ANCHORS).map(
  ([reason, anchor]) => ({ reason: reason as PublishBlockedReason, anchor }),
);

const ALL_REASONS = SERVER_BLOCKED_REASONS.map((entry) => entry.reason);

const FALLBACK_LABEL = blockedReasonLabel(
  '__reason-that-the-frontend-does-not-know__',
);

const noOp = () => undefined;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function repository(overrides?: Partial<ReviewRepository>): ReviewRepository {
  return {
    id: 'repository-1',
    url: 'https://github.com/synthetic-org/synthetic-repository',
    visibility: 'PRIVATE',
    publishEligible: false,
    blockedReasons: ['REQUIRED_MILESTONES_NOT_APPROVED'],
    ...overrides,
  };
}

function render(value: ReviewRepository): void {
  act(() => {
    root.render(
      <RepositoryPublishCard
        repository={value}
        isPublishing={false}
        errorMessage={null}
        onPublish={noOp}
      />,
    );
  });
}

function blockedReasonTexts(): readonly string[] {
  return [...container.querySelectorAll('li')].map(
    (item) => item.textContent ?? '',
  );
}

function publishButton(): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find((candidate) =>
    (candidate.textContent ?? '').includes('공개 전환'),
  );
  if (button === undefined) throw new Error('공개 전환 버튼을 찾지 못했다');
  return button;
}

describe('RepositoryPublishCard — 서버가 거절하는 조건을 교직원에게 말한다', () => {
  it.each(SERVER_BLOCKED_REASONS)(
    '$reason 를 그 사유의 사람 말로 옮겨 그리고 버튼을 닫는다',
    ({ reason, anchor }) => {
      render(repository({ publishEligible: false, blockedReasons: [reason] }));

      const texts = blockedReasonTexts();

      expect(texts).toHaveLength(1);
      expect(texts[0]).toBe(blockedReasonLabel(reason));
      expect(texts[0]).toContain(anchor);
      expect(texts[0]).not.toBe(FALLBACK_LABEL);
      expect(publishButton().disabled).toBe(true);
    },
  );

  it('네 사유가 한꺼번에 막히면 넷을 모두, 서로 다른 문구로 나열한다', () => {
    render(repository({ publishEligible: false, blockedReasons: ALL_REASONS }));

    const texts = blockedReasonTexts();

    expect(texts).toEqual(
      ALL_REASONS.map((reason) => blockedReasonLabel(reason)),
    );
    expect(new Set(texts).size).toBe(ALL_REASONS.length);
  });

  it('버튼이 왜 안 눌리는지를 사유 목록으로 설명한다', () => {
    render(
      repository({
        publishEligible: false,
        blockedReasons: [
          'PROGRAM_NOT_ENDED',
          'REQUIRED_MILESTONES_NOT_APPROVED',
        ],
      }),
    );

    const describedBy = publishButton().getAttribute('aria-describedby');
    const description =
      describedBy === null ? null : container.querySelector(`#${describedBy}`);

    expect(describedBy).not.toBeNull();
    expect(description).not.toBeNull();
    expect(description?.tagName).toBe('UL');
    expect([...(description?.querySelectorAll('li') ?? [])]).toHaveLength(2);
  });

  it('공개 조건을 충족하면 버튼을 열고 네 게이트 중 하나만 내세우지 않는다', () => {
    render(repository({ publishEligible: true, blockedReasons: [] }));

    const affirmation = container.textContent ?? '';

    expect(blockedReasonTexts()).toHaveLength(0);
    expect(publishButton().disabled).toBe(false);

    for (const anchor of Object.values(REASON_ANCHORS)) {
      expect(affirmation).not.toContain(anchor);
    }
  });
});
