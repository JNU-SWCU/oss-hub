export const DEADLINE_DIGEST_DELIVERY_FAILURE = {
  code: 'MAIL_DELIVERY_FAILED',
  message: '메일 발송에 실패했습니다.',
} as const;

export const INVALID_DIGEST_FORCE_TO_MESSAGE =
  'DIGEST_FORCE_TO must be exactly one valid email address.';

export class InvalidDigestForceToError extends Error {
  override readonly name = 'InvalidDigestForceToError';

  constructor() {
    super(INVALID_DIGEST_FORCE_TO_MESSAGE);
  }
}

export class FrontendOriginError extends Error {
  override readonly name = 'FrontendOriginError';

  constructor() {
    super('FRONTEND_URL must be an HTTP(S) origin.');
  }
}
