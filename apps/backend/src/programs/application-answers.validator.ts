/**
 * 신청 answers 정규화·검증 (순수 함수).
 * 순서: 클라이언트의 applicantName 제거 → 서버 applicantName 주입 → 키·필수값 검증.
 * DomainException 변환은 호출 측(#104 POST)에서 한다.
 */

const CLIENT_KEYS = new Set(['title', 'summary']);

/**
 * 학생이 직접 쓰는 두 칸의 길이 상한.
 *
 * 값은 저장소가 이미 쓰는 것 중 **같은 모양의 가장 큰 값**을 골랐다 — 제목은 게시글
 * 제목(200), 지원 동기는 게시글 내용·제출 내용(10,000)과 같다. 짧게 잡아 학생의 글이
 * 잘리는 것보다 낫다는 판단이다(동규 결정).
 *
 * ⚠ 프런트에도 같은 값이 있다(`features/programs/application-answer-limits.ts`).
 *   언어가 갈려 한 곳에서 강제할 수 없으니, 한쪽을 고치면 다른 쪽도 고쳐야 한다.
 *
 * ⚠ `applicantName` 은 여기 없다 — 학생이 못 보내고 서버가 프로필에서 넣으며,
 *   그 프로필 이름은 이미 100자 상한이 걸려 있다.
 */
export const APPLICATION_ANSWER_MAX_LENGTHS = {
  title: 200,
  summary: 10_000,
} as const;

export type ApplicationAnswerKey = keyof typeof APPLICATION_ANSWER_MAX_LENGTHS;

export type ApplicationAnswers = {
  readonly applicantName: string;
  readonly title: string;
  readonly summary: string;
};

export type ApplicationAnswersValidationFailure = {
  readonly ok: false;
  readonly reason:
    'INVALID_SHAPE' | 'UNKNOWN_KEYS' | 'MISSING_REQUIRED' | 'TOO_LONG';
  readonly unknownKeys?: readonly string[];
  readonly missingKeys?: readonly string[];
  readonly tooLongKeys?: readonly ApplicationAnswerKey[];
};

/**
 * 길이를 재는가. **쓰기에서만 잰다.**
 *
 * ⚠ 읽기(`toView`)가 같은 검증기를 타므로, 여기서 길이를 재면 상한이 생기기 전에
 *   저장된 긴 신청서를 **학생이 열지도 못하게** 된다(`APP_015` 로 튕긴다).
 *   고치라고 만든 상한이 고칠 길을 막는 셈이라, 읽기는 길이를 재지 않는다.
 */
export type ApplicationAnswersLengthMode = 'enforce-length' | 'skip-length';

/**
 * 학생 화면에 실제로 보이는 라벨(`program-template.registry.ts`와 같은 말).
 * ⚠ 「지원 동기」처럼 화면에 없는 말로 안내하면 학생은 무엇을 줄일지 못 찾는다.
 */
const APPLICATION_ANSWER_LABELS = {
  title: '제목',
  summary: '요약',
} as const satisfies Readonly<Record<ApplicationAnswerKey, string>>;

/** 넘친 칸마다의 안내. 숫자는 상한 상수에서 온다 — 문구에 베껴 적으면 갈라진다. */
export function applicationAnswerTooLongMessage(
  key: ApplicationAnswerKey,
): string {
  const limit = APPLICATION_ANSWER_MAX_LENGTHS[key];
  return `${APPLICATION_ANSWER_LABELS[key]}은(는) ${limit.toLocaleString('ko-KR')}자를 넘을 수 없습니다.`;
}

export type ApplicationAnswersValidationSuccess = {
  readonly ok: true;
  readonly answers: ApplicationAnswers;
};

export type ApplicationAnswersValidationResult =
  ApplicationAnswersValidationSuccess | ApplicationAnswersValidationFailure;

export type TemplateVersionCheckResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'VERSION_MISMATCH' };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * 클라이언트 answers에서 auto 필드를 제거하고 서버 applicantName을 주입한 뒤 검증한다.
 * 허용 클라이언트 키: title, summary. applicantName은 클라이언트 작성 대상이 아니다.
 */
export function normalizeAndValidateApplicationAnswers(
  clientAnswers: unknown,
  applicantName: string,
  lengthMode: ApplicationAnswersLengthMode,
): ApplicationAnswersValidationResult {
  if (!isPlainObject(clientAnswers)) {
    return { ok: false, reason: 'INVALID_SHAPE' };
  }

  const clientKeys = Object.keys(clientAnswers).filter(
    (key) => key !== 'applicantName',
  );
  const unknownKeys = clientKeys.filter((key) => !CLIENT_KEYS.has(key));
  if (unknownKeys.length > 0) {
    return { ok: false, reason: 'UNKNOWN_KEYS', unknownKeys };
  }

  const title = clientAnswers.title;
  const summary = clientAnswers.summary;
  if (!isNonEmptyString(summary) || !isNonEmptyString(applicantName)) {
    const missingKeys: string[] = [];
    if (!isNonEmptyString(summary)) missingKeys.push('summary');
    if (!isNonEmptyString(applicantName)) missingKeys.push('applicantName');
    return { ok: false, reason: 'MISSING_REQUIRED', missingKeys };
  }

  const answers = {
    applicantName: applicantName.trim(),
    title: isNonEmptyString(title) ? title.trim() : '',
    summary: summary.trim(),
  };

  if (lengthMode === 'enforce-length') {
    // 자르지 않는다 — 학생이 쓴 글을 조용히 버리는 것이 더 나쁘다(#736 과 같은 판단).
    const tooLongKeys = (
      Object.keys(
        APPLICATION_ANSWER_MAX_LENGTHS,
      ) as readonly ApplicationAnswerKey[]
    ).filter(
      (key) => answers[key].length > APPLICATION_ANSWER_MAX_LENGTHS[key],
    );
    if (tooLongKeys.length > 0) {
      return { ok: false, reason: 'TOO_LONG', tooLongKeys };
    }
  }

  return { ok: true, answers };
}

/** stamped 프로그램 템플릿 버전과 제출 버전이 다르면 409 대상이다. */
export function checkApplicationTemplateVersion(
  submittedVersion: number,
  stampedVersion: number,
): TemplateVersionCheckResult {
  if (
    !Number.isInteger(submittedVersion) ||
    !Number.isInteger(stampedVersion) ||
    submittedVersion !== stampedVersion
  ) {
    return { ok: false, reason: 'VERSION_MISMATCH' };
  }
  return { ok: true };
}
