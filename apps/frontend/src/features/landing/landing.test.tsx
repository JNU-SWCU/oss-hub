import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  CurrentProgramSection,
  CurrentProgramSectionView,
} from './components/current-program-section';
import { LandingFooter } from './components/landing-footer';
import { LandingJourney } from './components/landing-journey';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const renderJourney = (
  props: Partial<Parameters<typeof LandingJourney>[0]> = {},
): string =>
  renderToStaticMarkup(
    <LandingJourney
      primaryAction={<a href="/login">GitHub으로 로그인</a>}
      {...props}
    />,
  );

describe('landing page sections', () => {
  it('renders the hero followed by the three story sections', () => {
    const html = renderJourney();

    expect(html).toContain('id="landing-journey"');
    expect(html).toContain('id="landing-hero"');
    expect(html).toContain('aria-labelledby="landing-hero-heading"');
    expect(html).toContain('aria-labelledby="landing-program-heading"');
    expect(html).toContain('aria-labelledby="landing-flow-heading"');
    expect(html).toContain('aria-labelledby="landing-activity-heading"');
    expect(html.match(/<section/g)).toHaveLength(4);
    expect(html).not.toContain('landing-entry-heading');
    expect(html).not.toContain('data-panel=');
  });

  it('tags the hero and each chapter with the graph focus it drives', () => {
    const html = renderJourney();

    expect(html).toContain('data-focus="hero"');
    expect(html).toContain('data-focus="programs"');
    expect(html).toContain('data-focus="flow"');
    expect(html).toContain('data-focus="activity"');
    expect(html).toContain('data-tone="dawn"');
    expect(html.match(/<canvas /g)).toHaveLength(1);
  });

  it('keeps every dash out of the rendered landing copy', () => {
    const html = renderJourney({
      authErrorMessage: '로그인 요청을 완료하지 못했습니다.',
    });

    expect(html).not.toMatch(/[\u2014\u2013]/);
  });

  it('renders exactly one h1 carrying the landing hero heading id', () => {
    const html = renderJourney();

    expect(html.match(/<h1[^>]*>/g)).toHaveLength(1);
    expect(html).toContain('<h1 id="landing-hero-heading">');
    expect(html).toContain('흩어진 정보를 하나로');
    expect(html).toContain(
      'OSS Hub는 오픈소스 활동을 모아 역량으로 쌓아줍니다. 교내 활동, 팀 프로젝트, 대외 활동 등의 제출 및 검토를 간편하게 만들어줍니다.',
    );
  });

  it('renders the primary action once, beside the programs link in the hero', () => {
    const html = renderJourney();

    expect(html.match(/GitHub으로 로그인/g)).toHaveLength(1);
    expect(html.match(/href="\/login"/g)).toHaveLength(1);
    expect(html.match(/href="\/programs"/g)).toHaveLength(1);
    expect(html).toContain('프로그램 둘러보기');
  });

  it('lets the hero skip link point at the content anchor below the journey', () => {
    const html = renderJourney();

    expect(html).toContain('href="#current-programs"');
    expect(html).toContain('프로그램 정보로 건너뛰기');
    expect(html).not.toContain('로그인·프로그램 정보로 건너뛰기');
  });

  it('renders the three legend items without an example note, a hint or progress ticks', () => {
    const html = renderJourney();

    expect(html).toContain('학생');
    expect(html).toContain('저장소');
    expect(html).toContain('프로그램');
    expect(html).not.toContain('예시 구성');
    expect(html).not.toContain('끌어서 돌리고');
    expect(html).not.toContain('점을 누르면 열립니다');
    expect(html).not.toContain('소개 진행 상태');
    expect(html).not.toContain('단계</span>');
    expect(html).not.toContain('SCROLL');
  });

  it('renders the story sections with stats, flow steps and activity copy', () => {
    const html = renderJourney();

    expect(html).toContain('공개 프로그램');
    expect(html).toContain('공개 저장소');
    expect(html).toContain('공개 기여자');
    expect(html.match(/STEP \d/g)).toHaveLength(4);
    expect(html).toContain('모든 활동은 프로그램 단위로 묶입니다');
    expect(html).toContain(
      '경진대회·해커톤·기여 챌린지·스터디·세미나와 같은 프로그램들은 학생, 저장소와 연결되어 관리됩니다.',
    );
    expect(html).toContain('신청부터 공개까지, 하나의 흐름');
    expect(html).toContain(
      '익숙한 GitHub 위에서 신청, 협업, 검토가 끊김 없이 이어집니다.',
    );
    expect(html).toContain('신청·팀 구성');
    expect(html).toContain('초대를 수락해 팀에 합류');
    expect(html).toContain('저장소 연결');
    expect(html).toContain('승인되면 팀 저장소가 열림');
    expect(html).toContain('제출·검토');
    expect(html).toContain('마일스톤 단위로 교직원이 검토');
    expect(html).toContain('공개 아카이브');
    expect(html).toContain('연도별 아카이브에 남음');
    expect(html).toContain('참여 기록이 모두 남습니다');
    expect(html).toContain(
      '참여한 프로그램, 팀, 저장소, 제출 기록을 대시보드에서 확인합니다. 진행 중인 저장소는 팀과 교직원만 볼 수 있고, 공개는 검토 후 명시적 승인을 거칩니다.',
    );
  });

  it('serves the story sections visible: no reveal attribute in server markup', () => {
    const html = renderJourney();

    expect(html).not.toContain('data-reveal');
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
      /별처럼 이어지는 곳/,
      /(?<!하)나의 별자리/,
      /성운/,
      /별무리/,
      /자산으로 쌓인다/,
      /개발 패널/,
      /한 곳/,
      /오픈소스로 성장하는 곳/,
    ]) {
      expect(html, `${rejected.source} 문구가 남아 있습니다`).not.toMatch(
        rejected,
      );
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
          programs: [
            {
              id: 'program_public_01',
              name: '공개 OSS 기여 프로그램',
              organizer: 'JNU-SWCU',
              trackType: 'EXTRACURRICULAR',
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

  it('encodes seed-style program ids in detail links', () => {
    const html = renderToStaticMarkup(
      <CurrentProgramSectionView
        state={{
          kind: 'ready',
          programs: [
            {
              id: 'seed:intake:program-capstone',
              name: '캡스톤 시드',
              organizer: 'seed-organizer',
              trackType: 'CURRICULAR',
              applicationEndAt: '2026-08-14T00:00:00.000Z',
            },
          ],
        }}
      />,
    );

    expect(html).toContain('캡스톤 시드');
    expect(html).toContain(
      `href="/programs/${encodeURIComponent('seed:intake:program-capstone')}"`,
    );
  });

  it('shows owned and notice-imported covers on recruiting cards', () => {
    const external =
      'https://sojoong.kr/wp-content/uploads/kboard_attached/1/209901/synthetic-poster.png';
    const html = renderToStaticMarkup(
      <CurrentProgramSectionView
        state={{
          kind: 'ready',
          programs: [
            {
              id: 'program_owned_cover',
              name: '자체 이미지 프로그램',
              organizer: 'JNU-SWCU',
              trackType: 'EXTRACURRICULAR',
              applicationEndAt: '2026-08-14T00:00:00.000Z',
              coverImageUrl: '/programs/program_owned_cover/cover/cover_01',
            },
            {
              id: 'program_notice_cover',
              name: '공지 포스터 프로그램',
              organizer: 'JNU-SWCU',
              trackType: 'EXTRACURRICULAR',
              applicationEndAt: '2026-08-14T00:00:00.000Z',
              coverImageUrl: external,
            },
          ],
        }}
      />,
    );

    expect(html).toContain(
      'src="/api/v1/programs/program_owned_cover/cover/cover_01"',
    );
    expect(html).toContain(`src="${external}"`);
  });

  it('renders each landing section as a named region landmark', () => {
    const html = `${renderJourney()}${renderToStaticMarkup(<CurrentProgramSection />)}`;
    const landmarks = [
      ...html.matchAll(/<section[^>]*aria-labelledby="([^"]+)"/g),
    ];

    expect(landmarks).toHaveLength(5);
    for (const [, headingId] of landmarks) {
      expect(html).toContain(`id="${headingId}"`);
    }
  });

  it('renders the current program list with ul/li list semantics', () => {
    const html = renderToStaticMarkup(
      <CurrentProgramSectionView
        state={{
          kind: 'ready',
          programs: [
            {
              id: 'program_public_01',
              name: '공개 OSS 기여 프로그램',
              organizer: 'JNU-SWCU',
              trackType: 'EXTRACURRICULAR',
              applicationEndAt: '2026-08-14T00:00:00.000Z',
            },
          ],
        }}
      />,
    );

    expect(html).toContain('<ul');
    expect(html).toContain('<li');
  });

  it('renders the error state without example program cards', () => {
    const html = renderToStaticMarkup(
      <CurrentProgramSectionView state={{ kind: 'error' }} />,
    );

    expect(html).toContain('모집 정보를 불러오지 못했습니다');
    expect(html).toContain('프로그램 목록에서 확인하기');
    expect(html).not.toContain('로컬 예시 데이터');
    expect(html).not.toContain('캡스톤 2026');
  });

  it('renders the footer with copyright and policy links', () => {
    const html = renderToStaticMarkup(<LandingFooter />);

    expect(html).toContain('전남대학교 SW중심대학사업단');
    expect(html).toContain('href="/policies/privacy/2026-08-11.html"');
    expect(html).not.toContain('href="/consent"');
  });
});
