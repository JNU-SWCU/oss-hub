/**
 * 가입 완료 안내를 딱 한 번만 띄우기 위한 일회용 표시.
 *
 * 가입은 GitHub 연결로 끝나지 않는다 — 프로필 저장까지 마쳐야 회원이다. 그래서
 * "가입이 끝났다"고 말할 수 있는 순간은 프로필 저장이 성공한 그 한 번뿐이고, 그
 * 사실은 바로 다음 화면 한 번에만 유효하다. 화면 제목을 축하 문구로 바꾸는 방식은
 * 쓸 수 없다. 제목은 3년 뒤 다시 들어온 사람에게도 같은 말을 한다.
 *
 * **URL 쿼리(`?welcome=1`)를 쓰지 않는다.** 주소에 남긴 표시는 주소를 다시 여는
 * 모든 경로에서 되살아난다 — 뒤로가기, 북마크, 새로고침, 히스토리 복원. 이 레포는
 * 바로 그 뒤로가기 함정 때문에 랜딩 자동 리다이렉트를 넣었다가 걷어낸 이력이 있다
 * (#144 → #147). 같은 함정을 다시 파지 않는다. 이 주석을 지우고 쿼리 파라미터로
 * 되돌리지 말 것.
 *
 * sessionStorage를 고른 이유는 수명이 정확히 필요한 만큼이기 때문이다. 탭 하나가
 * 살아 있는 동안만 남으므로 재접속·새 탭·다른 브라우저에는 처음부터 없고, 저장
 * 직후의 전체 이동(`window.location.assign`)은 넘어 살아남는다. localStorage는
 * 반대로 너무 오래 남아 몇 달 뒤에도 뜰 수 있고, 서버에 "안내를 봤다"를 기록하는
 * 방식은 백엔드 변경이라 이 작업 범위 밖이다.
 *
 * 이 모듈이 feature가 아니라 lib에 있는 이유: 쓰는 쪽은 `features/profile`,
 * 읽는 쪽은 `features/dashboard`인데 feature끼리 직접 import는 경계 lint가 막는다.
 * 두 feature가 공유하는 계약은 최하위 계층으로 뺀다.
 */

export const SIGNUP_COMPLETION_NOTICE_KEY = 'oss-hub-signup-completed';

/** 이 모듈이 실제로 쓰는 저장소 기능만 추린 계약 — 테스트가 가짜를 끼워 넣는다. */
export interface NoticeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * 표시에 "가입을 마치고 갈 곳"을 함께 적는다.
 *
 * 교직원은 프로필을 마쳐도 승인 대기 화면으로 가서 대시보드에 닿지 않는다. 값 없는
 * 표시가 남으면 같은 탭에서 나중에 대시보드가 열릴 때(공용 PC에서 계정을 바꿔
 * 로그인하는 경우 등) 엉뚱한 사람에게 뜰 수 있다. 목적지를 적어 두면 그 화면에서만
 * 인정된다.
 */
export function writeSignupCompletionNotice(
  storage: NoticeStorage,
  destination: string,
): void {
  storage.setItem(SIGNUP_COMPLETION_NOTICE_KEY, destination);
}

/**
 * 표시를 읽고 **즉시 지운다**. 그리는 시점이 아니라 읽는 시점에 지우는 이유는,
 * 안내가 화면에 남아 있는 동안 새로고침이 일어나도 두 번째에는 없어야 하기 때문이다.
 *
 * 목적지가 지금 화면과 다르면 안내는 띄우지 않지만 표시는 그래도 버린다 — 한 번
 * 읽힌 표시를 남겨 두면 "언젠가 다시 뜬다"는 여지가 계속 남는다.
 */
export function takeSignupCompletionNotice(
  storage: NoticeStorage,
  currentPath: string,
): boolean {
  const destination = storage.getItem(SIGNUP_COMPLETION_NOTICE_KEY);
  storage.removeItem(SIGNUP_COMPLETION_NOTICE_KEY);
  return destination !== null && destination === currentPath;
}

/**
 * 저장소가 아예 없거나 접근이 막힌 환경(Safari 프라이빗 모드, 서버 렌더)에서는
 * 안내를 포기한다 — 축하 문구 하나 때문에 가입 마지막 단계를 실패시키지 않는다.
 */
function browserNoticeStorage(): NoticeStorage | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** 프로필 저장이 성공한 직후, 목적지로 이동하기 전에 부른다. */
export function rememberSignupCompletion(destination: string): void {
  const storage = browserNoticeStorage();
  if (!storage) return;
  try {
    writeSignupCompletionNotice(storage, destination);
  } catch {
    // 저장 실패(용량·권한)는 안내를 건너뛰는 것으로 족하다.
  }
}

/**
 * 지금 열린 화면이 그 목적지였는지 확인하고, 확인 여부와 상관없이 표시를 지운다.
 * 화면이 자기 경로를 따로 넘기지 않아도 되도록 주소는 여기서 직접 읽는다.
 */
export function consumeSignupCompletionNotice(): boolean {
  const storage = browserNoticeStorage();
  if (!storage) return false;
  try {
    return takeSignupCompletionNotice(storage, window.location.pathname);
  } catch {
    return false;
  }
}
