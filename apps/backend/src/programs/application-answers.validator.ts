/**
 * 신청 answers 정규화·검증 (순수 함수).
 * 순서: 클라이언트의 applicantName 제거 → 서버 applicantName 주입 → 키·필수값 검증.
 * DomainException 변환은 호출 측(#104 POST)에서 한다.
 */

const CLIENT_KEYS = new Set(['title', 'summary']);

export type ApplicationAnswers = {
  readonly applicantName: string;
  readonly title: string;
  readonly summary: string;
};

export type ApplicationAnswersValidationFailure = {
  readonly ok: false;
  readonly reason: 'INVALID_SHAPE' | 'UNKNOWN_KEYS' | 'MISSING_REQUIRED';
  readonly unknownKeys?: readonly string[];
  readonly missingKeys?: readonly string[];
};

export type ApplicationAnswersValidationSuccess = {
  readonly ok: true;
  readonly answers: ApplicationAnswers;
};

export type ApplicationAnswersValidationResult =
  | ApplicationAnswersValidationSuccess
  | ApplicationAnswersValidationFailure;

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
  const missingKeys: string[] = [];
  if (!isNonEmptyString(title)) missingKeys.push('title');
  if (!isNonEmptyString(summary)) missingKeys.push('summary');
  if (!isNonEmptyString(applicantName)) missingKeys.push('applicantName');
  if (missingKeys.length > 0) {
    return { ok: false, reason: 'MISSING_REQUIRED', missingKeys };
  }

  // isNonEmptyString 가드 이후 narrowing (missingKeys early-return).
  const normalizedTitle = title as string;
  const normalizedSummary = summary as string;
  const normalizedApplicantName = applicantName as string;

  return {
    ok: true,
    answers: {
      applicantName: normalizedApplicantName.trim(),
      title: normalizedTitle.trim(),
      summary: normalizedSummary.trim(),
    },
  };
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
