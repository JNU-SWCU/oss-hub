import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  SETTINGS_ONBOARDING_NOTICE_BODY,
  SETTINGS_ONBOARDING_NOTICE_HEADING,
  SETTINGS_ONBOARDING_NOTICE_SENTENCES,
  SettingsOnboardingNotice,
} from './settings-onboarding-notice';

describe('SettingsOnboardingNotice', () => {
  it('무엇을 할 수 있는지 말한다', () => {
    const html = renderToStaticMarkup(<SettingsOnboardingNotice />);

    expect(html).toContain(SETTINGS_ONBOARDING_NOTICE_HEADING);
    for (const sentence of SETTINGS_ONBOARDING_NOTICE_SENTENCES) {
      expect(html).toContain(sentence);
    }
    expect(SETTINGS_ONBOARDING_NOTICE_HEADING).toContain('가입');
  });

  /**
   * 줄이 바뀌는 자리를 문장 경계로 고정하는 장치다. 문장을 그냥 이어 붙이면 폭에 따라
   * 문장 한가운데가 갈리고, 375px에서 신고된 증상(`고칠 수` / `있습니다`)이 다른
   * 자리에서 되살아난다.
   */
  it('문장마다 통째로 줄을 넘기는 상자를 두고, 그 사이에 줄바꿈 자리를 남긴다', () => {
    const html = renderToStaticMarkup(<SettingsOnboardingNotice />);

    for (const sentence of SETTINGS_ONBOARDING_NOTICE_SENTENCES) {
      expect(html).toContain(`<span class="inline-block">${sentence}</span>`);
    }
    // 상자 사이의 진짜 공백이 유일한 줄바꿈 자리다 — 없으면 세 문장이 넘친다.
    expect(html).toContain('</span> <span');
  });

  // "권한이 없습니다"는 사용자가 다음에 무엇을 할지 알려주지 않는다.
  it('막연한 권한 문구로 끝내지 않는다', () => {
    const html = renderToStaticMarkup(<SettingsOnboardingNotice />);

    expect(html).not.toContain('권한이 없');
  });

  // 화면을 열어 주는 안내로 바뀐 뒤로는 "이동합니다"가 거짓말이다.
  it('되돌아간다고 말하지 않는다', () => {
    expect(SETTINGS_ONBOARDING_NOTICE_BODY).not.toContain('이동');
  });

  it('화면이 바뀌는 것을 보조기술에도 알린다', () => {
    const html = renderToStaticMarkup(<SettingsOnboardingNotice />);

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });

  /**
   * 같은 화면의 학번 입력란이 "한 번 저장하면 변경할 수 없습니다"라고 말한다. 안내가
   * 학번을 "고칠 수 있다"고 하면 두 문장이 서로를 부정하고, 저장된 학번을 고치러 들어온
   * 사용자는 잠긴 칸을 고장으로 읽는다. 처음 채우는 것뿐임을 말해야 한다.
   */
  it('학번을 고칠 수 있다고 말하지 않는다 — 처음 채우는 것뿐이다', () => {
    expect(SETTINGS_ONBOARDING_NOTICE_BODY).toContain('학번');
    expect(SETTINGS_ONBOARDING_NOTICE_BODY).not.toMatch(/학번[^.]*고칠/);
    expect(SETTINGS_ONBOARDING_NOTICE_BODY).not.toMatch(/학번[^.]*수정/);
    expect(SETTINGS_ONBOARDING_NOTICE_BODY).toMatch(/학번[^.]*한 번만 입력/);
  });

  /**
   * 375px에서 이 안내가 `고칠 수` / `있습니다`로 갈라졌다. `수`는 홀로 설 수 없는
   * 의존명사라 줄이 바뀌면 문장이 끊겨 읽힌다. `break-keep`은 어절 안쪽만 막고 어절
   * 사이 띄어쓰기에서는 줄을 바꾸므로, 구절을 아예 쓰지 않아야 폭과 무관하게 성립한다.
   */
  it('줄이 갈라지면 끊겨 읽히는 `~할 수 있습니다`를 쓰지 않는다', () => {
    expect(SETTINGS_ONBOARDING_NOTICE_BODY).not.toContain('수 있습니다');
  });

  /**
   * 문장 상자는 자기보다 좁은 줄에서는 결국 안쪽에서 갈린다. 375px 기준 안내 폭이
   * 325px이고 가장 긴 문장이 226px였으니 여유는 있지만, 문장이 길어지면 그 여유가
   * 사라지고 장치가 조용히 무력해진다. 글자 수로 상한을 걸어 둔다.
   */
  it('문장 하나가 375px 한 줄을 넘길 만큼 길어지지 않는다', () => {
    expect(SETTINGS_ONBOARDING_NOTICE_SENTENCES.length).toBeGreaterThan(1);
    for (const sentence of SETTINGS_ONBOARDING_NOTICE_SENTENCES) {
      expect(sentence.length).toBeLessThanOrEqual(24);
    }
  });

  it('문장을 이어 붙인 본문은 그대로 한 문단으로도 읽힌다', () => {
    expect(SETTINGS_ONBOARDING_NOTICE_BODY).toBe(
      SETTINGS_ONBOARDING_NOTICE_SENTENCES.join(' '),
    );
  });
});
