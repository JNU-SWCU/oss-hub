import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { apiPath } from '@/lib/api-client';
import type { MilestoneDocumentCollectionHistory } from './milestone-document-collection-api';
import { MilestoneDocumentHistoryTimeline } from './milestone-document-history-timeline';

const FILE_DOWNLOAD_URL = apiPath('submission-files/file-1');

const history: readonly MilestoneDocumentCollectionHistory[] = [
  {
    event: 'SUBMITTED',
    revision: 1,
    actorNickname: 'synthetic-student',
    comment: null,
    createdAt: '2026-09-16T14:22:00.000Z',
    fileName: null,
    downloadUrl: null,
    content: { type: 'TEXT', text: '합성 제출 내용' },
  },
];

describe('MilestoneDocumentHistoryTimeline', () => {
  it('여러 제출 항목의 제목 id와 aria-labelledby가 서로 겹치지 않는다', () => {
    const html = renderToStaticMarkup(
      <>
        <MilestoneDocumentHistoryTimeline
          history={history}
          completeness="complete"
        />
        <MilestoneDocumentHistoryTimeline
          history={history}
          completeness="complete"
        />
      </>,
    );
    const labelledBy = [...html.matchAll(/aria-labelledby="([^"]+)"/g)].map(
      (match) => match[1],
    );

    expect(labelledBy).toHaveLength(2);
    expect(new Set(labelledBy).size).toBe(2);
    for (const id of labelledBy) expect(html).toContain(`id="${id}"`);
  });

  it('남은 이전 페이지가 있으면 앞 제출본이 유실되었다고 단정하지 않는다', () => {
    const html = renderToStaticMarkup(
      <MilestoneDocumentHistoryTimeline
        completeness="has-more"
        history={[
          {
            event: 'RESUBMITTED',
            revision: 4,
            actorNickname: '학생',
            comment: null,
            createdAt: '2026-09-16T14:22:00.000Z',
            fileName: null,
            downloadUrl: null,
          },
        ]}
      />,
    );

    expect(html).not.toContain('1~3차 제출본은 남아 있지 않아');
  });

  it('완전한 이력에서만 실제 이전 제출본 유실을 알린다', () => {
    const html = renderToStaticMarkup(
      <MilestoneDocumentHistoryTimeline
        completeness="complete"
        history={[
          {
            event: 'RESUBMITTED',
            revision: 4,
            actorNickname: '학생',
            comment: null,
            createdAt: '2026-09-16T14:22:00.000Z',
            fileName: null,
            downloadUrl: null,
          },
        ]}
      />,
    );

    expect(html).toContain(
      '1~3차 제출본은 남아 있지 않아 이 목록에 나오지 않습니다. 그 제출본이 필요하면 프로그램 담당자에게 문의해 주세요.',
    );
  });

  it('cursor를 모두 읽어도 원장 완전성이 false면 별도 누락 안내를 한다', () => {
    const html = renderToStaticMarkup(
      <MilestoneDocumentHistoryTimeline
        completeness="incomplete"
        history={history}
      />,
    );

    expect(html).toContain(
      '지난 제출본 가운데 일부는 남아 있지 않아 이 목록에 나오지 않습니다. 그 제출본이 필요하면 프로그램 담당자에게 문의해 주세요.',
    );
  });

  it('원장 행이 하나도 없는 legacy 제출도 누락 안내를 숨기지 않는다', () => {
    const html = renderToStaticMarkup(
      <MilestoneDocumentHistoryTimeline
        completeness="incomplete"
        history={[]}
      />,
    );

    expect(html).toContain('지난 제출본 가운데 일부는 남아 있지 않아');
  });

  it('살아 있는 첨부는 이름 대신 내려받기 링크로 그린다', () => {
    const html = renderToStaticMarkup(
      <MilestoneDocumentHistoryTimeline
        completeness="complete"
        history={[
          {
            event: 'SUBMITTED',
            revision: 1,
            actorNickname: '학생',
            comment: null,
            createdAt: '2026-09-16T14:22:00.000Z',
            fileName: '1차_계획서.pdf',
            downloadUrl: FILE_DOWNLOAD_URL,
          },
        ]}
      />,
    );

    expect(html).toContain(`href="${FILE_DOWNLOAD_URL}"`);
    expect(html).toContain('download="1차_계획서.pdf"');
    expect(html).toContain('1차_계획서.pdf');
  });

  it('보관 기한이 지난 첨부는 이름만 남기고 죽은 버튼을 세우지 않는다', () => {
    const html = renderToStaticMarkup(
      <MilestoneDocumentHistoryTimeline
        completeness="complete"
        history={[
          {
            event: 'SUBMITTED',
            revision: 1,
            actorNickname: '학생',
            comment: null,
            createdAt: '2026-09-16T14:22:00.000Z',
            fileName: '만료된_계획서.pdf',
            downloadUrl: null,
          },
        ]}
      />,
    );

    expect(html).toContain('만료된_계획서.pdf');
    expect(html).not.toContain('<a ');
  });
});

/*
 * 이 문구는 학생과 교직원이 같은 자리에서 함께 읽는다. 한 번 사용자의 말로 옮긴 뒤에는
 * 조용히 내부 사정 어휘(이관·당시 시스템·접수 기록)로 되돌아가지 않도록 전문을 못 박는다.
 * 사실 자체가 바뀌면 이 테스트도 함께 고쳐야 한다 — 문장을 상수로 빼지 않는 이유가 그것이다.
 */
describe('남지 않은 앞 제출본 안내 문구', () => {
  const missingEarlierSubmissions: readonly MilestoneDocumentCollectionHistory[] =
    [
      {
        event: 'RESUBMITTED',
        revision: 4,
        actorNickname: '학생',
        comment: null,
        createdAt: '2026-09-16T14:22:00.000Z',
        fileName: null,
        downloadUrl: null,
      },
    ];

  it('차수를 아는 경우 무엇이 없는지와 무엇을 하면 되는지를 그 순서로 말한다', () => {
    const html = renderToStaticMarkup(
      <MilestoneDocumentHistoryTimeline
        completeness="complete"
        history={missingEarlierSubmissions}
      />,
    );

    expect(html).toContain(
      '1~3차 제출본은 남아 있지 않아 이 목록에 나오지 않습니다. 그 제출본이 필요하면 프로그램 담당자에게 문의해 주세요.',
    );
  });

  it('차수를 모르는 경우에도 같은 순서와 같은 어휘로 말한다', () => {
    const html = renderToStaticMarkup(
      <MilestoneDocumentHistoryTimeline
        completeness="incomplete"
        history={history}
      />,
    );

    expect(html).toContain(
      '지난 제출본 가운데 일부는 남아 있지 않아 이 목록에 나오지 않습니다. 그 제출본이 필요하면 프로그램 담당자에게 문의해 주세요.',
    );
  });

  it('한 차수만 없으면 「1~1차」로 쓰지 않는다', () => {
    const html = renderToStaticMarkup(
      <MilestoneDocumentHistoryTimeline
        completeness="complete"
        history={[{ ...missingEarlierSubmissions[0]!, revision: 2 }]}
      />,
    );

    expect(html).toContain('1차 제출본은 남아 있지 않아');
    expect(html).not.toContain('1~1차');
  });

  it('읽는 사람에게 없는 내부 사정 어휘를 쓰지 않는다', () => {
    const html = [
      renderToStaticMarkup(
        <MilestoneDocumentHistoryTimeline
          completeness="complete"
          history={missingEarlierSubmissions}
        />,
      ),
      renderToStaticMarkup(
        <MilestoneDocumentHistoryTimeline
          completeness="incomplete"
          history={history}
        />,
      ),
    ].join('');

    for (const internalTerm of [
      '이관',
      '당시 시스템',
      '접수 기록',
      '제출 원문',
      '원장',
    ]) {
      expect(html).not.toContain(internalTerm);
    }
  });
});
