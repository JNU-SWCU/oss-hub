import { act } from 'react';
import { createListScreenRoot as createRoot } from '../../../../test-support/list-screen-root';
type Root = ReturnType<typeof createRoot>;
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProgramTeam } from './dto';
import { TeamRepositoryProvisioning } from './team-repository-provisioning';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

describe('TeamRepositoryProvisioning', () => {
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

  async function show(status: ProgramTeam['repositoryProvisioningStatus']) {
    await act(async () =>
      root.render(<TeamRepositoryProvisioning status={status} />),
    );
    return {
      steps: Array.from(container.querySelectorAll('li')).map(
        (item) => item.textContent,
      ),
      current: container.querySelector('[aria-current="step"]')?.textContent,
      text: container.textContent ?? '',
    };
  }

  it.each([
    ['PENDING', '저장소 생성대기 중'],
    ['PROCESSING', '저장소 생성생성 중'],
    ['FAILED_RETRYABLE', '저장소 생성재시도 대기'],
    ['FAILED_FINAL', '저장소 생성생성 실패'],
    ['ANOMALOUS', '저장소 생성확인 필요'],
  ] as const)(
    '%s 상태는 두 번째 단계에 상태 문구를 낸다',
    async (status, current) => {
      const view = await show(status);

      expect(view.steps).toEqual(['신청 승인', current, '사용 가능']);
      expect(view.current).toBe(current);
    },
  );

  it('완료되면 세 단계를 모두 끝낸 것으로 보이고 진행 중 표시를 없앤다', async () => {
    const view = await show('SUCCEEDED');

    expect(view.steps).toEqual(['신청 승인', '저장소 생성', '사용 가능']);
    expect(view.current).toBeUndefined();
    expect(view.text).not.toContain('운영진에게 문의');
  });

  it.each(['FAILED_FINAL', 'ANOMALOUS'] as const)(
    '%s 상태에서만 운영진 문의를 안내한다',
    async (status) => {
      expect((await show(status)).text).toContain('운영진에게 문의하세요.');
    },
  );

  it.each(['PENDING', 'PROCESSING', 'FAILED_RETRYABLE'] as const)(
    '%s 상태는 문의를 요구하지 않는다',
    async (status) => {
      expect((await show(status)).text).not.toContain('운영진에게 문의');
    },
  );

  it.each(['DISABLED', 'NOT_REQUESTED'] as const)(
    '%s 상태에서는 아무것도 그리지 않는다',
    async (status) => {
      expect((await show(status)).text).toBe('');
    },
  );
});
