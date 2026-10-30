import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CurrentProgramSection } from './components/current-program-section';
describe('server supplied recruiting programs', () => {
  it('renders the current program section with a real destination', () => {
    const html = renderToStaticMarkup(<CurrentProgramSection programs={[]} />);

    expect(html).toContain('현재 모집 중인 프로그램');
    expect(html).toContain('href="/programs"');
    expect(html).toContain('break-keep');
    expect(html).not.toContain('함께 열 수 있는 프로그램 유형');
  });

  it('renders public recruiting program data as detail links', () => {
    const html = renderToStaticMarkup(
      <CurrentProgramSection
        programs={[
          {
            id: 'program_public_01',
            name: '공개 OSS 기여 프로그램',
            organizer: 'JNU-SWCU',
            trackType: 'EXTRACURRICULAR',
            applicationEndAt: '2026-08-14T00:00:00.000Z',
          },
        ]}
      />,
    );

    expect(html).toContain('공개 OSS 기여 프로그램');
    expect(html).toContain('href="/programs/program_public_01"');
    expect(html).toContain('2026년 8월 14일 마감');
  });

  it('shows the deadline in Seoul time so server and browser render the same day', () => {
    const html = renderToStaticMarkup(
      <CurrentProgramSection
        programs={[
          {
            id: 'program_public_02',
            name: '마감 경계 프로그램',
            organizer: 'JNU-SWCU',
            trackType: 'EXTRACURRICULAR',
            applicationEndAt: '2026-11-15T15:30:00.000Z',
          },
        ]}
      />,
    );

    expect(html).toContain('2026년 11월 16일 마감');
  });

  it('encodes seed-style program ids in detail links', () => {
    const html = renderToStaticMarkup(
      <CurrentProgramSection
        programs={[
          {
            id: 'seed:intake:program-capstone',
            name: '캡스톤 시드',
            organizer: 'seed-organizer',
            trackType: 'CURRICULAR',
            applicationEndAt: '2026-08-14T00:00:00.000Z',
          },
        ]}
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
      <CurrentProgramSection
        programs={[
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
        ]}
      />,
    );

    expect(html).toContain(
      'src="/api/v1/programs/program_owned_cover/cover/cover_01"',
    );
    expect(html).toContain(`src="${external}"`);
  });

  it('renders the current program list with ul/li list semantics', () => {
    const html = renderToStaticMarkup(
      <CurrentProgramSection
        programs={[
          {
            id: 'program_public_01',
            name: '공개 OSS 기여 프로그램',
            organizer: 'JNU-SWCU',
            trackType: 'EXTRACURRICULAR',
            applicationEndAt: '2026-08-14T00:00:00.000Z',
          },
        ]}
      />,
    );

    expect(html).toContain('<ul');
    expect(html).toContain('<li');
  });

  it('renders an empty list when no recruiting programs are supplied', () => {
    const programs: readonly [] = [];

    const html = renderToStaticMarkup(
      <CurrentProgramSection programs={programs} />,
    );

    expect(html).not.toContain('<li');
    expect(html).toContain('href="/programs"');
  });
});
