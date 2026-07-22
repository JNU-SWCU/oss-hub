import { describe, expect, it, vi } from 'vitest';
import { installProgramExitGuard } from './program-exit-guard';

function createHarness(confirmExit = vi.fn(() => true)) {
  let popStateListener: (() => void) | null = null;
  const pushSentinel = vi.fn();
  const back = vi.fn();
  const navigate = vi.fn();
  const guard = installProgramExitGuard({
    pushSentinel,
    back,
    confirmExit,
    navigate,
    subscribePopState: (listener) => {
      popStateListener = listener;
      return () => {
        popStateListener = null;
      };
    },
  });
  return {
    guard,
    pushSentinel,
    back,
    navigate,
    confirmExit,
    dispatchPopState: () => popStateListener?.(),
    hasListener: () => popStateListener !== null,
  };
}

describe('program exit guard history lifecycle', () => {
  it('dirty에서 clean이 되면 sentinel을 접고 다음 browser back을 가로막지 않는다', () => {
    // Given
    const harness = createHarness();
    harness.guard.setDirty(true);

    // When
    harness.guard.setDirty(false);
    harness.dispatchPopState();
    harness.dispatchPopState();

    // Then
    expect(harness.pushSentinel).toHaveBeenCalledTimes(1);
    expect(harness.back).toHaveBeenCalledTimes(1);
    expect(harness.confirmExit).not.toHaveBeenCalled();
  });

  it('dirty-clean-dirty 뒤 취소해도 sentinel 한 개만 접고 이전 화면으로 이동한다', () => {
    // Given
    const harness = createHarness();
    harness.guard.setDirty(true);
    harness.guard.setDirty(false);
    harness.dispatchPopState();
    harness.guard.setDirty(true);

    // When
    const leaving = harness.guard.requestLeave();
    harness.dispatchPopState();

    // Then
    expect(leaving).toBe(true);
    expect(harness.pushSentinel).toHaveBeenCalledTimes(2);
    expect(harness.back).toHaveBeenCalledTimes(3);
  });

  it('저장 성공은 sentinel을 먼저 접고 상세 이동 후 browser back을 방해하지 않는다', () => {
    // Given
    const harness = createHarness();
    harness.guard.setDirty(true);

    // When
    harness.guard.completeAndNavigate('/programs/synthetic-program');
    harness.dispatchPopState();
    harness.guard.dispose();
    harness.dispatchPopState();

    // Then
    expect(harness.back).toHaveBeenCalledTimes(1);
    expect(harness.navigate).toHaveBeenCalledWith(
      '/programs/synthetic-program',
    );
    expect(harness.guard.isDirty()).toBe(false);
    expect(harness.hasListener()).toBe(false);
  });

  it('browser back 확인을 취소하면 현재 폼을 유지하고 sentinel을 복원한다', () => {
    // Given
    const confirmExit = vi.fn(() => false);
    const harness = createHarness(confirmExit);
    harness.guard.setDirty(true);

    // When
    harness.dispatchPopState();

    // Then
    expect(confirmExit).toHaveBeenCalledTimes(1);
    expect(harness.guard.isDirty()).toBe(true);
    expect(harness.pushSentinel).toHaveBeenCalledTimes(2);
    expect(harness.back).not.toHaveBeenCalled();
  });

  it('컴포넌트 이탈 시 활성 sentinel을 접은 뒤 listener를 제거한다', () => {
    // Given
    const harness = createHarness();
    harness.guard.setDirty(true);

    // When
    harness.guard.dispose();
    harness.dispatchPopState();

    // Then
    expect(harness.back).toHaveBeenCalledTimes(1);
    expect(harness.hasListener()).toBe(false);
  });
});
