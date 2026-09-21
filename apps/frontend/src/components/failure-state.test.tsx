import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FailureState } from './failure-state';

describe('FailureState', () => {
  it('실패를 알리고 기본으로 다음 행동을 말한다', () => {
    const html = renderToStaticMarkup(
      <FailureState title="공개 아카이브를 불러오지 못했습니다" />,
    );

    expect(html).toContain('공개 아카이브를 불러오지 못했습니다');
    // R-15 — 오류 문구는 다음 행동을 포함한다. 기본값이 그 역할을 한다.
    expect(html).toContain('잠시 후 다시 시도해 주세요.');
    expect(html).toContain('data-slot="failure-state"');
  });

  it('빈 상태가 아니라 오류로 알린다', () => {
    const html = renderToStaticMarkup(<FailureState title="실패했습니다" />);

    // R-10 — EmptyState 의 점선 회색 상자로 실패를 그리지 않는다.
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('border-dashed');
  });

  it('재시도를 줄 때만 재시도 버튼이 선다', () => {
    // 기본 설명에도 「다시 시도」라는 말이 들어 있으므로 버튼으로 세야 한다.
    const countButtons = (html: string) => html.split('<button').length - 1;

    expect(
      countButtons(
        renderToStaticMarkup(
          <FailureState title="실패했습니다" onRetry={() => undefined} />,
        ),
      ),
    ).toBe(1);
    expect(
      countButtons(renderToStaticMarkup(<FailureState title="실패했습니다" />)),
    ).toBe(0);
  });

  it('설명을 주면 기본 문구 대신 그것을 쓴다', () => {
    const html = renderToStaticMarkup(
      <FailureState
        title="설정을 불러오지 못했습니다"
        description="네트워크 연결을 확인해 주세요."
      />,
    );

    expect(html).toContain('네트워크 연결을 확인해 주세요.');
    expect(html).not.toContain('잠시 후 다시 시도해 주세요.');
  });

  it('재시도로 풀리지 않는 실패에는 다른 경로를 함께 둘 수 있다', () => {
    const html = renderToStaticMarkup(
      <FailureState
        title="사용자 정보를 불러오지 못했습니다"
        action={<a href="/dashboard/users">목록으로</a>}
      />,
    );

    expect(html).toContain('목록으로');
  });
});
