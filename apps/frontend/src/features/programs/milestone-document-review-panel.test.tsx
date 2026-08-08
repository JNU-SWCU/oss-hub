import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  milestoneDocumentSubmissionFileHref,
  type MilestoneDocumentCollectionCell,
} from './milestone-document-collection-api';
import {
  MilestoneDocumentReviewPanel,
  type MilestoneDocumentReviewPanelProps,
} from './milestone-document-review-panel';

function cell(
  overrides: Partial<MilestoneDocumentCollectionCell> = {},
): MilestoneDocumentCollectionCell {
  return {
    documentId: 'd1',
    isSubmitted: true,
    submittedAt: '2026-07-28T00:00:00.000Z',
    file: null,
    review: null,
    ...overrides,
  };
}

/**
 * 이 문구를 감싼 요소의 여는 태그. 속성은 **그 태그에서 직접** 읽어야 한다 — 문서 전체를
 * `toContain('disabled')`으로 훑으면 남의 요소가 잠긴 것도 통과시킨다.
 */
function tagOf(html: string, label: string): string {
  const textIndex = html.indexOf(`>${label}<`);
  if (textIndex < 0) throw new Error(`문구를 찾지 못했습니다: ${label}`);
  return html.slice(html.lastIndexOf('<', textIndex), textIndex + 1);
}

function textareaTag(html: string): string {
  const found = /<textarea[^>]*>/.exec(html);
  if (found === null) throw new Error('사유 입력 칸을 찾지 못했습니다.');
  return found[0];
}

function render(
  overrides: Partial<MilestoneDocumentReviewPanelProps> = {},
): string {
  return renderToStaticMarkup(
    <MilestoneDocumentReviewPanel
      teamName="가팀"
      documentName="기획서"
      cell={cell()}
      fileHref={null}
      decision={null}
      comment=""
      isSubmitting={false}
      errorMessage={null}
      onDecisionChange={() => {}}
      onCommentChange={() => {}}
      onSubmit={() => {}}
      onClose={() => {}}
      {...overrides}
    />,
  );
}

describe('판정 패널 머리', () => {
  it('팀명과 서류명, 지금 상태, 제출 시각을 함께 적는다', () => {
    const html = render();

    expect(html).toContain('가팀 — 기획서');
    expect(html).toContain('검토 대기');
    expect(html).toContain('07.28 09:00 제출');
  });

  it('이미 판정된 칸이면 머리의 배지도 그 판정을 말한다', () => {
    const html = render({
      cell: cell({
        review: {
          decision: 'REJECTED',
          comment: '기한을 넘겼습니다.',
          reviewedAt: '2026-07-30T00:00:00.000Z',
        },
      }),
    });

    expect(html).toContain('반려');
    expect(html).not.toContain('검토 대기');
  });
});

describe('판정 패널의 파일', () => {
  it('첨부가 있으면 파일명과 내려받기를 준다', () => {
    // 경로는 지어내지 않고 계약이 만든 것을 그대로 쓴다(`/api/v1`의 소유자는 api-client다).
    const fileHref = milestoneDocumentSubmissionFileHref('m1', 'd1', 'a1');
    const html = render({
      cell: cell({ file: { name: '기획서-가팀.pdf', sizeBytes: 2048 } }),
      fileHref,
    });

    expect(html).toContain('기획서-가팀.pdf');
    expect(html).toContain('내려받기');
    expect(html).toContain(`href="${fileHref}"`);
  });

  // TEXT·저장소 릴리스 제출과 보존 기한이 지난 첨부는 내려받을 것이 없다.
  it('첨부가 없으면 내려받기를 그리지 않는다', () => {
    expect(render()).not.toContain('내려받기');
  });
});

/**
 * 판정은 덮어쓰지 않고 쌓인다 — 교직원이 바뀌어도 지난 지적이 남아야 한다는 것이
 * 이 기능의 요구다. 지난 판정을 감추면 새 교직원은 같은 것을 두 번 지적하거나,
 * 이미 지적한 것을 못 보고 승인한다.
 */
describe('지난 판정', () => {
  it('판정과 사유를 날짜와 함께 보여 준다', () => {
    const html = render({
      cell: cell({
        review: {
          decision: 'CHANGES_REQUESTED',
          comment: '표지의 이름이 신청서와 다릅니다.',
          reviewedAt: '2026-07-30T01:20:00.000Z',
        },
      }),
    });

    expect(html).toContain('지난 판정');
    expect(html).toContain('표지의 이름이 신청서와 다릅니다.');
    expect(html).toContain('2026년 7월 30일');
    expect(html).toContain('판정은 덮어쓰지 않고 쌓입니다.');
  });

  // 승인은 사유가 선택이라 비어 올 수 있다. 빈칸으로 두면 「사유를 못 불러왔다」로 읽힌다.
  it('사유가 없는 판정도 그렇게 말한다', () => {
    const html = render({
      cell: cell({
        review: {
          decision: 'APPROVED',
          comment: null,
          reviewedAt: '2026-07-30T01:20:00.000Z',
        },
      }),
    });

    expect(html).toContain('사유 없이 저장된 판정입니다.');
  });

  it('판정이 없으면 지난 판정 자리를 만들지 않는다', () => {
    expect(render()).not.toContain('지난 판정');
  });
});

describe('판정 입력', () => {
  it('판정 세 개를 승인·보완 요청·반려 순으로 준다', () => {
    const html = render();
    const approved = html.indexOf('>승인<');
    const changes = html.indexOf('>보완 요청<');
    const rejected = html.indexOf('>반려<');

    expect(approved).toBeGreaterThan(-1);
    expect(changes).toBeGreaterThan(approved);
    expect(rejected).toBeGreaterThan(changes);
  });

  it('고른 판정만 눌린 상태로 표시한다', () => {
    const html = render({ decision: 'CHANGES_REQUESTED' });

    expect(tagOf(html, '보완 요청')).toContain('aria-pressed="true"');
    expect(tagOf(html, '승인')).toContain('aria-pressed="false"');
    expect(tagOf(html, '반려')).toContain('aria-pressed="false"');
  });

  it('아무것도 고르지 않았으면 셋 다 눌리지 않은 상태다', () => {
    const html = render();

    for (const label of ['승인', '보완 요청', '반려']) {
      expect(tagOf(html, label)).toContain('aria-pressed="false"');
    }
  });

  /**
   * 사유가 학생에게 그대로 간다는 사실과, 언제 필수인지를 **누르기 전에** 말한다.
   * 이 두 문구가 없으면 교직원은 저장을 눌러 본 뒤에야 막힌 이유를 알게 되고,
   * 학생에게 보일 줄 모르고 내부 메모를 적는다.
   */
  it('사유가 학생에게 보인다는 것과 언제 필수인지를 미리 적는다', () => {
    const html = render();

    expect(html).toContain('학생에게 그대로 보입니다');
    expect(html).toContain(
      '보완 요청·반려는 사유를 적어야 저장됩니다. 승인은 안 적어도 됩니다.',
    );
  });

  it('사유 입력 칸에 백엔드와 같은 길이 한도를 건다', () => {
    expect(textareaTag(render())).toContain('maxLength="2000"');
  });

  it('오류 문구를 받으면 패널 안에 띄운다', () => {
    const html = render({
      errorMessage: '보완 요청과 반려는 사유를 입력해 주세요.',
    });

    expect(html).toContain('보완 요청과 반려는 사유를 입력해 주세요.');
  });
});

describe('판정 저장 중', () => {
  // 두 번 눌러 판정이 두 건 쌓이면 학생 화면의 「최신 판정」이 무엇인지 사람이 모른다.
  it('보내는 동안 판정·사유·저장을 모두 잠근다', () => {
    const html = render({ isSubmitting: true });

    for (const label of ['승인', '보완 요청', '반려', '닫기', '저장 중…']) {
      expect(tagOf(html, label)).toContain('disabled=""');
    }
    expect(textareaTag(html)).toContain('disabled=""');
  });

  it('보내는 중이 아니면 아무것도 잠그지 않는다', () => {
    const html = render();

    /*
     * `disabled=""`로 정확히 본다. `disabled`만 찾으면 Button의 Tailwind 클래스에 있는
     * `disabled:pointer-events-none`이 걸려, 잠기지 않은 버튼도 잠긴 것으로 통과한다.
     */
    for (const label of ['승인', '보완 요청', '반려', '닫기', '판정 저장']) {
      expect(tagOf(html, label)).not.toContain('disabled=""');
    }
    expect(textareaTag(html)).not.toContain('disabled=""');
  });
});
