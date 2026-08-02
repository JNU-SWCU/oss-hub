import { describe, expect, it } from 'vitest';
import {
  createCosmosQualityGovernor,
  type CosmosQualityGovernor,
} from './cosmos-quality';

const BUDGET_MS = 16.7;

function record(
  governor: CosmosQualityGovernor,
  frameCount: number,
  durationMs: number,
): void {
  for (let index = 0; index < frameCount; index += 1) {
    governor.recordFrame(durationMs, BUDGET_MS);
  }
}

describe('createCosmosQualityGovernor', () => {
  it('keeps full quality while the rolling frame budget passes', () => {
    // Given
    const governor = createCosmosQualityGovernor();

    // When
    Array.from({ length: 12 }, () => 8).forEach((duration) => {
      governor.recordFrame(duration, 16.7);
    });

    // Then
    expect(governor.qualityScale()).toBe(1);
  });

  it('lowers the next-frame quality when p95 misses its budget', () => {
    // Given
    const governor = createCosmosQualityGovernor();

    // When
    Array.from({ length: 12 }, () => 24).forEach((duration) => {
      governor.recordFrame(duration, 16.7);
    });

    // Then
    expect(governor.qualityScale()).toBe(0.75);
  });

  it('never lowers quality below the safe floor', () => {
    // Given
    const governor = createCosmosQualityGovernor();

    // When
    Array.from({ length: 36 }, () => 40).forEach((duration) => {
      governor.recordFrame(duration, 16.7);
    });

    // Then
    expect(governor.qualityScale()).toBe(0.5);
  });

  it('raises quality again once frames settle well under budget', () => {
    // Given — 순간적인 멈춤 한 번으로 이미 한 단계 내려간 상태
    const governor = createCosmosQualityGovernor();
    record(governor, 12, 24);
    expect(governor.qualityScale()).toBe(0.75);

    // When
    record(governor, 36, 8);

    // Then
    expect(governor.qualityScale()).toBe(1);
  });

  it('needs a longer calm run to raise quality than a single window needed to lower it', () => {
    // Given
    const governor = createCosmosQualityGovernor();
    record(governor, 12, 24);

    // When — 낮추기에 걸린 창은 하나뿐이었지만, 두 창이 좋아도 아직 올리지 않는다
    record(governor, 24, 8);

    // Then
    expect(governor.qualityScale()).toBe(0.75);

    // When
    record(governor, 12, 8);

    // Then
    expect(governor.qualityScale()).toBe(1);
  });

  it('raises quality one step at a time', () => {
    // Given — 바닥까지 내려간 상태
    const governor = createCosmosQualityGovernor();
    record(governor, 24, 40);
    expect(governor.qualityScale()).toBe(0.5);

    // When
    record(governor, 36, 8);

    // Then
    expect(governor.qualityScale()).toBe(0.75);

    // When
    record(governor, 36, 8);

    // Then
    expect(governor.qualityScale()).toBe(1);
  });

  it('restarts the calm run when a window only barely clears the budget', () => {
    // Given
    const governor = createCosmosQualityGovernor();
    record(governor, 12, 24);
    record(governor, 24, 8);

    // When — 예산 안이지만 여유가 없는 창 하나가 끼어들면 연속 기록이 끊긴다
    record(governor, 12, 15);
    record(governor, 24, 8);

    // Then
    expect(governor.qualityScale()).toBe(0.75);
  });

  it('counts a window sitting exactly on the recovery line as calm', () => {
    // Given — 한 단계 내려간 상태. 복귀 판정선은 예산의 70%다.
    const governor = createCosmosQualityGovernor();
    record(governor, 12, 24);
    expect(governor.qualityScale()).toBe(0.75);

    // When — 판정선에 정확히 걸친 창만 세 번. 경계는 복귀 쪽에 포함된다(70% 이하)
    record(governor, 36, BUDGET_MS * 0.7);

    // Then
    expect(governor.qualityScale()).toBe(1);
  });

  it('restarts the calm run when a window blows the budget outright', () => {
    // Given — 여유로운 창 두 개를 쌓아 복귀 직전까지 온 상태
    const governor = createCosmosQualityGovernor();
    record(governor, 12, 24);
    record(governor, 24, 8);

    // When — 예산을 넘긴 창이 끼어들면 한 단계 더 내려가고 연속 기록도 함께 끊긴다
    record(governor, 12, 24);
    expect(governor.qualityScale()).toBe(0.5);
    record(governor, 24, 8);

    // Then — 끊기지 않았다면 이미 올라갔을 창 수지만, 아직 두 창밖에 못 쌓았다
    expect(governor.qualityScale()).toBe(0.5);
  });

  it('stays at full quality no matter how long the calm run continues', () => {
    // Given — 이미 최고 화질
    const governor = createCosmosQualityGovernor();

    // When — 복귀 조건을 두 번 채우고도 남을 만큼 여유로운 창이 이어진다
    record(governor, 72, 8);

    // Then — 위로는 더 갈 곳이 없다. 단계를 넘어서면 배열 밖으로 나가 최저 화질로 떨어진다
    expect(governor.qualityScale()).toBe(1);
  });

  it('settles instead of flapping when the lowered quality only barely fits', () => {
    // Given — 최고 화질은 예산을 넘고, 한 단계 낮추면 예산 안이지만 여유는 없는 기기.
    // 여유 없는 통과만으로 되돌리는 governor라면 두 단계 사이를 영원히 오간다.
    const governor = createCosmosQualityGovernor();
    const frameCostFor = (scale: number): number => (scale === 1 ? 20 : 15);

    // When
    const observed: number[] = [];
    for (let window = 0; window < 60; window += 1) {
      record(governor, 12, frameCostFor(governor.qualityScale()));
      observed.push(governor.qualityScale());
    }

    // Then
    expect(observed[0]).toBe(0.75);
    expect(new Set(observed)).toEqual(new Set([0.75]));
  });

  it('settles when the top step is the very thing that blows the budget', () => {
    // Given — 낮춘 단계에서는 예산에 한참 여유가 있지만, 최고 화질로 올리는 순간
    // 그 화질 자체가 예산을 넘는 기기. 여유선과 연속 조건만으로는 올렸다 내렸다를
    // 영원히 반복한다 — 여유는 진짜지만 그 여유가 올라간 뒤에는 남아 있지 않다.
    const governor = createCosmosQualityGovernor();
    const frameCostFor = (scale: number): number => (scale === 1 ? 20 : 8);

    // When
    const observed: number[] = [];
    for (let window = 0; window < 60; window += 1) {
      record(governor, 12, frameCostFor(governor.qualityScale()));
      observed.push(governor.qualityScale());
    }

    // Then — 한 번 시험해 보고 안 되면 그 단계는 접는다. 끝에서는 한 값으로 굳는다
    expect(new Set(observed.slice(-20))).toEqual(new Set([0.75]));
  });

  it('retries a step when a single stray frame spoiled the promotion window', () => {
    // Given — 여유가 이어져 최고 화질로 올라간 직후
    const governor = createCosmosQualityGovernor();
    record(governor, 12, 24);
    record(governor, 36, 8);
    expect(governor.qualityScale()).toBe(1);

    // When — 승격 첫 창에 느린 프레임이 하나 섞인다. 올린 순간 canvas와 블룸 버퍼를
    // 더 큰 크기로 다시 잡으므로 전환 비용 자체가 여기 섞이고, GC 멈춤도 마찬가지다.
    // p95는 12표본의 최댓값이라 이 한 프레임이 창 전체를 떨어뜨린다.
    record(governor, 11, 8);
    governor.recordFrame(40, BUDGET_MS);
    expect(governor.qualityScale()).toBe(0.75);

    // 그 뒤로는 계속 여유롭다 — 이 단계가 안 맞는 게 아니었다
    record(governor, 36, 8);

    // Then — 단발성 지연 한 번을 영구 증거로 쓰면 #506이 그대로 되돌아온다
    expect(governor.qualityScale()).toBe(1);
  });

  it('does not carry a failure over to a different step', () => {
    // Given — 최고 단계 승격이 한 번 실패한 뒤(기록 1회), 승격과 무관하게 더 내려간다
    const governor = createCosmosQualityGovernor();
    record(governor, 12, 24);
    record(governor, 36, 8);
    record(governor, 12, 24);
    expect(governor.qualityScale()).toBe(0.75);
    record(governor, 12, 24);
    expect(governor.qualityScale()).toBe(0.5);

    // When — 이제 한 단계 아래를 시험한다. 앞의 실패는 다른 단계의 일이다
    record(governor, 36, 8);
    record(governor, 12, 24);
    record(governor, 36, 8);

    // Then — 서로 다른 두 단계의 실패를 합쳐 한계로 굳히면 안 된다
    expect(governor.qualityScale()).toBe(0.75);
  });

  it('does not carry a failure across a promotion that proved itself', () => {
    // Given — 바닥까지 내려간 뒤 0.75 승격이 첫 창에서 한 번 미끄러진다
    const governor = createCosmosQualityGovernor();
    record(governor, 24, 40);
    expect(governor.qualityScale()).toBe(0.5);
    record(governor, 36, 8);
    expect(governor.qualityScale()).toBe(0.75);
    record(governor, 12, 24);
    expect(governor.qualityScale()).toBe(0.5);

    // When — 다시 올라간 0.75는 첫 창을 무사히 넘겨 검증되고, 여유가 이어져 1.0까지 간다
    record(governor, 36, 8);
    expect(governor.qualityScale()).toBe(0.75);
    record(governor, 12, 8);
    record(governor, 24, 8);
    expect(governor.qualityScale()).toBe(1);

    // 그리고 1.0이 첫 창에서 미끄러진다 — 이 단계로서는 첫 실패다
    record(governor, 12, 24);
    expect(governor.qualityScale()).toBe(0.75);
    record(governor, 36, 8);

    // Then — 0.75의 지난 실패와 합산해 1.0을 세션 내내 금지하면 안 된다
    expect(governor.qualityScale()).toBe(1);
  });

  it('does not count a late stall as the verdict on an earlier promotion', () => {
    // Given — 최고 단계가 첫 창을 통과해 검증된 뒤, 한참 뒤의 멈춤으로 한 번 내려온다
    const governor = createCosmosQualityGovernor();
    record(governor, 12, 24);
    record(governor, 36, 8);
    expect(governor.qualityScale()).toBe(1);
    record(governor, 12, 8);
    record(governor, 12, 24);
    expect(governor.qualityScale()).toBe(0.75);

    // When — 다시 올라간 뒤 첫 창에서 미끄러진다. 이 단계로서는 첫 실패여야 한다
    record(governor, 36, 8);
    expect(governor.qualityScale()).toBe(1);
    record(governor, 12, 24);
    expect(governor.qualityScale()).toBe(0.75);
    record(governor, 36, 8);

    // Then — 지난 멈춤까지 승격 판정으로 세면 두 번째 실패가 되어 1.0이 금지된다
    expect(governor.qualityScale()).toBe(1);
  });

  it('does not cap the ceiling when stalls arrive long after the step proved itself', () => {
    // Given
    const governor = createCosmosQualityGovernor();
    record(governor, 12, 24);

    // When — 검증을 마친 단계에서 한참 뒤의 멈춤을 두 번 겪는다. 승격 직후의 판정이
    // 아니므로 몇 번을 겪든 실패 기록으로 쌓여선 안 된다.
    for (let cycle = 0; cycle < 2; cycle += 1) {
      record(governor, 36, 8);
      expect(governor.qualityScale()).toBe(1);
      // 올린 단계가 한 창을 무사히 넘겨 검증된다
      record(governor, 12, 8);
      // 그러고 한참 뒤에 찾아온 멈춤. 내려가긴 해도 한계로 기억되진 않는다
      record(governor, 12, 24);
      expect(governor.qualityScale()).toBe(0.75);
    }
    record(governor, 36, 8);

    // Then — 그러지 않으면 #506(한 번 내려가면 세션 내내 복귀 없음)이 되돌아온다
    expect(governor.qualityScale()).toBe(1);
  });
});
