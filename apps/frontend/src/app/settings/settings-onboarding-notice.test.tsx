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

  it('문장마다 통째로 줄을 넘기는 상자를 두고, 그 사이에 줄바꿈 자리를 남긴다', () => {
    const html = renderToStaticMarkup(<SettingsOnboardingNotice />);

    for (const sentence of SETTINGS_ONBOARDING_NOTICE_SENTENCES) {
      expect(html).toContain(`<span class="inline-block">${sentence}</span>`);
    }

    expect(html).toContain('</span> <span');
  });

  it('막연한 권한 문구로 끝내지 않는다', () => {
    const html = renderToStaticMarkup(<SettingsOnboardingNotice />);

    expect(html).not.toContain('권한이 없');
  });

  it('되돌아간다고 말하지 않는다', () => {
    expect(SETTINGS_ONBOARDING_NOTICE_BODY).not.toContain('이동');
  });

  it('화면이 바뀌는 것을 보조기술에도 알린다', () => {
    const html = renderToStaticMarkup(<SettingsOnboardingNotice />);

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });

  it('학번을 고칠 수 있다고 말하지 않는다 — 처음 채우는 것뿐이다', () => {
    expect(SETTINGS_ONBOARDING_NOTICE_BODY).toContain('학번');
    expect(SETTINGS_ONBOARDING_NOTICE_BODY).not.toMatch(/학번[^.]*고칠/);
    expect(SETTINGS_ONBOARDING_NOTICE_BODY).not.toMatch(/학번[^.]*수정/);
    expect(SETTINGS_ONBOARDING_NOTICE_BODY).toMatch(/학번[^.]*한 번만 입력/);
  });

  it('줄이 갈라지면 끊겨 읽히는 `~할 수 있습니다`를 쓰지 않는다', () => {
    expect(SETTINGS_ONBOARDING_NOTICE_BODY).not.toContain('수 있습니다');
  });

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
