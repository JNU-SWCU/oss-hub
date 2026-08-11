// @vitest-environment happy-dom

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

/**
 * 백엔드 `PUBLISH_BLOCKED_REASONS`가 내보내는 네 사유와, 그 사유의 문구라면 반드시 짚어야 할 말.
 *
 * 서버 계약을 여기 독립적으로 적어 둔다 — 화면 쪽 상수를 그대로 읽으면 계약이 아니라 제 글씨를 검사하게 된다.
 * `anchor`가 있어야 **문구를 서로 맞바꾼 변이**를 잡는다. 서로 다르기만 검사하면 맞바꿔도 통과한다.
 */
const REASON_ANCHORS = {
  REPOSITORY_NOT_READY: '저장소 생성',
  REPOSITORY_PUBLICATION_NOT_PLANNED: '공개 예정',
  PROGRAM_NOT_ENDED: '종료일',
  REQUIRED_MILESTONES_NOT_APPROVED: '마일스톤',
} as const satisfies Readonly<Record<PublishBlockedReason, string>>;

// `Record` 라야 완전성이 강제된다 — 배열의 `satisfies` 는 원소마다 타입만 볼 뿐
// 사유 하나를 빼면 그 사유만 조용히 안 돌고 통과한다.
const SERVER_BLOCKED_REASONS = Object.entries(REASON_ANCHORS).map(
  ([reason, anchor]) => ({ reason: reason as PublishBlockedReason, anchor }),
);

const ALL_REASONS = SERVER_BLOCKED_REASONS.map((entry) => entry.reason);

/** 사유를 못 알아봤을 때 나오는 문구 — 런타임에 뽑아 비교한다(문구를 베껴 적으면 변이를 못 잡는다). */
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
      // Given: 서버가 이 사유로 공개를 거절하는 상태다.
      render(repository({ publishEligible: false, blockedReasons: [reason] }));

      // When: 교직원이 저장소 공개 카드를 본다.
      const texts = blockedReasonTexts();

      // Then: 화면이 그린 글자가 그 사유의 문구 그대로다.
      // (`toBe(blockedReasonLabel(...))`가 "화면이 옮기긴 하는가"를, `anchor`가 "옳은 문구인가"를 잡는다.)
      expect(texts).toHaveLength(1);
      expect(texts[0]).toBe(blockedReasonLabel(reason));
      expect(texts[0]).toContain(anchor);
      expect(texts[0]).not.toBe(FALLBACK_LABEL);
      expect(publishButton().disabled).toBe(true);
    },
  );

  it('네 사유가 한꺼번에 막히면 넷을 모두, 서로 다른 문구로 나열한다', () => {
    // Given: 네 게이트가 한꺼번에 막힌 상태다.
    render(repository({ publishEligible: false, blockedReasons: ALL_REASONS }));

    // When: 화면에 나열된 사유 문구를 모은다.
    const texts = blockedReasonTexts();

    // Then: 사유 수만큼, 각 사유의 문구 그대로, 서로 다르게 나온다.
    expect(texts).toEqual(
      ALL_REASONS.map((reason) => blockedReasonLabel(reason)),
    );
    expect(new Set(texts).size).toBe(ALL_REASONS.length);
  });

  it('버튼이 왜 안 눌리는지를 사유 목록으로 설명한다', () => {
    // Given: 두 게이트가 막혀 버튼이 비활성이다.
    // 비활성 버튼만으로는 화면을 읽어 주는 도구가 이유를 말해 줄 수 없다.
    render(
      repository({
        publishEligible: false,
        blockedReasons: [
          'PROGRAM_NOT_ENDED',
          'REQUIRED_MILESTONES_NOT_APPROVED',
        ],
      }),
    );

    // When: 버튼의 설명이 무엇을 가리키는지 따라간다.
    const describedBy = publishButton().getAttribute('aria-describedby');
    const description =
      describedBy === null ? null : container.querySelector(`#${describedBy}`);

    // Then: 실제로 존재하는 사유 목록을 가리킨다.
    expect(describedBy).not.toBeNull();
    expect(description).not.toBeNull();
    expect(description?.tagName).toBe('UL');
    expect([...(description?.querySelectorAll('li') ?? [])]).toHaveLength(2);
  });

  it('공개 조건을 충족하면 버튼을 열고 네 게이트 중 하나만 내세우지 않는다', () => {
    // Given: 서버 게이트를 전부 통과했다.
    render(repository({ publishEligible: true, blockedReasons: [] }));

    // When: 교직원이 저장소 공개 카드를 본다.
    const affirmation = container.textContent ?? '';

    // Then: 차단 사유 목록이 없고 버튼이 눌린다.
    expect(blockedReasonTexts()).toHaveLength(0);
    expect(publishButton().disabled).toBe(false);
    // 그리고 옛 문구처럼 게이트 하나만 근거로 대지 않는다 —
    // 「모든 필수 마일스톤 승인이 완료되어 공개할 수 있습니다」가 이 결함의 얼굴이었다.
    for (const anchor of Object.values(REASON_ANCHORS)) {
      expect(affirmation).not.toContain(anchor);
    }
  });
});
