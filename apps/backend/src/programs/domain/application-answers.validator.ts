const CLIENT_KEYS = new Set(['title']);
const LEGACY_READ_KEYS = new Set(['summary']);
const READ_KEYS = new Set([...CLIENT_KEYS, ...LEGACY_READ_KEYS]);

export const APPLICATION_ANSWER_MAX_LENGTHS = {
  title: 200,
} as const;

export type ApplicationAnswerKey = keyof typeof APPLICATION_ANSWER_MAX_LENGTHS;

export type ApplicationAnswers = {
  readonly applicantName: string;
  readonly title: string;
};

export type ApplicationAnswersValidationFailure = {
  readonly ok: false;
  readonly reason:
    'INVALID_SHAPE' | 'UNKNOWN_KEYS' | 'MISSING_REQUIRED' | 'TOO_LONG';
  readonly unknownKeys?: readonly string[];
  readonly missingKeys?: readonly string[];
  readonly tooLongKeys?: readonly ApplicationAnswerKey[];
};

export type ApplicationAnswersLengthMode = 'enforce-length' | 'skip-length';

const APPLICATION_ANSWER_LABELS = {
  title: '제목',
} as const satisfies Readonly<Record<ApplicationAnswerKey, string>>;

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

export function normalizeAndValidateApplicationAnswers(
  clientAnswers: unknown,
  applicantName: string,
  lengthMode: ApplicationAnswersLengthMode,
): ApplicationAnswersValidationResult {
  if (!isPlainObject(clientAnswers)) {
    return { ok: false, reason: 'INVALID_SHAPE' };
  }

  const allowedKeys = lengthMode === 'skip-length' ? READ_KEYS : CLIENT_KEYS;
  const clientKeys = Object.keys(clientAnswers).filter(
    (key) => key !== 'applicantName',
  );
  const unknownKeys = clientKeys.filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length > 0) {
    return { ok: false, reason: 'UNKNOWN_KEYS', unknownKeys };
  }

  const title = clientAnswers.title;
  if (!isNonEmptyString(applicantName)) {
    const missingKeys: string[] = [];
    if (!isNonEmptyString(applicantName)) missingKeys.push('applicantName');
    return { ok: false, reason: 'MISSING_REQUIRED', missingKeys };
  }

  const answers = {
    applicantName: applicantName.trim(),
    title: isNonEmptyString(title) ? title.trim() : '',
  };

  if (lengthMode === 'enforce-length') {
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
