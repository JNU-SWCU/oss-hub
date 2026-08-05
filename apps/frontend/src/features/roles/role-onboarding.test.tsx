import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  clampRejectionReason,
  ROLE_REJECTION_REASON_MAX_LENGTH,
  ROLE_REJECTION_REASON_MAX_LINES,
  RoleSelectionForm,
  type ClosedRoleRequestNotice,
} from './components/role-selection-screen';
import {
  ROLE_REQUEST_RETRY_FAILURE_MESSAGE,
  RoleRequestStatusView,
} from './components/role-request-screen';
import type { RoleRequest } from './types';

const noOp = () => undefined;

function renderRoleForm(
  selectedRole: 'STUDENT' | 'STAFF' | null,
  rejection: ClosedRoleRequestNotice | null = null,
): string {
  return renderToStaticMarkup(
    <RoleSelectionForm
      selectedRole={selectedRole}
      isSubmitting={false}
      errorMessage={null}
      rejection={rejection}
      onSelect={noOp}
      onSubmit={noOp}
    />,
  );
}

function rejectionNotice(reason: string | null): ClosedRoleRequestNotice {
  return { status: 'REJECTED', reason };
}

function roleRequest(overrides: Partial<RoleRequest> = {}): RoleRequest {
  return {
    requestedRole: 'STAFF',
    status: 'PENDING',
    requestedAt: '2026-07-21T00:00:00.000Z',
    decidedAt: null,
    rejectionReason: null,
    ...overrides,
  };
}

describe('role onboarding views', () => {
  it('선택한 교직원 역할과 승인 필요 안내를 함께 표시한다', () => {
    // Given / When
    const html = renderRoleForm('STAFF');

    // Then
    expect(html).toContain('data-role="STAFF"');
    expect(html).toContain('data-selected="true"');
    expect(html).toContain('관리자 승인이 필요합니다');
    expect(html).toContain('선택 완료');
  });

  // 아직 아무 정보도 없는 상자를 먼저 보여 주지 않는다 — 안내는 고른 뒤에 생긴다.
  it('역할을 고르기 전에는 다음 단계 안내를 그리지 않는다', () => {
    // Given / When
    const emptyHtml = renderRoleForm(null);

    // Then — 자리표시 상자도, 어느 역할의 안내 문구도 아직 없다
    expect(emptyHtml).not.toContain('다음 단계 안내');
    expect(emptyHtml).not.toContain('data-role="none"');
    expect(emptyHtml).not.toContain('기본 정보를 입력하면 가입이 끝납니다');
    expect(emptyHtml).not.toContain('기본 정보를 입력한 뒤 승인을 기다립니다');
  });

  /**
   * 안내가 실제 도착지와 같은 곳을 말하는가.
   *
   * 백엔드 `roles.service.ts`는 두 역할 모두에게 `/onboarding/profile`을 돌려준다.
   * 그런데 이 안내는 학생에게 "바로 학생 화면으로", 교직원에게 "승인 상태를 확인할
   * 수 있는 화면으로" 간다고 말했다 — 둘 다 도착하지 않는 화면이다. 고른 직후 읽는
   * 문장이 도착지와 다르면 사용자는 화면이 잘못 떴다고 읽는다.
   */
  it.each([
    ['STUDENT', '이름·학번·학과를 입력하는 화면으로 이동합니다'],
    ['STAFF', '이름·학과를 입력하는 화면으로 이동합니다'],
  ] as const)(
    '%s 안내는 다음 화면이 프로필 입력임을 말한다',
    (role, phrase) => {
      // Given / When
      const html = renderRoleForm(role);

      // Then
      expect(html).toContain(phrase);
      expect(html).not.toContain('바로 학생 화면으로 이동합니다');
      expect(html).not.toContain('승인 상태를 확인할 수 있는 화면으로');
    },
  );

  // 교직원은 프로필을 마친 뒤에야 승인 대기 화면으로 이어진다 — 그 순서가 안내에
  // 드러나야 "승인은 어디서 기다리나"를 사용자가 다시 묻지 않는다.
  it('교직원 안내는 프로필 다음이 승인 대기임을 함께 말한다', () => {
    // Given / When
    const html = renderRoleForm('STAFF');

    // Then
    expect(html).toContain('기본 정보를 입력한 뒤 승인을 기다립니다');
  });

  // 안내가 선택 시점에 새로 끼어들면 세로 가운데 정렬인 무대가 위아래로 벌어져
  // 방금 누른 카드까지 움직인다. 빈 자리를 미리 잡아 두었는지를 못박는다.
  it('안내 자리는 선택 전에도 같은 슬롯으로 확보한다', () => {
    // Given / When
    const emptyHtml = renderRoleForm(null);
    const staffHtml = renderRoleForm('STAFF');

    // Then
    const slot = 'data-slot="role-guidance"';
    expect(emptyHtml).toContain(slot);
    expect(staffHtml).toContain(slot);
    expect(staffHtml).toContain('기본 정보를 입력한 뒤 승인을 기다립니다');
  });

  // 카드 높이는 서로 맞춰야 한다 — 한쪽에만 있는 줄이 생기면 어긋난다.
  it('두 역할 카드 모두 승인 여부 한 줄을 가진다', () => {
    // Given / When
    const html = renderRoleForm(null);

    // Then
    expect(html).toContain('승인 없이 바로 시작합니다');
    expect(html).toContain('관리자 승인이 필요합니다');
  });

  /**
   * 반려 안내 표시 규칙(#673).
   *
   * 이 검사들만으로는 부족하다는 것을 먼저 적어 둔다 — 바로 아래
   * `RoleRequestStatusView` 검사가 통과하는 동안에도 사용자는 사유를 볼 수 없었다.
   * 컴포넌트를 직접 렌더하면 게이트를 지나치기 때문이다. **도달 가능성은
   * `app/_shell/onboarding-rejection-reach.test.tsx`가 지킨다.** 여기서는 도달한
   * 화면이 무엇을 어떻게 그리는지만 본다.
   */
  it('반려 안내는 반려 사실과 사유 전문을 함께 그린다', () => {
    // Given / When
    const html = renderRoleForm(
      null,
      rejectionNotice('학과 소속이 확인되지 않았습니다.'),
    );

    // Then
    expect(html).toContain('data-slot="role-request-closed"');
    expect(html).toContain('data-status="REJECTED"');
    expect(html).toContain('교직원 요청이 반려되었습니다');
    expect(html).toContain('반려 사유');
    expect(html).toContain('학과 소속이 확인되지 않았습니다.');
    // 별도 재신청 버튼을 세우지 않는다 — 이 화면의 `선택 완료`가 그 일을 한다.
    expect(html).toContain('선택 완료');
    expect(html).not.toContain('다시 승인 요청하기');
  });

  it.each([
    ['null 사유', null],
    ['공백뿐인 사유', '   \n  '],
  ] as readonly (readonly [string, string | null])[])(
    '%s는 사실과 안내만 남기고 빈 사유 상자를 그리지 않는다',
    (_label, reason) => {
      // Given / When — 사유 없이 닫힌 과거 반려 건이 실제로 존재한다.
      const html = renderRoleForm(null, rejectionNotice(reason));

      // Then
      expect(html).toContain('교직원 요청이 반려되었습니다');
      expect(html).toContain(
        '아래에서 교직원을 다시 고르면 승인 요청이 새로 접수됩니다.',
      );
      // 라벨만 뜨고 안이 비면 사용자는 사유가 아직 안 온 줄 알고 기다린다.
      expect(html).not.toContain('반려 사유');
    },
  );

  /**
   * 안내는 **한 문장**이어야 한다.
   *
   * 예전 두 문장은 같은 말을 하면서 375px에서 설명만 59px를 먹었고, 그만큼이 그대로
   * 사용자가 감수할 스크롤이 됐다. 옛 문구가 다시 들어오는 것을 막는다 — 새 문구가
   * 옛 문구를 포함하는 형태로 되살아나도 잡히도록 `not.toMatch`로 못박는다.
   */
  it('안내 문구는 같은 말을 두 번 하지 않는다', () => {
    // Given / When
    const html = renderRoleForm(null, rejectionNotice(null));

    // Then
    expect(html).not.toMatch(
      /교직원을 다시 고르면 승인 요청이 한 번 더 접수됩니다/,
    );
    expect(html).not.toMatch(/아래에서 역할을 다시 고르면 새로 신청됩니다/);
  });

  /**
   * 길이 제한이 어디에도 없다 — 관리자 대화상자에 `maxLength`가 없고, DTO는
   * `@IsString()`뿐이며, 저장은 `String?`이다. 그래서 표시 쪽이 자른다.
   */
  it('아주 긴 사유는 잘라서 그린다', () => {
    // Given: 제한을 훌쩍 넘는, 공백이 하나도 없는 문자열.
    const reason = '반'.repeat(ROLE_REJECTION_REASON_MAX_LENGTH * 3);

    // When
    const html = renderRoleForm(null, rejectionNotice(reason));

    // Then: 원문 전체는 실리지 않고, 잘렸다는 표시와 줄바꿈 규칙이 함께 붙는다.
    expect(html).not.toContain(reason);
    expect(html).toContain('반'.repeat(ROLE_REJECTION_REASON_MAX_LENGTH));
    expect(html).toContain('…');
    // 공백 없는 긴 문자열이 상자 밖으로 밀고 나가지 못하게 끊는다.
    expect(html).toContain('break-words');
    expect(html).toContain('whitespace-pre-wrap');
  });

  /**
   * 자르기 규칙 자체를 값으로 못박는다. `toContain`으로 값을 단언하면 새 문구가
   * 옛 문구를 포함할 때 그대로 통과한다 — 이 저장소에서 실제로 당한 적이 있다.
   */
  it('사유 다듬기는 공백만 있는 값을 없는 것으로 접고 앞뒤 공백을 턴다', () => {
    expect(clampRejectionReason(null)).toBe(null);
    expect(clampRejectionReason('')).toBe(null);
    expect(clampRejectionReason('  \n\t ')).toBe(null);
    expect(clampRejectionReason('  사유  ')).toBe('사유');
    expect(
      clampRejectionReason('가'.repeat(ROLE_REJECTION_REASON_MAX_LENGTH)),
    ).toBe('가'.repeat(ROLE_REJECTION_REASON_MAX_LENGTH));
    expect(
      clampRejectionReason('가'.repeat(ROLE_REJECTION_REASON_MAX_LENGTH + 1)),
    ).toBe(`${'가'.repeat(ROLE_REJECTION_REASON_MAX_LENGTH)}…`);
  });

  /** 짝을 잃은 상위 서로게이트 — 화면에는 깨진 문자로 뜬다. */
  const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/;
  const FILLER = '가'.repeat(ROLE_REJECTION_REASON_MAX_LENGTH);
  /** 가족 이모지 — 사람 셋을 ZWJ(`U+200D`)가 한 글자로 묶는다. */
  const FAMILY = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';

  /**
   * 이모지를 한가운데서 자르지 않는다.
   *
   * `slice(0, 300)`은 **UTF-16 코드 유닛** 기준이라 이모지의 앞 절반만 남긴다.
   * `'가'×299 + 이모지`(UTF-16 길이 301)를 그렇게 자르면 마지막이 `\uD83D` 하나뿐인
   * 짝 잃은 서로게이트가 되어 화면에 깨진 문자로 뜬다. 문자소 단위로 세면 그 값은
   * 애초에 300자라 자를 일이 없고, 넘칠 때도 이모지가 통째로 빠진다.
   */
  it('이모지 경계에서 잘리지 않는다', () => {
    // Given: 코드 유닛으로는 넘치지만 문자소로는 딱 맞는 값.
    const grinning = '\u{1F600}';
    const exactlyFull = `${'가'.repeat(
      ROLE_REJECTION_REASON_MAX_LENGTH - 1,
    )}${grinning}`;

    // When / Then: 자를 필요가 없으므로 원문 그대로다.
    expect(exactlyFull.length).toBeGreaterThan(
      ROLE_REJECTION_REASON_MAX_LENGTH,
    );
    expect(clampRejectionReason(exactlyFull)).toBe(exactlyFull);

    // Given / When: 한 글자 넘치면 이모지가 통째로 빠진다 — 반쪽만 남지 않는다.
    const overflowed = clampRejectionReason(`${FILLER}${grinning}`);

    // Then
    expect(overflowed).toBe(`${FILLER}\u2026`);
    expect(overflowed).not.toMatch(LONE_SURROGATE);
  });

  /**
   * ZWJ로 묶인 가족 이모지는 사람 셋으로 흩어지면 안 된다. 코드 포인트 단위로 자르면
   * 남자 이모지 하나만 남고, 제어문자 청소가 ZWJ까지 지우면 셋이 나란히 선다.
   */
  it('결합 이모지는 사람 셋으로 흩어지지 않는다', () => {
    // Given / When: 자를 필요가 없는 길이.
    const kept = clampRejectionReason(`반려 사유 ${FAMILY}`);

    // Then: ZWJ가 살아 있어야 한 덩어리로 그려진다.
    expect(kept).toBe(`반려 사유 ${FAMILY}`);
    expect(kept).toContain('\u200D');

    // When: 넘치면 통째로 빠진다.
    const dropped = clampRejectionReason(`${FILLER}${FAMILY}`);

    // Then: 반쪽(남자 이모지만 남은 형태)이 남지 않는다.
    expect(dropped).toBe(`${FILLER}\u2026`);
    expect(dropped).not.toContain('\u{1F468}');
    expect(dropped).not.toMatch(LONE_SURROGATE);
  });

  /**
   * 줄바꿈 폭탄 — 글자 수는 통과하는데 세로로 무너뜨리는 값이다.
   *
   * `whitespace-pre-wrap`이 줄바꿈을 그대로 살리므로 높이에 상한이 없었다.
   */
  it('줄 수에도 상한이 있다', () => {
    // Given: 300자 제한 안에 드는 짧은 값인데 줄만 200개다.
    const bomb = '\u3131\n'.repeat(200);

    // When
    const clamped = clampRejectionReason(bomb);

    // Then
    expect(clamped?.split('\n')).toHaveLength(ROLE_REJECTION_REASON_MAX_LINES);
    expect(clamped?.endsWith('\u2026')).toBe(true);
  });

  it('연속된 빈 줄은 하나로 접는다', () => {
    // Given / When / Then: 문단 구분은 살리되 여백 폭탄은 접는다.
    expect(clampRejectionReason('앞\n\n\n\n\n\n\n뒤')).toBe('앞\n\n뒤');
    expect(clampRejectionReason('앞\n뒤')).toBe('앞\n뒤');
    // 윈도우에서 붙여넣은 줄바꿈도 같은 규칙을 탄다.
    expect(clampRejectionReason('앞\r\n뒤')).toBe('앞\n뒤');
  });

  /**
   * 눈에 보이는 빈 줄과 세는 빈 줄이 같아야 한다.
   *
   * 정규식(`/\n{3,}/`)으로 세던 때는 **공백만 있는 줄을 빈 줄로 세지 못했다.**
   * 붙여넣기로 들어온 사유는 줄마다 공백이 남는 일이 흔한데, 그런 값은 눈에는 빈
   * 줄인데 규칙에는 내용 있는 줄로 잡혀 접히지 않고 그대로 높이를 먹었다.
   */
  it('공백만 있는 줄도 빈 줄로 세어 접는다', () => {
    // Given / When / Then
    expect(clampRejectionReason('앞\n   \n   \n뒤')).toBe('앞\n\n뒤');
    expect(clampRejectionReason('앞\n \n\n \n뒤')).toBe('앞\n\n뒤');
    // 탭이 공백으로 바뀐 뒤에도 같은 규칙을 탄다.
    expect(clampRejectionReason('앞\n\t\n\t\n뒤')).toBe('앞\n\n뒤');
  });

  /**
   * `U+2028`(줄 구분자)·`U+2029`(문단 구분자)는 **화면에서는 줄을 바꾸는데
   * `split('\n')`에는 잡히지 않는다.** 그대로 두면 줄 수 상한을 통째로 우회한다 —
   * 이 둘로만 이루어진 사유는 몇 줄이든 "한 줄"로 세어져 6줄 제한을 지나간다.
   */
  it.each([
    ['U+2028 줄 구분자', '\u2028'],
    ['U+2029 문단 구분자', '\u2029'],
  ] as readonly (readonly [string, string])[])(
    '%s도 줄바꿈으로 세어 상한을 지킨다',
    (_label, separator) => {
      // Given: 200줄짜리 폭탄. 평범한 줄바꿈이 하나도 없다.
      const bomb = Array.from({ length: 200 }, () => 'ㄱ').join(separator);

      // When
      const clamped = clampRejectionReason(bomb);

      // Then: 평범한 줄바꿈으로 정규화돼 같은 상한에 걸린다.
      expect(clamped).not.toContain(separator);
      expect(clamped?.split('\n')).toHaveLength(
        ROLE_REJECTION_REASON_MAX_LINES,
      );
      expect(clamped?.endsWith('\u2026')).toBe(true);
    },
  );

  it('유니코드 줄 구분자는 지우지 않고 줄바꿈으로 살린다', () => {
    // Given / When / Then: 관리자가 의도한 줄 나눔이므로 없애지 않는다.
    expect(clampRejectionReason('앞\u2028뒤')).toBe('앞\n뒤');
    expect(clampRejectionReason('앞\u2029뒤')).toBe('앞\n뒤');
  });

  /**
   * 제어문자·양방향 제어문자를 지운다.
   *
   * 관리자는 사유를 붙여넣기로 들여올 수 있다. Bidi 제어문자는 **뒤에 오는 글자의 표시
   * 순서를 뒤집어**, 사용자가 관리자가 쓰지 않은 문장을 읽게 만든다. 소스에 그대로
   * 적으면 이 테스트 파일 자체가 거꾸로 읽히므로 전부 이스케이프로 쓴다.
   */
  it('제어문자와 양방향 제어문자를 지운다', () => {
    // Given / When / Then
    expect(clampRejectionReason('사유\u0007입니다')).toBe('사유입니다');
    // U+202E RLO — 뒤따르는 글자의 표시 순서를 뒤집는다.
    expect(clampRejectionReason('\u202E사유가 뒤집힌다')).toBe(
      '사유가 뒤집힌다',
    );
    // U+2066/U+2069 격리, U+200E/U+200F 방향 표시, U+061C 아랍 문자 표시.
    expect(clampRejectionReason('\u2066격리\u2069')).toBe('격리');
    expect(clampRejectionReason('\u200E\u200F방향 표시')).toBe('방향 표시');
    expect(clampRejectionReason('\u061C아랍 표시')).toBe('아랍 표시');
    // 탭은 지우지 않고 공백으로 바꾼다 — 지우면 단어가 서로 붙는다.
    expect(clampRejectionReason('학과\t미확인')).toBe('학과 미확인');
  });

  // 반려가 아닌 사용자의 화면은 지금과 같아야 한다.
  it('반려가 아닌 사용자의 화면에는 안내 자리가 아예 없다', () => {
    // Given / When
    const html = renderRoleForm('STAFF');

    // Then
    expect(html).not.toContain('data-slot="role-request-closed"');
    expect(html).not.toContain('교직원 요청이 반려되었습니다');
  });

  /**
   * 카드 가로 배치는 안내와 **무관하게** 살아 있어야 한다.
   *
   * 반려 안내는 375×812에서 `선택 완료`를 접히는 선 아래로 밀어낸다 — 알고 허용한
   * 대가다(`ClosedRoleRequestAlert` 주석의 실측). 그 예외가 "이 화면은 어차피
   * 스크롤한다"로 번져 카드까지 세로로 쌓이면, **안내가 없는 첫 가입자까지** 함께
   * 스크롤하게 된다. 그쪽은 지금 스크롤이 아예 없는 화면이다(버튼 하단 732px).
   * 두 상태 모두에서 가로 배치를 못박아 그 번짐을 막는다.
   */
  it.each([
    ['안내 없음', null],
    ['안내 있음', rejectionNotice('학과 소속이 확인되지 않았습니다.')],
  ] as readonly (readonly [string, ClosedRoleRequestNotice | null])[])(
    '%s 상태 모두에서 두 역할 카드는 가로로 나란히 선다',
    (_label, rejection) => {
      // Given / When
      const html = renderRoleForm(null, rejection);

      // Then — 한 줄에 둘. `grid-cols-1`이나 `flex-col`로 바뀌면 카드 하나 높이(약
      // 190px)가 통째로 더해진다.
      expect(html).toContain('grid grid-cols-2 items-stretch gap-3');
      expect(html).not.toMatch(/<fieldset[^>]*grid-cols-1/);
      expect(html).not.toMatch(/<fieldset[^>]*flex-col/);
    },
  );

  it('반려된 요청은 반려 사유와 재요청 동작을 표시한다', () => {
    // Given
    const rejected = roleRequest({
      status: 'REJECTED',
      decidedAt: '2026-07-21T01:00:00.000Z',
      rejectionReason: '합성 반려 사유',
    });

    // When
    const html = renderToStaticMarkup(
      <RoleRequestStatusView
        request={rejected}
        isRetrying={false}
        errorMessage={null}
        onRefresh={noOp}
        onRetry={noOp}
      />,
    );

    // Then
    expect(html).toContain('data-status="REJECTED"');
    expect(html).toContain('합성 반려 사유');
    expect(html).toContain('다시 승인 요청하기');
  });

  it('승인된 요청은 교직원 화면 이동 경로를 제공한다', () => {
    // Given
    const approved = roleRequest({
      status: 'APPROVED',
      decidedAt: '2026-07-21T01:00:00.000Z',
    });

    // When
    const html = renderToStaticMarkup(
      <RoleRequestStatusView
        request={approved}
        isRetrying={false}
        errorMessage={null}
        onRefresh={noOp}
        onRetry={noOp}
      />,
    );

    // Then
    expect(html).toContain('data-status="APPROVED"');
    expect(html).toContain('href="/dashboard"');
  });

  /**
   * 승인을 기다리는 사람이 자기 이름을 고치러 갈 자리(#598).
   *
   * 고칠 화면은 이미 열려 있었지만(#581) 그리로 가는 길이 머리글 계정 메뉴 하나뿐이라,
   * 그 메뉴를 모르는 사람에게는 오타 하나가 영영 남았다.
   */
  it('승인 대기 요청은 이름·학과를 고치러 갈 길을 함께 낸다', () => {
    // Given
    const pending = roleRequest();

    // When
    const html = renderToStaticMarkup(
      <RoleRequestStatusView
        request={pending}
        isRetrying={false}
        errorMessage={null}
        onRefresh={noOp}
        onRetry={noOp}
      />,
    );

    // Then — 상태 새로고침 하나만 있던 화면이다
    expect(html).toContain('data-status="PENDING"');
    expect(html).toContain('href="/settings"');
    expect(html).toContain('이름·학과 고치기');
  });

  /**
   * 역할 선택 단계는 여기서 열지 않는다.
   *
   * 승인 대기 중에 역할을 다시 고르면 요청이 하나 더 만들어져 관리자 승인 목록에
   * 같은 사람이 두 번 뜬다(역할 요청 생성이 프로필 저장과 분리돼 있다).
   */
  it('승인 대기 요청에 역할을 다시 고르는 길은 내지 않는다', () => {
    // Given
    const pending = roleRequest();

    // When
    const html = renderToStaticMarkup(
      <RoleRequestStatusView
        request={pending}
        isRetrying={false}
        errorMessage={null}
        onRefresh={noOp}
        onRetry={noOp}
      />,
    );

    // Then
    expect(html).not.toContain('href="/onboarding/role"');
    expect(html).not.toContain('href="/onboarding/profile"');
  });

  /**
   * 반려·회수는 설정 화면의 문이 닫혀 있다(`app/settings/settings-access.ts`).
   * 링크를 내면 눌러도 이 화면으로 되돌아오는 제자리 걸음이 된다.
   */
  it.each(['REJECTED', 'REVOKED'] as const)(
    '%s 요청에는 설정으로 가는 길을 내지 않는다',
    (status) => {
      // Given
      const request = roleRequest({
        status,
        decidedAt: '2026-07-21T01:00:00.000Z',
      });

      // When
      const html = renderToStaticMarkup(
        <RoleRequestStatusView
          request={request}
          isRetrying={false}
          errorMessage={null}
          onRefresh={noOp}
          onRetry={noOp}
        />,
      );

      // Then
      expect(html).not.toContain('href="/settings"');
    },
  );

  it('회수된 요청 응답도 안전하게 역할 재선택 경로를 표시한다', () => {
    // Given
    const revoked = roleRequest({
      status: 'REVOKED',
      decidedAt: '2026-07-21T01:00:00.000Z',
    });

    // When
    const html = renderToStaticMarkup(
      <RoleRequestStatusView
        request={revoked}
        isRetrying={false}
        errorMessage={null}
        onRefresh={noOp}
        onRetry={noOp}
      />,
    );

    // Then
    expect(html).toContain('data-status="REVOKED"');
    expect(html).toContain('href="/onboarding/role"');
  });

  /**
   * 실패 안내는 "못 했다"로 끝나면 안 된다 — 요청이 어떤 상태로 남았는지와
   * 바로 아래 어떤 버튼을 누르면 되는지가 같은 문장 안에 있어야 한다.
   */
  it('재요청 실패 안내는 남은 상태와 다음에 누를 버튼을 함께 알린다', () => {
    // Given
    const rejected = roleRequest({
      status: 'REJECTED',
      decidedAt: '2026-07-21T01:00:00.000Z',
      rejectionReason: '합성 반려 사유',
    });

    // When
    const html = renderToStaticMarkup(
      <RoleRequestStatusView
        request={rejected}
        isRetrying={false}
        errorMessage={ROLE_REQUEST_RETRY_FAILURE_MESSAGE}
        onRefresh={noOp}
        onRetry={noOp}
      />,
    );

    // Then — 안내가 가리키는 버튼이 둘 다 같은 화면에 실제로 있다
    expect(html).toContain(ROLE_REQUEST_RETRY_FAILURE_MESSAGE);
    expect(html).toContain('다시 승인 요청하기');
    expect(html).toContain('상태 새로고침');
    // 원인을 모르는 실패에서 남은 상태를 단정하지 않는다 — 요청이 서버에 닿았는지
    // 알 수 없다. 대신 지금 상태를 확인할 수단을 먼저 가리킨다.
    expect(ROLE_REQUEST_RETRY_FAILURE_MESSAGE).not.toContain(
      '요청 상태는 반려 그대로',
    );
    expect(ROLE_REQUEST_RETRY_FAILURE_MESSAGE).toContain(
      '‘상태 새로고침’으로 지금 상태를 확인',
    );
    expect(ROLE_REQUEST_RETRY_FAILURE_MESSAGE).toContain(
      '‘다시 승인 요청하기’를 눌러 주세요',
    );
  });
});
