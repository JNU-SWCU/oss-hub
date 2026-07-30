import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  ONBOARDING_STEPS,
  OnboardingProgress,
  type OnboardingStep,
} from './onboarding-progress';

const STEPS: OnboardingStep[] = [1, 2, 3];

describe('OnboardingProgress', () => {
  it.each(STEPS)('%i단계에서 전체 대비 현재 위치를 문장으로 알린다', (step) => {
    const html = renderToStaticMarkup(<OnboardingProgress current={step} />);

    expect(html).toContain(`${ONBOARDING_STEPS.length}단계 중 ${step}단계`);
    expect(html).toContain(ONBOARDING_STEPS[step - 1]);
  });

  it('모든 단계 이름을 함께 보여준다 — 남은 단계가 무엇인지 알 수 있어야 한다', () => {
    const html = renderToStaticMarkup(<OnboardingProgress current={1} />);

    for (const label of ONBOARDING_STEPS) {
      expect(html).toContain(label);
    }
  });

  it.each(STEPS)(
    '%i단계를 aria-current="step"으로 한 곳만 표시한다',
    (step) => {
      const html = renderToStaticMarkup(<OnboardingProgress current={step} />);

      expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    },
  );

  // 완료 여부를 색으로만 구분하면 색각 이상 사용자에게 전달되지 않는다.
  it('완료된 단계에는 텍스트 대안을 붙인다', () => {
    const first = renderToStaticMarkup(<OnboardingProgress current={1} />);
    const last = renderToStaticMarkup(<OnboardingProgress current={3} />);

    expect(first).not.toContain('완료');
    expect(last.match(/완료/g)).toHaveLength(ONBOARDING_STEPS.length - 1);
  });

  it('진행 표시임을 이름으로 알린다', () => {
    const html = renderToStaticMarkup(<OnboardingProgress current={2} />);

    expect(html).toContain('aria-label="가입 진행 단계"');
  });
});
