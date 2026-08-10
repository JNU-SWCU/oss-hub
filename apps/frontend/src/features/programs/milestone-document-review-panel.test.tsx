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
    status: 'SUBMITTED',
    revision: 1,
    submittedAt: '2026-07-28T00:00:00.000Z',
    file: null,
    content: null,
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

/**
 * 배지 문구만 그린 순서대로. 머리의 「지금 상태」와 「지난 판정」의 배지가 서로 다른 말을
 * 할 수 있으므로, 문서 전체를 `toContain`으로 훑는 대신 **어느 배지가 무엇을 말하는지**를 본다.
 */
function badgeTexts(html: string): readonly string[] {
  return [...html.matchAll(/data-slot="status-badge"[^>]*>([^<]*)</g)].map(
    (match) => match[1] ?? '',
  );
}

/**
 * `data-testid`가 붙은 요소의 **여는 태그**. 속성(target·rel·클래스)은 문서 전체가 아니라
 * 그 태그에서 읽어야 한다 — 문서를 통째로 훑으면 남의 요소에 붙은 속성이 통과시킨다.
 */
function tagWithTestId(html: string, testId: string): string {
  const marker = `data-testid="${testId}"`;
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) throw new Error(`요소를 찾지 못했습니다: ${testId}`);
  const open = html.lastIndexOf('<', markerIndex);
  return html.slice(open, html.indexOf('>', markerIndex) + 1);
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

  it('이미 판정된 칸이면 머리의 배지도 그 상태를 말한다', () => {
    const html = render({
      cell: cell({
        status: 'REJECTED',
        review: {
          id: 'review-1',
          decision: 'REJECTED',
          comment: '기한을 넘겼습니다.',
          reviewedAt: '2026-07-30T00:00:00.000Z',
        },
      }),
    });

    // 머리 배지와 「지난 판정」 배지가 둘 다 반려다.
    expect(badgeTexts(html)).toEqual(['반려', '반려']);
    expect(html).not.toContain('검토 대기');
  });

  /**
   * 다시 낸 칸 — 머리의 배지는 **지금 상태**(검토 대기)를, 아래 「지난 판정」은 **왜
   * 되돌아갔었는지**(보완 요청)를 말한다. 머리까지 보완 요청이면 교직원은 이 건을 이미
   * 처리한 것으로 읽고 지나간다.
   */
  it('다시 낸 칸은 머리가 검토 대기, 아래에 지난 보완 요청이 남는다', () => {
    const html = render({
      cell: cell({
        status: 'SUBMITTED',
        submittedAt: '2026-08-02T00:00:00.000Z',
        review: {
          id: 'review-1',
          decision: 'CHANGES_REQUESTED',
          comment: '표지의 이름이 신청서와 다릅니다.',
          reviewedAt: '2026-07-30T00:00:00.000Z',
        },
      }),
    });

    // 머리는 지금 상태, 그 아래는 지난 지적 — 두 배지가 서로 다른 말을 한다.
    expect(badgeTexts(html)).toEqual(['검토 대기', '보완 요청']);
    expect(html).toContain('지난 판정');
    expect(html).toContain('표지의 이름이 신청서와 다릅니다.');
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

  // TEXT 제출과 보존 기한이 지난 첨부는 내려받을 것이 없다.
  it('첨부가 없으면 내려받기를 그리지 않는다', () => {
    expect(render()).not.toContain('내려받기');
  });
});

/**
 * 글 제출이 이 패널에 없던 것이 원래 결함이다. 교직원은 내용을 한 글자도 못 본 채
 * 승인·반려를 눌렀다. 아래 테스트는 글 제출이 보이는지를 고정한다.
 */
describe('판정 패널의 제출 내용', () => {
  const longText = ['첫 줄입니다.', '', '  들여쓴 둘째 줄.', '마지막 줄.'].join(
    '\n',
  );

  it('글 제출은 원문을 줄바꿈까지 그대로 보여 준다', () => {
    const html = render({
      cell: cell({ content: { type: 'TEXT', text: longText } }),
    });

    expect(html).toContain('제출한 글');
    // 첫 줄만 보고 승인하지 않도록 **전문**이 있어야 한다.
    expect(html).toContain('첫 줄입니다.');
    expect(html).toContain('들여쓴 둘째 줄.');
    expect(html).toContain('마지막 줄.');
    // 원문의 줄바꿈이 문서에 그대로 남아 있다(한 덩이로 이어 붙이지 않았다).
    expect(html).toContain('첫 줄입니다.\n\n  들여쓴 둘째 줄.\n마지막 줄.');
  });

  /**
   * 10,000자까지 올 수 있는 글이다. 높이를 묶고 그 안에서 스크롤하지 않으면 판정 버튼이
   * 화면 밖으로 밀려나고, 스크롤 영역에 초점이 닿지 않으면 마우스 없이는 아래를 못 읽는다.
   */
  it('긴 글은 초점이 닿는 스크롤 영역에 담는다', () => {
    const tag = tagWithTestId(
      render({ cell: cell({ content: { type: 'TEXT', text: longText } }) }),
      'milestone-document-submitted-text',
    );

    expect(tag).toContain('overflow-y-auto');
    expect(tag).toContain('max-h-80');
    expect(tag).toContain('whitespace-pre-wrap');
    expect(tag).toContain('tabindex="0"');
  });

  it('파일 제출에는 글을 만들지 않는다', () => {
    const html = render({
      cell: cell({ file: { name: '기획서-가팀.pdf', sizeBytes: 2048 } }),
      fileHref: milestoneDocumentSubmissionFileHref('m1', 'd1', 'a1'),
    });

    expect(html).not.toContain('제출한 글');
    expect(html).toContain('기획서-가팀.pdf');
  });
});

/**
 * 제출은 있는데 볼 것이 하나도 없는 칸(보존 기한이 지난 첨부 등). 아무 말 없이 판정
 * 버튼만 열어 두면 교직원은 **볼 것이 없다는 사실 자체를 모른 채** 승인을 누른다.
 */
describe('보여 줄 내용이 없는 제출', () => {
  const noContentNotice = '제출은 있지만 보여 줄 파일도 내용도 없습니다.';

  it('파일도 본문도 없으면 그 사실을 적는다', () => {
    const html = render();

    expect(html).toContain(noContentNotice);
    expect(html).toContain('학생에게 다시 받아 주세요.');
  });

  /**
   * 버튼까지 잠그지는 않는다 — 보존 기한이 지난 첨부에 「다시 내라」고 보완 요청하는 것은
   * 정당한 판정이라, 잠그면 그 길이 막힌다. 알리되 막지 않는다.
   */
  it('그래도 판정 버튼은 잠그지 않는다', () => {
    const html = render();

    for (const label of ['승인', '보완 요청', '반려', '판정 저장']) {
      expect(tagOf(html, label)).not.toContain('disabled=""');
    }
  });

  it('내려받을 첨부가 있으면 그 문구를 띄우지 않는다', () => {
    const html = render({
      cell: cell({ file: { name: '기획서-가팀.pdf', sizeBytes: 2048 } }),
      fileHref: milestoneDocumentSubmissionFileHref('m1', 'd1', 'a1'),
    });

    expect(html).not.toContain(noContentNotice);
  });

  it('보여 줄 글이 있으면 그 문구를 띄우지 않는다', () => {
    const html = render({
      cell: cell({ content: { type: 'TEXT', text: '냈습니다.' } }),
    });

    expect(html).not.toContain(noContentNotice);
  });

  // 미제출 칸은 볼 것이 없는 게 당연하다 — 여기까지 경고하면 문구가 뜻을 잃는다.
  it('미제출 칸에는 띄우지 않는다', () => {
    const html = render({
      cell: cell({ isSubmitted: false, status: null, submittedAt: null }),
    });

    expect(html).not.toContain(noContentNotice);
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
          id: 'review-1',
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
          id: 'review-1',
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
