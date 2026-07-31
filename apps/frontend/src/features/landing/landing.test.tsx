import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ClosingCtaSection } from './components/closing-cta-section';
import {
  CurrentProgramSection,
  CurrentProgramSectionView,
  resolveProgramLoadFailure,
} from './components/current-program-section';
import { LandingFooter } from './components/landing-footer';
import { LandingJourney } from './components/landing-journey';
import { ProgramFlowSection } from './components/program-flow-section';

// CSS module 클래스명은 vitest에서 해시(`_panel_417db4`)로 바뀌므로
// 클래스 대신 data-panel / id / 텍스트로만 단언한다.
const renderJourney = (
  props: Partial<Parameters<typeof LandingJourney>[0]> = {},
): string =>
  renderToStaticMarkup(
    <LandingJourney
      primaryAction={<a href="/login">GitHub으로 로그인</a>}
      {...props}
    />,
  );

// 랜딩의 우주 여정/진행 프로그램/참여 흐름/하단 CTA/푸터가
// 실제로 render 가능함을 증명하는 최소 스모크 테스트.
describe('landing page sections', () => {
  it('renders all five journey panels of the cosmos scroll experience', () => {
    const html = renderJourney();

    expect(html).toContain('id="landing-journey"');
    for (const index of [0, 1, 2, 3, 4]) {
      expect(html).toContain(`data-panel="${index}"`);
    }
    // 각 패널은 aria-labelledby로 이름을 갖는 region이어야 한다.
    expect(html).toContain('aria-labelledby="landing-hero-heading"');
    expect(html).toContain('aria-labelledby="landing-program-heading"');
    expect(html).toContain('aria-labelledby="landing-flow-heading"');
    expect(html).toContain('aria-labelledby="landing-activity-heading"');
    expect(html).toContain('aria-labelledby="landing-entry-heading"');
  });

  it('renders exactly one h1 carrying the landing hero heading id', () => {
    const html = renderJourney();

    expect(html.match(/<h1[^>]*>/g)).toHaveLength(1);
    expect(html).toContain('<h1 id="landing-hero-heading">');
    expect(html).toContain('흩어진 정보를 한 곳으로');
  });

  it('renders the primary action and the programs link in the journey', () => {
    const html = renderJourney();

    expect(html).toContain('GitHub으로 로그인');
    expect(html).toContain('href="/login"');
    expect(html).toContain('href="/programs"');
    expect(html).toContain('프로그램 둘러보기');
  });

  it('lets the journey skip link point at the content anchor below the journey', () => {
    const html = renderJourney();

    expect(html).toContain('href="#landing-entry"');
    expect(html).toContain('로그인·프로그램 정보로 건너뛰기');
  });

  it('renders the legend, the progress ticks and the scroll hint', () => {
    const html = renderJourney();

    // 색 외에 텍스트 라벨로도 세 노드 유형을 구분한다.
    expect(html).toContain('학생');
    expect(html).toContain('저장소');
    expect(html).toContain('프로그램');
    expect(html).toContain('예시 구성');
    expect(html).toContain('aria-label="소개 진행 상태"');
    expect(html.match(/단계<\/span>/g)).toHaveLength(5);
    expect(html).toContain('SCROLL');
  });

  it('renders the journey auth error alert with hero danger color, not the light-surface destructive variant', () => {
    const html = renderJourney({
      authErrorMessage:
        '로그인 요청을 완료하지 못했습니다. 다시 시도해 주세요.',
      primaryAction: <span>GitHub 로그인 다시 시도</span>,
    });

    expect(html).toContain('role="alert"');
    expect(html).toContain('로그인 요청을 완료하지 못했습니다');
    expect(html).toContain('text-hero-danger');
    expect(html).not.toContain('text-destructive');
  });

  it('renders a status notice instead of the alert when only a notice is passed', () => {
    const html = renderJourney({ notice: <>다시 로그인할 수 있습니다.</> });

    expect(html).toContain('role="status"');
    expect(html).toContain('다시 로그인할 수 있습니다.');
    expect(html).not.toContain('role="alert"');
  });

  it('keeps the rejected metaphor copy out of the journey', () => {
    const html = renderJourney();

    for (const rejected of [
      '별처럼 이어지는 곳',
      '나의 별자리',
      '성운',
      '별무리',
      '자산으로 쌓인다',
      '개발 패널',
    ]) {
      expect(html, `${rejected} 문구가 남아 있습니다`).not.toContain(rejected);
    }
  });

  it('renders the current program section with a real destination', () => {
    const html = renderToStaticMarkup(<CurrentProgramSection />);

    expect(html).toContain('현재 모집 중인 프로그램');
    expect(html).toContain('href="/programs"');
    expect(html).toContain('break-keep');
    expect(html).not.toContain('함께 열 수 있는 프로그램 유형');
  });

  it('renders public recruiting program data as detail links', () => {
    const html = renderToStaticMarkup(
      <CurrentProgramSectionView
        state={{
          kind: 'ready',
          source: 'public',
          programs: [
            {
              id: 'program_public_01',
              name: '공개 OSS 기여 프로그램',
              organizer: 'JNU-SWCU',
              category: 'OSS_CONTEST',
              applicationEndAt: '2026-08-14T00:00:00.000Z',
            },
          ],
        }}
      />,
    );

    expect(html).toContain('공개 OSS 기여 프로그램');
    expect(html).toContain('href="/programs/program_public_01"');
    expect(html).toContain('2026년 8월 14일 마감');
  });

  it('renders the program flow section with the step-by-step flow', () => {
    const html = renderToStaticMarkup(<ProgramFlowSection />);

    expect(html).toContain('참여부터 기록까지 한 흐름으로 연결됩니다');
    expect(html).toContain('01');
    expect(html).toContain('요구사항에 맞춰 제출합니다.');
    expect(html).not.toContain('요구사항을 확인한 뒤 결과물을 제출합니다.');
    expect(html).not.toContain('결과를 공개 아카이브에 남깁니다.');
    expect(html).not.toContain('활동이 실시간으로 보여요');
    expect(html).toContain('sm:grid-cols-2');
    expect(html).toContain('lg:grid-cols-4');
    expect(html).toContain('break-keep');
  });

  it('renders the closing CTA section with the GitHub login link', () => {
    const html = renderToStaticMarkup(
      <ClosingCtaSection action={<a href="/login">GitHub으로 로그인</a>} />,
    );

    expect(html).toContain('프로그램 참여와 제출 현황을 확인하세요');
    expect(html).toContain('href="/login"');
  });

  // <section>은 aria-labelledby로 이름이 있어야 ARIA region 랜드마크로 노출된다.
  // 이름이 없으면 스크린리더 랜드마크 목록에서 사라지므로, 세 섹션 모두
  // aria-labelledby와 그 값을 id로 갖는 제목이 함께 렌더되는지 잠근다.
  it('renders each landing section as a named region landmark', () => {
    const sections = [
      {
        name: 'CurrentProgramSection',
        html: renderToStaticMarkup(<CurrentProgramSection />),
      },
      {
        name: 'ProgramFlowSection',
        html: renderToStaticMarkup(<ProgramFlowSection />),
      },
      {
        name: 'ClosingCtaSection',
        html: renderToStaticMarkup(
          <ClosingCtaSection action={<a href="/login">GitHub으로 로그인</a>} />,
        ),
      },
    ];

    for (const { name, html } of sections) {
      const match = /<section[^>]*aria-labelledby="([^"]+)"/.exec(html);
      expect(match, `${name}에 aria-labelledby가 없습니다`).not.toBeNull();

      const headingId = match?.[1];
      expect(html).toContain(`id="${headingId}"`);
    }
  });

  it('renders the current program list with ul/li list semantics', () => {
    const html = renderToStaticMarkup(
      <CurrentProgramSectionView
        state={{
          kind: 'ready',
          source: 'public',
          programs: [
            {
              id: 'program_public_01',
              name: '공개 OSS 기여 프로그램',
              organizer: 'JNU-SWCU',
              category: 'OSS_CONTEST',
              applicationEndAt: '2026-08-14T00:00:00.000Z',
            },
          ],
        }}
      />,
    );

    expect(html).toContain('<ul');
    expect(html).toContain('<li');
  });

  it('labels local fallback programs as example data', () => {
    const html = renderToStaticMarkup(
      <CurrentProgramSectionView
        state={{
          kind: 'ready',
          source: 'example',
          programs: [
            {
              id: 'program-capstone',
              name: '캡스톤 2026',
              organizer: '전남대학교 SW중심대학사업단',
              category: 'CAPSTONE',
              applicationEndAt: '2026-08-10T23:59:59.000+09:00',
            },
          ],
        }}
      />,
    );

    expect(html).toContain('로컬 예시 데이터');
    expect(html).toContain('href="/programs/program-capstone"');
  });

  it('renders labeled example cards when a development localhost program request fails', () => {
    const state = resolveProgramLoadFailure({
      allowLocalExamples: true,
      hostname: 'localhost',
    });
    const html = renderToStaticMarkup(<CurrentProgramSectionView state={state} />);

    expect(html).toContain('로컬 예시 데이터');
    expect(html).toContain('캡스톤 2026');
    expect(html).toContain('href="/programs/program-capstone"');
    expect(html).not.toContain('모집 정보를 불러오지 못했습니다');
  });

  it('does not expose local program examples on a remote hostname', () => {
    expect(
      resolveProgramLoadFailure({
        allowLocalExamples: true,
        hostname: 'oss-hub.example.com',
      }),
    ).toEqual({ kind: 'error' });
  });

  it('renders the footer with copyright and policy links', () => {
    const html = renderToStaticMarkup(<LandingFooter />);

    expect(html).toContain('전남대학교 SW중심대학사업단');
    expect(html).toContain('href="/consent"');
  });
});
